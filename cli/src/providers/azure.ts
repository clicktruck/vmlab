// The Azure provider. Everything it makes lives in one resource group, tagged with the run and its expiry, with no
// public address and no open ports. Commands reach the machine through Azure's Run Command. The group is deleted
// when the run ends; `sweep` deletes any that were left. A password is made for each machine, used, and never
// printed, logged or written down.
import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Az } from '../az.ts';
import { type Fetch, hourlyPrice } from '../pricing.ts';
import { quiet, type Reporter } from '../progress.ts';
import type { ExecResult, Machine, Provider, RunContext, Script, ScriptInputs } from '../provider.ts';
import type { Profile } from '../schema.ts';
import { AzureExchange, DOWNLOAD_SCRIPT, UPLOAD_SCRIPT } from './azure-exchange.ts';
import { buildRunAsUserScript, CREATE_USER_SCRIPT, inputsJson, safeName } from './windows-user-task.ts';

export type AzureSettings = {
  subscription: string | null;
  location: string;
  resource_group_prefix: string;
};

/** One machine size as `az vm list-skus` describes it (the parts we read). */
export type Sku = {
  name: string;
  family?: string;
  capabilities?: { name: string; value: string }[];
  restrictions?: { type?: string; reasonCode?: string; restrictionInfo?: { zones?: string[] } }[];
};

/** One line of `az vm list-usage`: a vCPU quota, and how much of it is in use. Azure sometimes sends numbers as text. */
export type Usage = {
  name: { value: string; localizedValue?: string };
  currentValue: number | string;
  limit: number | string;
};

const num = (x: unknown): number => {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Whether the subscription has the vCPU quota this size needs, in its size family and in total for the region.
 * A new subscription often has a quota of 0 for newer families. Azure then refuses the machine, and the Azure CLI
 * can crash while reporting it, hiding the cause, so the quota is read first and a short, plain message is given.
 */
export function checkQuota(
  skus: Sku[],
  usage: Usage[],
  size: string,
  location: string,
): { ok: true } | { ok: false; why: string } {
  const sku = skus.find((s) => s.name.toLowerCase() === size.toLowerCase());
  const need = num(sku?.capabilities?.find((c) => c.name === 'vCPUs')?.value);
  if (!sku || need === 0) return { ok: true }; // cannot tell: let Azure decide
  const family = usage.find((u) => u.name.value.toLowerCase() === (sku.family ?? '').toLowerCase());
  if (family && num(family.limit) - num(family.currentValue) < need) {
    return {
      ok: false,
      why: `you have no vCPU quota for ${size} in ${location}: the limit for ${family.name.localizedValue ?? family.name.value} is ${num(family.limit)} (${num(family.currentValue)} in use) and the size needs ${need}. Ask Azure for more (portal: Quotas, then Compute), or choose a size from a family that has room`,
    };
  }
  const total = usage.find((u) => u.name.value === 'cores');
  if (total && num(total.limit) - num(total.currentValue) < need) {
    return {
      ok: false,
      why: `the total vCPU limit for ${location} is ${num(total.limit)} (${num(total.currentValue)} in use) and ${size} needs ${need}. Ask Azure for more (portal: Quotas, then Compute)`,
    };
  }
  return { ok: true };
}

/**
 * Whether this subscription can make this size in this region. Azure's list matches any size whose name
 * contains the one asked for (asking for Standard_B2s also returns Standard_B2s_v2), so the name must match
 * exactly. A restriction on the whole region blocks it. A restriction on some availability zones does not stop a
 * machine that is not pinned to a zone, so it is allowed, with a note.
 */
export function checkSize(
  skus: Sku[],
  size: string,
  location: string,
): { ok: true; note?: string } | { ok: false; why: string } {
  const exact = skus.filter((s) => s.name.toLowerCase() === size.toLowerCase());
  if (exact.length === 0) {
    const near = [...new Set(skus.map((s) => s.name))].slice(0, 5);
    return {
      ok: false,
      why: `size ${size} is not offered to this subscription in ${location}${near.length ? ` (similar sizes that are: ${near.join(', ')})` : ''}`,
    };
  }
  const all = exact.flatMap((s) => s.restrictions ?? []);
  const region = all.filter((r) => r.type === 'Location');
  if (region.length) {
    return {
      ok: false,
      why: `size ${size} is restricted for this subscription in ${location} (${[...new Set(region.map((r) => r.reasonCode))].join(', ')})`,
    };
  }
  const zones = [...new Set(all.flatMap((r) => r.restrictionInfo?.zones ?? []))];
  return zones.length
    ? {
        ok: true,
        note: `size ${size}: availability zones ${zones.join(', ')} are restricted here; the machine is not pinned to a zone`,
      }
    : { ok: true };
}

const SERVICES = ['Microsoft.Compute', 'Microsoft.Network', 'Microsoft.Storage'] as const;
const ADMIN_USER = 'azureuser';

/** Long, random, and with an upper-case letter, a lower-case letter, a digit and a symbol, as Windows requires. */
export function makePassword(): string {
  return `${randomBytes(18).toString('base64url')}Aa1!`;
}

type Pending = {
  rg: string;
  vm: string;
  password: string;
  steps: number;
  exchange?: AzureExchange;
  /** Extra local accounts made on this machine for `run_as: user:NAME` steps, with the passwords vmlab chose. */
  users: Map<string, string>;
};

export class AzureProvider implements Provider {
  readonly name = 'azure';
  private readonly az: Az;
  private readonly settings: AzureSettings;
  private readonly fetchFn: Fetch;
  private readonly makePw: () => string;
  private readonly reporter: Reporter;
  /** How long to wait between looks while a restarted machine comes back. */
  private readonly pollMs: number;
  private readonly machines = new Map<string, Pending>();
  /** Azure's size and usage lists are slow (about a minute each), and a run asks about the same size twice. */
  private readonly lookups = new Map<string, Promise<unknown>>();

  constructor(
    az: Az,
    settings: AzureSettings,
    fetchFn: Fetch = fetch,
    makePw: () => string = makePassword,
    reporter: Reporter = quiet(),
    pollMs = 10_000,
  ) {
    this.az = az;
    this.settings = settings;
    this.fetchFn = fetchFn;
    this.makePw = makePw;
    this.reporter = reporter;
    this.pollMs = pollMs;
  }

  private once<T>(key: string, fn: () => Promise<T>): Promise<T> {
    let hit = this.lookups.get(key) as Promise<T> | undefined;
    if (!hit) {
      hit = fn();
      this.lookups.set(key, hit);
      hit.catch(() => this.lookups.delete(key));
    }
    return hit;
  }

  /** One step inside making, using or deleting a machine: logged, timed and recorded. */
  private step<T>(label: string, profile: string, fn: () => Promise<T>): Promise<T> {
    return this.reporter.timed(label, fn, { profile, level: 1 });
  }

  /** Adds `--subscription` when the config names one; otherwise az uses the one you are signed in to. */
  private withSub(args: string[]): string[] {
    return this.settings.subscription ? [...args, '--subscription', this.settings.subscription] : args;
  }

  private names(profile: Profile, ctx: RunContext) {
    const hex = ctx.runId
      .slice(-4)
      .toLowerCase()
      .replace(/[^a-z0-9]/g, 'x');
    return { rg: `${this.settings.resource_group_prefix}-${hex}-${profile.name}`, vm: `vm${hex}` };
  }

  plan(profile: Profile, ctx: RunContext): string[] {
    const { rg, vm } = this.names(profile, ctx);
    const lines = [
      `would register the Azure services Compute, Network and Storage if they are not registered yet (free, once)`,
      `would make resource group ${rg} in ${this.settings.location}, tagged with the run and its expiry ${ctx.expiresAt.toISOString()}`,
      `would make one ${profile.os} machine ${vm}: ${profile.image}, size ${profile.size}, disk ${profile.disk}`,
      'no public address and no open ports; commands reach it through Azure Run Command',
      `a random admin password, never printed or saved`,
    ];
    if (ctx.licenceType === 'Windows_Client') {
      lines.push('would set the Windows_Client licence type, because you attested a licence that covers it');
    }
    lines.push(`would delete resource group ${rg}, and everything in it, when the run ends`);
    return lines;
  }

  async estimate(profile: Profile): Promise<number | null> {
    return hourlyPrice(this.fetchFn, {
      location: this.settings.location,
      size: profile.size,
      windows: profile.os === 'windows',
    });
  }

  async up(profile: Profile, ctx: RunContext): Promise<Machine> {
    const { rg, vm } = this.names(profile, ctx);
    const password = this.makePw();
    const opts = { secrets: [password] };
    const run = (args: string[]) => this.az(this.withSub(args), opts);

    // 1. Nothing is made until these hold: the services are registered, and the size is allowed here.
    await this.step('checking the Azure services (registering any that are not)', profile.name, async () => {
      for (const service of SERVICES) {
        const state = (
          await run(['provider', 'show', '-n', service, '--query', 'registrationState', '-o', 'tsv'])
        ).stdout.trim();
        if (state !== 'Registered') await run(['provider', 'register', '-n', service, '--wait']);
      }
    });
    const skus = await this.step(
      'checking the machine size is available here',
      profile.name,
      () =>
        this.once(`skus|${this.settings.location}|${profile.size}`, async () =>
          JSON.parse(
            (
              await run([
                'vm',
                'list-skus',
                '-l',
                this.settings.location,
                '--size',
                profile.size,
                '--resource-type',
                'virtualMachines',
                '-o',
                'json',
              ])
            ).stdout || '[]',
          ),
        ) as Promise<Sku[]>,
    );
    const size = checkSize(skus, profile.size, this.settings.location);
    if (!size.ok) {
      throw new Error(`${size.why}. Change size or location in the profile or vmlab.yaml. Nothing was made.`);
    }
    if (size.note) this.reporter.info(size.note, { profile: profile.name, level: 1 });
    const usage = await this.step(
      'checking your vCPU quota for this size',
      profile.name,
      () =>
        this.once(`usage|${this.settings.location}`, async () =>
          JSON.parse(
            (await run(['vm', 'list-usage', '-l', this.settings.location, '-o', 'json'])).stdout || '[]',
          ),
        ) as Promise<Usage[]>,
    );
    const quota = checkQuota(skus, usage, profile.size, this.settings.location);
    if (!quota.ok) throw new Error(`${quota.why}. Nothing was made.`);

    // 2. One resource group holds everything, so deleting it deletes everything.
    const tagArgs = Object.entries({ ...ctx.tags, vmlab_profile: profile.name }).map(([k, v]) => `${k}=${v}`);
    await this.step('creating the resource group', profile.name, () =>
      run(['group', 'create', '-n', rg, '-l', this.settings.location, '--tags', ...tagArgs, '-o', 'none']),
    );
    try {
      const create = [
        'vm',
        'create',
        '-g',
        rg,
        '-n',
        vm,
        '--image',
        profile.image,
        '--size',
        profile.size,
        '--admin-username',
        ADMIN_USER,
        '--admin-password',
        password,
        '--public-ip-address',
        '',
        '--nsg-rule',
        'NONE',
        '--storage-sku',
        profile.disk,
        '--os-disk-delete-option',
        'Delete',
        '--nic-delete-option',
        'Delete',
        '--tags',
        ...tagArgs,
        '-o',
        'none',
      ];
      if (ctx.licenceType === 'Windows_Client') create.push('--license-type', 'Windows_Client');
      await this.step('creating the VM (usually 3 to 6 minutes)', profile.name, () => run(create));
    } catch (e) {
      // Clean up what was made, then say so. A failed clean-up is said too, with the group's name.
      const left = await this.deleteGroup(rg, profile.name).then(
        () => 'The resource group was deleted.',
        () =>
          `The resource group ${rg} may still exist: \`vmlab sweep\` deletes it after ${ctx.expiresAt.toISOString()}.`,
      );
      throw new Error(`${(e as Error).message} ${left}`);
    }
    const id = `${rg}/${vm}`;
    this.machines.set(id, { rg, vm, password, steps: 0, users: new Map() });
    return { id, profile: profile.name };
  }

  async exec(
    machine: Machine,
    script: Script,
    runAs: string,
    timeoutSeconds: number,
    inputs: ScriptInputs = {},
  ): Promise<ExecResult> {
    return this.runScript(machine, script, runAs, timeoutSeconds, inputs, true);
  }

  /** Runs a script on the machine. With `whole`, and the exchange made, the full output is read back, not the last 4 KB. */
  private async runScript(
    machine: Machine,
    script: Script,
    runAs: string,
    timeoutSeconds: number,
    inputs: ScriptInputs,
    whole: boolean,
  ): Promise<ExecResult> {
    const m = this.machines.get(machine.id);
    if (!m) throw new Error(`machine ${machine.id} is not one this provider made in this run`);
    const who: string[] = [];
    if (runAs === 'admin') who.push('--run-as-user', ADMIN_USER, '--run-as-password', m.password);
    else if (runAs.startsWith('user:')) {
      // An ordinary account, made the first time a step asks for it, with a password only this run knows. The step
      // then runs through a scheduled task as that account, so its profile is loaded (see windows-user-task.ts).
      const account = runAs.slice('user:'.length);
      let pw = m.users.get(account);
      if (!pw) {
        pw = makePassword();
        m.users.set(account, pw);
        const made = await this.runScript(
          machine,
          { name: 'vmlab-create-user.ps1', content: CREATE_USER_SCRIPT },
          'system',
          300,
          { parameters: { Name: account }, protectedParameters: { Pw: pw } },
          false,
        );
        if (made.exitCode !== 0)
          throw new Error(`could not make the account ${account}: ${made.output.slice(-300)}`);
      }
      return this.runScript(
        machine,
        {
          name: `vmlab-as-${safeName(account)}.ps1`,
          content: buildRunAsUserScript(script.name, script.content),
        },
        'system',
        timeoutSeconds + 60,
        {
          parameters: { Name: account, TimeoutSeconds: String(timeoutSeconds) },
          protectedParameters: {
            Pw: pw,
            ArgsJson: inputsJson(inputs.parameters ?? {}, inputs.protectedParameters ?? {}),
          },
        },
        whole,
      );
    } else if (runAs !== 'system') {
      throw new Error(`run_as "${runAs}" is not one of admin, system or user:NAME`);
    }
    m.steps += 1;
    const name = `vmlab-step-${m.steps}`;
    const dir = await mkdtemp(path.join(tmpdir(), 'vmlab-script-'));
    try {
      const file = path.join(dir, script.name.replace(/[^A-Za-z0-9_.-]/g, '_'));
      await writeFile(file, script.content, { mode: 0o600 });
      const named = Object.entries(inputs.parameters ?? {}).map(([k, v]) => `${k}=${v}`);
      const hidden = Object.entries(inputs.protectedParameters ?? {}).map(([k, v]) => `${k}=${v}`);
      const withParams = [
        ...(named.length ? ['--parameters', ...named] : []),
        ...(hidden.length ? ['--protected-parameters', ...hidden] : []),
      ];
      const opts = {
        secrets: [
          m.password,
          ...Object.values(inputs.protectedParameters ?? {}),
          ...(m.exchange?.secrets() ?? []),
        ],
        timeoutMs: (timeoutSeconds + 120) * 1000,
      };
      // With the exchange made, the machine writes its whole output and errors to storage as it goes.
      const blobs: { out: string; err: string; args: string[] } = { out: '', err: '', args: [] };
      if (whole && m.exchange) {
        blobs.out = `${name}-out.txt`;
        blobs.err = `${name}-err.txt`;
        const outLink = await m.exchange.link(blobs.out, 'acw');
        const errLink = await m.exchange.link(blobs.err, 'acw');
        opts.secrets.push(outLink, errLink);
        blobs.args = ['--output-blob-uri', outLink, '--error-blob-uri', errLink];
      }
      await this.step(
        `sending ${script.name} to the machine and waiting for it to finish (as ${runAs})`,
        machine.profile,
        () =>
          this.az(
            this.withSub([
              'vm',
              'run-command',
              'create',
              '-g',
              m.rg,
              '--vm-name',
              m.vm,
              '--run-command-name',
              name,
              '--script',
              `@${file}`,
              '--timeout-in-seconds',
              String(timeoutSeconds),
              ...who,
              ...withParams,
              ...blobs.args,
              '-o',
              'none',
            ]),
            opts,
          ),
      );
      const shown = await this.step('reading the result', machine.profile, () =>
        this.az(
          this.withSub([
            'vm',
            'run-command',
            'show',
            '-g',
            m.rg,
            '--vm-name',
            m.vm,
            '--run-command-name',
            name,
            '--instance-view',
            '--query',
            'instanceView',
            '-o',
            'json',
          ]),
          opts,
        ),
      );
      const view = JSON.parse(shown.stdout) as {
        executionState?: string;
        exitCode?: number | null;
        output?: string;
        error?: string;
      };
      const exitCode = view.exitCode ?? (view.executionState === 'Succeeded' ? 0 : 1);
      let said = view.output ?? '';
      let errored = view.error ?? '';
      if (m.exchange && blobs.out) {
        try {
          await m.exchange.download(blobs.out, path.join(dir, 'whole-out.txt'));
          said = await readFile(path.join(dir, 'whole-out.txt'), 'utf8');
        } catch {
          // The instance view's last 4 KB is still there.
        }
        try {
          await m.exchange.download(blobs.err, path.join(dir, 'whole-err.txt'));
          errored = await readFile(path.join(dir, 'whole-err.txt'), 'utf8');
        } catch {
          /* the same */
        }
      }
      const output = [said, errored ? `[stderr] ${errored}` : ''].filter(Boolean).join('\n');
      return { ran: true, exitCode, output };
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  /** Makes the storage for files and whole outputs, once per machine. */
  async prepareExchange(machine: Machine): Promise<void> {
    const m = this.machines.get(machine.id);
    if (!m) throw new Error(`machine ${machine.id} is not one this provider made in this run`);
    if (!m.exchange) {
      m.exchange = new AzureExchange(this.az, {
        rg: m.rg,
        location: this.settings.location,
        subscription: this.settings.subscription,
      });
    }
    const ex = m.exchange;
    await this.step('making the file exchange (private storage inside this run)', machine.profile, () =>
      ex.ensure(),
    );
  }

  async putFile(machine: Machine, localPath: string, remotePath: string): Promise<{ ran: boolean }> {
    const m = this.machines.get(machine.id);
    if (!m?.exchange) throw new Error('the exchange has not been made: call prepareExchange first');
    const ex = m.exchange;
    m.steps += 1;
    const blob = `in-${m.steps}-${path.basename(localPath).replace(/[^A-Za-z0-9_.-]/g, '_')}`;
    await this.step(`uploading ${path.basename(localPath)} to the exchange`, machine.profile, () =>
      ex.upload(localPath, blob),
    );
    const link = await ex.link(blob, 'r');
    const res = await this.step(`copying it onto the machine at ${remotePath}`, machine.profile, () =>
      this.runScript(
        machine,
        { name: 'vmlab-download.ps1', content: DOWNLOAD_SCRIPT },
        'system',
        600,
        {
          parameters: { Dest: remotePath },
          protectedParameters: { Url: link },
        },
        false,
      ),
    );
    if (res.exitCode !== 0)
      throw new Error(`copying onto the machine failed: ${res.output.replace(link, '[link]').slice(0, 400)}`);
    return { ran: true };
  }

  async getFile(machine: Machine, remotePath: string, localPath: string): Promise<{ ran: boolean }> {
    const m = this.machines.get(machine.id);
    if (!m?.exchange) throw new Error('the exchange has not been made: call prepareExchange first');
    const ex = m.exchange;
    m.steps += 1;
    const blob = `out-${m.steps}.zip`;
    const link = await ex.link(blob, 'acw');
    const res = await this.step(
      `sending ${remotePath} from the machine to the exchange`,
      machine.profile,
      () =>
        this.runScript(
          machine,
          { name: 'vmlab-upload.ps1', content: UPLOAD_SCRIPT },
          'system',
          900,
          {
            parameters: { Path: remotePath },
            protectedParameters: { Url: link },
          },
          false,
        ),
    );
    if (res.exitCode !== 0)
      throw new Error(
        `bringing ${remotePath} back failed: ${res.output.replace(link, '[link]').slice(0, 400)}`,
      );
    await this.step(`downloading it to ${path.basename(localPath)}`, machine.profile, () =>
      ex.download(blob, localPath),
    );
    return { ran: true };
  }

  async reboot(machine: Machine, timeoutSeconds: number): Promise<{ ran: boolean }> {
    const m = this.machines.get(machine.id);
    if (!m) throw new Error(`machine ${machine.id} is not one this provider made in this run`);
    const opts = { secrets: [m.password], timeoutMs: (timeoutSeconds + 120) * 1000 };
    await this.step('restarting the machine', machine.profile, () =>
      this.az(this.withSub(['vm', 'restart', '-g', m.rg, '-n', m.vm, '-o', 'none']), opts),
    );
    // Back when Azure reports the machine running and its agent ready: only then can a script be sent again.
    await this.step('waiting for the machine to answer again', machine.profile, async () => {
      const deadline = Date.now() + timeoutSeconds * 1000;
      for (;;) {
        const shown = await this.az(
          this.withSub([
            'vm',
            'get-instance-view',
            '-g',
            m.rg,
            '-n',
            m.vm,
            '--query',
            'instanceView',
            '-o',
            'json',
          ]),
          opts,
        );
        const view = JSON.parse(shown.stdout || '{}') as {
          statuses?: { code?: string }[];
          vmAgent?: { statuses?: { displayStatus?: string }[] };
        };
        const running = (view.statuses ?? []).some((x) => x.code === 'PowerState/running');
        const ready = (view.vmAgent?.statuses ?? []).some((x) => x.displayStatus === 'Ready');
        if (running && ready) return;
        if (Date.now() > deadline) {
          throw new Error(`the machine did not answer again within ${timeoutSeconds} seconds of the restart`);
        }
        await new Promise((r) => setTimeout(r, this.pollMs));
      }
    });
    return { ran: true };
  }

  private async deleteGroup(rg: string, profile = 'cleanup'): Promise<void> {
    await this.step(`deleting resource group ${rg} (usually 2 to 4 minutes)`, profile, () =>
      this.az(this.withSub(['group', 'delete', '-n', rg, '--yes', '-o', 'none'])),
    );
    const exists = (
      await this.step('checking that it is gone', profile, () =>
        this.az(this.withSub(['group', 'exists', '-n', rg, '-o', 'tsv'])),
      )
    ).stdout.trim();
    if (exists !== 'false') throw new Error(`resource group ${rg} still exists after the delete`);
  }

  async down(machine: Machine): Promise<void> {
    const m = this.machines.get(machine.id);
    const rg = m?.rg ?? machine.id.split('/')[0];
    if (!rg) throw new Error(`cannot tell which resource group holds ${machine.id}`);
    await this.deleteGroup(rg, machine.profile);
    this.machines.delete(machine.id);
  }

  /** Deletes resource groups vmlab made (our prefix and our tags) whose expiry has passed. Nothing else. */
  async sweep(now: Date): Promise<string[]> {
    const listed = await this.az(
      this.withSub([
        'group',
        'list',
        '--query',
        '[?tags.vmlab_expires != null && tags.vmlab_run != null].{name:name,expires:tags.vmlab_expires}',
        '-o',
        'json',
      ]),
    );
    const groups = JSON.parse(listed.stdout || '[]') as { name: string; expires: string }[];
    const deleted: string[] = [];
    for (const g of groups) {
      if (!g.name.startsWith(`${this.settings.resource_group_prefix}-`)) continue;
      const when = Date.parse(g.expires);
      if (Number.isNaN(when) || when > now.getTime()) continue;
      await this.deleteGroup(g.name);
      deleted.push(g.name);
    }
    return deleted;
  }
}
