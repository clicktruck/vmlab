import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import type { Az, AzResult } from '../az.ts';
import { StepReporter } from '../progress.ts';
import type { RunContext } from '../provider.ts';
import type { Profile } from '../schema.ts';
import { AzureProvider, type AzureSettings, checkQuota, checkSize } from './azure.ts';

const settings: AzureSettings = { subscription: null, location: 'eastus2', resource_group_prefix: 'vmlab' };
const PASSWORD = 'Test-Password-Not-Real-Aa1!';

const profile: Profile = {
  name: 'windows-11',
  description: 'x',
  os: 'windows',
  image: 'MicrosoftWindowsDesktop:windows-11:win11-25h2-ent:latest',
  size: 'Standard_B2s_v2',
  disk: 'StandardSSD_LRS',
  network: { public_ip: false, inbound: [] },
  licence: { type: 'Windows_Client', requires_attestation: 'windows_client_licence' },
};

const ctx = (licenceType: 'included' | 'Windows_Client' = 'Windows_Client'): RunContext => ({
  runId: '20261123T192759Z-windows-acl-3385',
  expiresAt: new Date('2026-11-23T20:27:59Z'),
  tags: { purpose: 'vmlab-test', vmlab_run: 'r1', vmlab_expires: '2026-11-23T20:27:59.000Z' },
  licenceType,
});

const OK_SKU = {
  name: 'Standard_B2s_v2',
  family: 'standardBsv2Family',
  capabilities: [{ name: 'vCPUs', value: '2' }],
  restrictions: [],
};
const OK_USAGE = [
  { name: { value: 'cores', localizedValue: 'Total Regional vCPUs' }, currentValue: '0', limit: '10' },
  {
    name: { value: 'standardBsv2Family', localizedValue: 'Standard Bsv2 Family vCPUs' },
    currentValue: '0',
    limit: '10',
  },
];

type Call = string[];
/** A fake `az`: writes down every call, and answers from a small table. `fail` makes matching calls throw. */
function fakeAz(
  opts: {
    registered?: boolean;
    skus?: unknown;
    fail?: (args: string[]) => boolean;
    exists?: string;
    usage?: unknown;
    groups?: unknown;
  } = {},
) {
  const calls: Call[] = [];
  const az: Az = async (args): Promise<AzResult> => {
    calls.push(args);
    if (opts.fail?.(args)) throw new Error(`az ${args.slice(0, 3).join(' ')} failed: boom`);
    const key = args.slice(0, 2).join(' ');
    if (key === 'provider show')
      return { stdout: opts.registered === false ? 'NotRegistered\n' : 'Registered\n', stderr: '' };
    if (key === 'vm list-skus')
      return {
        stdout: JSON.stringify(opts.skus ?? [OK_SKU]),
        stderr: '',
      };
    if (key === 'vm list-usage') return { stdout: JSON.stringify(opts.usage ?? OK_USAGE), stderr: '' };
    if (key === 'group exists') return { stdout: `${opts.exists ?? 'false'}\n`, stderr: '' };
    if (key === 'group list') return { stdout: JSON.stringify(opts.groups ?? []), stderr: '' };
    if (key === 'vm run-command' && args[2] === 'show') {
      return {
        stdout: JSON.stringify({
          executionState: 'Succeeded',
          exitCode: 0,
          output: 'RUNNING AS: x\nDONE',
          error: '',
        }),
        stderr: '',
      };
    }
    return { stdout: '', stderr: '' };
  };
  return { az, calls };
}

const find = (calls: Call[], ...start: string[]) => calls.find((c) => start.every((s, i) => c[i] === s));
const after = (args: string[], flag: string) => args[args.indexOf(flag) + 1];

test('up makes one tagged group and one machine with no public address and no open ports', async () => {
  const { az, calls } = fakeAz();
  const p = new AzureProvider(az, settings, undefined, () => PASSWORD);
  const machine = await p.up(profile, ctx());
  const group = find(calls, 'group', 'create');
  assert.ok(group);
  assert.equal(after(group, '-l'), 'eastus2');
  assert.ok(group.includes('vmlab_expires=2026-11-23T20:27:59.000Z'), 'the expiry is a tag on the group');
  const create = find(calls, 'vm', 'create');
  assert.ok(create);
  assert.equal(
    after(create, '--public-ip-address'),
    '',
    'an empty public address, passed as an argument, not through a shell',
  );
  assert.equal(after(create, '--nsg-rule'), 'NONE');
  assert.equal(after(create, '--os-disk-delete-option'), 'Delete');
  assert.equal(after(create, '--license-type'), 'Windows_Client');
  assert.ok(create.includes('vmlab_expires=2026-11-23T20:27:59.000Z'), 'the machine carries the expiry too');
  assert.match(machine.id, /^vmlab-3385-windows-11\/vm3385$/);
});

test('up and down tell the person each step, so a long wait is explained', async () => {
  const lines: string[] = [];
  const reporter = new StepReporter({ write: (l) => lines.push(l) });
  const { az } = fakeAz();
  const p = new AzureProvider(az, settings, undefined, () => PASSWORD, reporter);
  await p.down(await p.up(profile, ctx()));
  const text = lines.join('\n');
  for (const step of [
    'checking the Azure services',
    'checking the machine size',
    'creating the resource group',
    'creating the VM (usually 3 to 6 minutes)',
    'deleting resource group',
    'checking that it is gone',
  ]) {
    assert.match(text, new RegExp(`> .*${step.replace(/[()]/g, '\\$&')}`), step);
  }
  assert.equal(text.includes(PASSWORD), false);
});

test('the Windows_Client licence type is set only when the plan says so', async () => {
  const { az, calls } = fakeAz();
  await new AzureProvider(az, settings, undefined, () => PASSWORD).up(
    { ...profile, licence: { type: 'included' } },
    ctx('included'),
  );
  assert.equal(find(calls, 'vm', 'create')?.includes('--license-type'), false);
});

test('services that are not registered are registered, and registered ones are left alone', async () => {
  const unreg = fakeAz({ registered: false });
  await new AzureProvider(unreg.az, settings, undefined, () => PASSWORD).up(profile, ctx());
  assert.equal(unreg.calls.filter((c) => c[0] === 'provider' && c[1] === 'register').length, 3);
  const reg = fakeAz();
  await new AzureProvider(reg.az, settings, undefined, () => PASSWORD).up(profile, ctx());
  assert.equal(reg.calls.filter((c) => c[0] === 'provider' && c[1] === 'register').length, 0);
});

test('a size restricted for the whole region stops before anything is made', async () => {
  const { az, calls } = fakeAz({
    skus: [
      {
        name: 'Standard_B2s_v2',
        restrictions: [{ type: 'Location', reasonCode: 'NotAvailableForSubscription' }],
      },
    ],
  });
  await assert.rejects(
    new AzureProvider(az, settings).up(profile, ctx()),
    /restricted for this subscription in eastus2/,
  );
  assert.equal(find(calls, 'group', 'create'), undefined, 'no resource group was made');
});

test('a size Azure does not list by its exact name stops, and the message names what is offered', async () => {
  // Azure's list matches by substring: asking for Standard_B2s returns Standard_B2s_v2, which is a different size.
  const { az, calls } = fakeAz({ skus: [{ name: 'Standard_B2s_v2', restrictions: [] }] });
  await assert.rejects(
    new AzureProvider(az, settings).up({ ...profile, size: 'Standard_B2s' }, ctx()),
    /Standard_B2s is not offered.*similar sizes that are: Standard_B2s_v2/,
  );
  assert.equal(find(calls, 'group', 'create'), undefined);
});

test('a size with only some availability zones restricted goes ahead, and says so', async () => {
  const lines: string[] = [];
  const reporter = new StepReporter({ write: (t) => lines.push(t) });
  const { az, calls } = fakeAz({
    skus: [
      {
        name: 'Standard_B2s_v2',
        restrictions: [
          {
            type: 'Zone',
            reasonCode: 'NotAvailableForSubscription',
            restrictionInfo: { zones: ['1', '2', '3'] },
          },
        ],
      },
    ],
  });
  await new AzureProvider(az, settings, undefined, () => PASSWORD, reporter).up(profile, ctx());
  assert.ok(find(calls, 'vm', 'create'));
  assert.match(lines.join(''), /availability zones 1, 2, 3 are restricted here/);
});

test('no quota for the size family stops before anything is made, with a plain message and no crash to decode', async () => {
  const { az, calls } = fakeAz({
    usage: [
      { name: { value: 'cores', localizedValue: 'Total Regional vCPUs' }, currentValue: '0', limit: '10' },
      {
        name: { value: 'standardBsv2Family', localizedValue: 'Standard Bsv2 Family vCPUs' },
        currentValue: '0',
        limit: '0',
      },
    ],
  });
  await assert.rejects(new AzureProvider(az, settings).up(profile, ctx()), (e: Error) => {
    assert.match(
      e.message,
      /no vCPU quota for Standard_B2s_v2 in eastus2.*Standard Bsv2 Family vCPUs is 0.*needs 2.*Quotas/,
    );
    assert.match(e.message, /Nothing was made/);
    return true;
  });
  assert.equal(find(calls, 'group', 'create'), undefined, 'no resource group was made');
});

test('the total regional limit is checked too', () => {
  const sku = { ...OK_SKU };
  const usage = [
    { name: { value: 'cores' }, currentValue: 9, limit: 10 },
    { name: { value: 'standardBsv2Family' }, currentValue: 0, limit: 10 },
  ];
  assert.match(
    (checkQuota([sku], usage, 'Standard_B2s_v2', 'eastus') as { why: string }).why,
    /total vCPU limit for eastus is 10 \(9 in use\)/,
  );
  assert.deepEqual(
    checkQuota([sku], [], 'Standard_B2s_v2', 'eastus'),
    { ok: true },
    'when it cannot tell, it lets Azure decide',
  );
});

test('the slow size and usage lists are read once for a run, however many machines use the size', async () => {
  const { az, calls } = fakeAz();
  const p = new AzureProvider(az, settings, undefined, () => PASSWORD);
  await p.up(profile, ctx());
  await p.up({ ...profile, name: 'windows-server-2025' }, ctx('included'));
  assert.equal(calls.filter((c) => c[1] === 'list-skus').length, 1);
  assert.equal(calls.filter((c) => c[1] === 'list-usage').length, 1);
});

test('checkSize on its own: exact name, region restriction, zone restriction', () => {
  assert.deepEqual(checkSize([{ name: 'Standard_D2s_v5' }], 'standard_d2s_v5', 'eastus2'), { ok: true });
  assert.equal(checkSize([], 'X', 'eastus2').ok, false);
  assert.equal(
    checkSize([{ name: 'X', restrictions: [{ type: 'Location', reasonCode: 'r' }] }], 'X', 'eastus2').ok,
    false,
  );
});
test('when the machine cannot be made, the group is deleted and the error says so, without the password', async () => {
  const { az, calls } = fakeAz({ fail: (a) => a[0] === 'vm' && a[1] === 'create' });
  const p = new AzureProvider(az, settings, undefined, () => PASSWORD);
  await assert.rejects(p.up(profile, ctx()), (e: Error) => {
    assert.match(e.message, /The resource group was deleted/);
    assert.equal(e.message.includes(PASSWORD), false);
    return true;
  });
  assert.ok(find(calls, 'group', 'delete'));
});

test('when even the clean-up fails, the error names the group and when sweep will take it', async () => {
  const { az } = fakeAz({
    fail: (a) => (a[0] === 'vm' && a[1] === 'create') || (a[0] === 'group' && a[1] === 'delete'),
  });
  await assert.rejects(
    new AzureProvider(az, settings, undefined, () => PASSWORD).up(profile, ctx()),
    /may still exist.*sweep/,
  );
});

test('admin steps run as the admin user and system steps without a user', async () => {
  const { az, calls } = fakeAz();
  const p = new AzureProvider(az, settings, undefined, () => PASSWORD);
  const m = await p.up(profile, ctx());
  const script = { name: 'a.ps1', content: 'Write-Output hi' };
  const admin = await p.exec(m, script, 'admin', 60);
  assert.equal(admin.ran, true);
  assert.match(admin.output, /DONE/);
  const adminCreate = calls.filter((c) => c[0] === 'vm' && c[1] === 'run-command' && c[2] === 'create')[0];
  assert.equal(after(adminCreate ?? [], '--run-as-user'), 'azureuser');
  await p.exec(m, script, 'system', 60);
  const systemCreate = calls.filter((c) => c[0] === 'vm' && c[1] === 'run-command' && c[2] === 'create')[1];
  assert.equal(systemCreate?.includes('--run-as-user'), false);
  await assert.rejects(p.exec(m, script, 'root', 60), /not one of admin, system or user:NAME/);
});

test('a user:NAME step makes the account once, then runs the step through a task as that account, so its profile is loaded', async () => {
  const { az, calls } = fakeAz();
  const p = new AzureProvider(az, settings, undefined, () => PASSWORD);
  const m = await p.up(profile, ctx());
  const script = { name: 'a.ps1', content: 'Write-Output hi' };
  await p.exec(m, script, 'user:alice', 60, {
    parameters: { Greeting: 'hello' },
    protectedParameters: { Token: 'tok-1' },
  });
  await p.exec(m, script, 'user:alice', 60);
  const creates = calls.filter((c) => c[0] === 'vm' && c[1] === 'run-command' && c[2] === 'create');
  assert.equal(creates.length, 3, 'one account-making call, then one wrapper per step');
  // Nothing uses Azure's run-as-user, which does not load a profile (run 8): every call runs as the system account.
  for (const c of creates) assert.equal(c.includes('--run-as-user'), false);
  const made = creates[0] ?? [];
  assert.equal(after(made, '--parameters'), 'Name=alice');
  const pw = (after(made, '--protected-parameters') ?? '').replace(/^Pw=/, '');
  assert.ok(pw.length >= 20 && pw !== PASSWORD, 'a fresh password, not the admin one');
  // The wrapper gets the account, its password and the step's inputs, the secret ones protected.
  const first = creates[1] ?? [];
  const valuesAfter = (args: string[], flag: string): string => {
    const rest = args.slice(args.indexOf(flag) + 1);
    const end = rest.findIndex((a) => a.startsWith('--'));
    return (end < 0 ? rest : rest.slice(0, end)).join(' ');
  };
  assert.match(valuesAfter(first, '--parameters'), /^Name=alice/);
  assert.ok(valuesAfter(first, '--parameters').includes('TimeoutSeconds=60'));
  const hidden = valuesAfter(first, '--protected-parameters');
  assert.ok(hidden.includes(`Pw=${pw}`));
  assert.ok(hidden.includes('"Token":"tok-1"'), 'the inputs are in the protected arguments');
  assert.equal(
    valuesAfter(first, '--parameters').includes('tok-1'),
    false,
    'a secret is never in the plain parameters',
  );
  // The second step reuses the account, with the same password.
  const second = creates[2] ?? [];
  assert.ok(second.join(' ').includes(`Pw=${pw}`));
  // A second, different account gets a different password.
  await p.exec(m, script, 'user:bob', 60);
  const all = calls.filter((c) => c[1] === 'run-command' && c[2] === 'create');
  const bobMade = all.at(-2) ?? [];
  assert.equal(after(bobMade, '--parameters'), 'Name=bob');
  assert.ok(!valuesAfter(bobMade, '--protected-parameters').includes(pw));
});

test('the run-command calls name the command with --run-command-name, which is what Azure requires (run 3 failed on -n)', async () => {
  const { az, calls } = fakeAz();
  const p = new AzureProvider(az, settings, undefined, () => PASSWORD);
  const m = await p.up(profile, ctx());
  await p.exec(m, { name: 'a.ps1', content: 'x' }, 'system', 60);
  const rc = calls.filter((c) => c[0] === 'vm' && c[1] === 'run-command');
  assert.equal(rc.length, 2, 'create and show');
  for (const c of rc) {
    assert.equal(after(c, '--run-command-name'), 'vmlab-step-1');
    assert.equal(c.includes('-n'), false, 'the short flag is not accepted by this command');
    assert.equal(after(c, '--vm-name'), m.id.split('/')[1]);
  }
});

test('the script goes to az as a file, never inline, and the password is never in the plan text', async () => {
  const { az, calls } = fakeAz();
  const p = new AzureProvider(az, settings, undefined, () => PASSWORD);
  const m = await p.up(profile, ctx());
  await p.exec(m, { name: 'a.ps1', content: 'Write-Output "$(whoami)"; rm -rf /' }, 'system', 60);
  const create = calls.find((c) => c[2] === 'create' && c[1] === 'run-command');
  assert.match(after(create ?? [], '--script') ?? '', /^@/);
  assert.equal(JSON.stringify(p.plan(profile, ctx())).includes(PASSWORD), false);
});

test('down deletes the group and checks it is gone, and says so when it is not', async () => {
  const good = fakeAz();
  const p = new AzureProvider(good.az, settings, undefined, () => PASSWORD);
  await p.down(await p.up(profile, ctx()));
  assert.ok(find(good.calls, 'group', 'delete'));
  const stuck = fakeAz({ exists: 'true' });
  const q = new AzureProvider(stuck.az, settings, undefined, () => PASSWORD);
  await assert.rejects(q.down({ id: 'vmlab-3385-windows-11/vm3385', profile: 'windows-11' }), /still exists/);
});

test('sweep deletes only expired groups that are vmlab own: our prefix, and our tags', async () => {
  const { az, calls } = fakeAz({
    groups: [
      { name: 'vmlab-aaaa-windows-11', expires: '2026-11-23T10:00:00Z' }, // ours, expired
      { name: 'vmlab-bbbb-windows-11', expires: '2026-11-23T23:00:00Z' }, // ours, not yet
      { name: 'other-cccc', expires: '2026-11-23T10:00:00Z' }, // not our prefix
      { name: 'vmlab-dddd', expires: 'garbage' }, // unreadable expiry: left alone
    ],
  });
  const deleted = await new AzureProvider(az, settings).sweep(new Date('2026-11-23T12:00:00Z'));
  assert.deepEqual(deleted, ['vmlab-aaaa-windows-11']);
  assert.equal(calls.filter((c) => c[0] === 'group' && c[1] === 'delete').length, 1);
  const list = find(calls, 'group', 'list');
  assert.match(list?.join(' ') ?? '', /tags\.vmlab_expires != null && tags\.vmlab_run != null/);
});

test('a named subscription is passed on every call; none is passed when unnamed', async () => {
  const named = fakeAz();
  await new AzureProvider(named.az, { ...settings, subscription: 'sub-1' }, undefined, () => PASSWORD).up(
    profile,
    ctx(),
  );
  assert.ok(named.calls.every((c) => after(c, '--subscription') === 'sub-1'));
  const bare = fakeAz();
  await new AzureProvider(bare.az, settings, undefined, () => PASSWORD).up(profile, ctx());
  assert.ok(bare.calls.every((c) => !c.includes('--subscription')));
});

test('the plan says what would be made and never names the password', () => {
  const lines = new AzureProvider(fakeAz().az, settings).plan(profile, ctx());
  assert.match(lines.join('\n'), /resource group vmlab-3385-windows-11 in eastus2/);
  assert.match(lines.join('\n'), /no public address and no open ports/);
  assert.match(lines.join('\n'), /Windows_Client licence type/);
});

test('inputs go to the script as named parameters, and a protected one only as a protected parameter', async () => {
  const { az, calls } = fakeAz();
  const p = new AzureProvider(az, settings, undefined, () => PASSWORD);
  const m = await p.up(profile, ctx());
  await p.exec(m, { name: 'a.ps1', content: 'x' }, 'system', 60, {
    parameters: { Version: '1.2.3' },
    protectedParameters: { Token: 'shh-value-1234' },
  });
  const create = calls.find((c) => c[1] === 'run-command' && c[2] === 'create') ?? [];
  assert.equal(after(create, '--parameters'), 'Version=1.2.3');
  assert.equal(after(create, '--protected-parameters'), 'Token=shh-value-1234');
  assert.equal(
    create.join(' ').includes('--parameters Token'),
    false,
    'the secret is not among the plain parameters',
  );
});

test('a failure while a protected parameter was in play does not carry its value', async () => {
  const secret = 'shh-value-1234';
  const { az } = fakeAz({ fail: (a) => a[1] === 'run-command' && a[2] === 'create' });
  const p = new AzureProvider(az, settings, undefined, () => PASSWORD);
  const m = await p.up(profile, ctx());
  const err = await p
    .exec(m, { name: 'a.ps1', content: 'x' }, 'system', 60, { protectedParameters: { Token: secret } })
    .catch((e: Error) => e);
  assert.ok(err instanceof Error);
  assert.equal(err.message.includes(secret), false);
});

test('a restart restarts the machine, then waits until it is running and its agent is ready', async () => {
  const lines: string[] = [];
  let looks = 0;
  const calls: string[][] = [];
  const az: Az = async (args) => {
    calls.push(args);
    if (args[0] === 'vm' && args[1] === 'get-instance-view') {
      looks += 1;
      const ready = looks >= 3;
      return {
        stdout: JSON.stringify({
          statuses: [{ code: ready ? 'PowerState/running' : 'PowerState/starting' }],
          vmAgent: { statuses: [{ displayStatus: ready ? 'Ready' : 'Not Ready' }] },
        }),
        stderr: '',
      };
    }
    return fakeAz().az(args);
  };
  const p = new AzureProvider(
    az,
    settings,
    undefined,
    () => PASSWORD,
    new StepReporter({ write: (t) => lines.push(t) }),
    1,
  );
  const m = await p.up(profile, ctx());
  const res = await p.reboot(m, 30);
  assert.deepEqual(res, { ran: true });
  assert.ok(calls.some((c) => c[0] === 'vm' && c[1] === 'restart'));
  assert.equal(looks, 3, 'it looked until the machine was ready, and then stopped');
  assert.match(lines.join(''), /waiting for the machine to answer again/);
});

test('a machine that never comes back is an error that says how long it waited', async () => {
  const az: Az = async (args) => {
    if (args[0] === 'vm' && args[1] === 'get-instance-view') {
      return {
        stdout: JSON.stringify({ statuses: [{ code: 'PowerState/starting' }], vmAgent: { statuses: [] } }),
        stderr: '',
      };
    }
    return fakeAz().az(args);
  };
  const p = new AzureProvider(az, settings, undefined, () => PASSWORD, undefined, 1);
  const m = await p.up(profile, ctx());
  await assert.rejects(p.reboot(m, 0), /did not answer again within 0 seconds/);
});

// ---- the file exchange ----------------------------------------------------------------------------------------

/** A fake az that also answers the storage commands, and keeps the blobs it is given in a small table. */
function exchangeAz(
  extra: (args: string[]) => string | undefined = () => undefined,
  blobs: Record<string, string> = {},
) {
  const base = fakeAz();
  const log: string[][] = base.calls;
  const optionsSeen: { secrets?: string[] }[] = [];
  const az: Az = async (args, opts) => {
    log.push(args);
    optionsSeen.push(opts ?? {});
    if (args[0] === 'storage' && args[1] === 'blob' && args[2] === 'download') {
      const name = args[args.indexOf('-n') + 1] ?? '';
      await writeFile(args[args.indexOf('-f') + 1] ?? '', blobs[name.replace(/^vmlab-step-\d+-/, '')] ?? '');
      return { stdout: '', stderr: '' };
    }
    const hit = extra(args);
    if (hit !== undefined) return { stdout: hit, stderr: '' };
    const key = args.slice(0, 3).join(' ');
    if (key === 'storage account keys') return { stdout: 'THE-ACCOUNT-KEY-123\n', stderr: '' };
    if (key === 'storage blob generate-sas')
      return {
        stdout: `https://acct.blob.core.windows.net/exchange/${args[args.indexOf('-n') + 1]}?sig=SECRETSIG\n`,
        stderr: '',
      };
    if (args[0] === 'storage') return { stdout: '', stderr: '' };
    return base.az(args);
  };
  return { az, calls: log, optionsSeen };
}

test('the exchange is made inside the run, private, once, and its key stays on this computer', async () => {
  const { az, calls } = exchangeAz();
  const p = new AzureProvider(az, settings, undefined, () => PASSWORD);
  const m = await p.up(profile, ctx());
  await p.prepareExchange(m);
  await p.prepareExchange(m);
  const created = calls.filter((c) => c[0] === 'storage' && c[1] === 'account' && c[2] === 'create');
  assert.equal(created.length, 1, 'made once, however often it is asked for');
  const c = created[0] ?? [];
  assert.equal(after(c, '-g'), m.id.split('/')[0], 'inside the run resource group, so it is deleted with it');
  assert.equal(after(c, '--allow-blob-public-access'), 'false');
  assert.equal(after(c, '--min-tls-version'), 'TLS1_2');
  assert.match(after(c, '-n') ?? '', /^vl[0-9a-f]{16}$/);
  assert.ok(calls.some((x) => x[1] === 'container' && x[2] === 'create'));
});

test('a file goes up to the exchange, then onto the machine through a link that is passed as a protected parameter', async () => {
  const { az, calls } = exchangeAz();
  const p = new AzureProvider(az, settings, undefined, () => PASSWORD);
  const m = await p.up(profile, ctx());
  await p.prepareExchange(m);
  const res = await p.putFile(m, '/project/work/input/score.pdf', 'C:\\vmlab\\in\\score.pdf');
  assert.deepEqual(res, { ran: true });
  assert.ok(
    calls.some((c) => c[1] === 'blob' && c[2] === 'upload' && c.includes('/project/work/input/score.pdf')),
  );
  const sas = calls.find((c) => c[1] === 'blob' && c[2] === 'generate-sas') ?? [];
  assert.equal(after(sas, '--permissions'), 'r', 'a read-only link');
  assert.ok(sas.includes('--https-only'));
  const create = calls.filter((c) => c[1] === 'run-command' && c[2] === 'create').at(-1) ?? [];
  assert.match(
    after(create, '--protected-parameters') ?? '',
    /^Url=https:\/\/acct\.blob\.core\.windows\.net\/exchange\/in-\d+-score\.pdf\?sig=SECRETSIG$/,
  );
  assert.equal(after(create, '--parameters'), 'Dest=C:\\vmlab\\in\\score.pdf');
  assert.equal(
    create.includes('--output-blob-uri'),
    false,
    'the transfer script does not itself write to the exchange',
  );
});

test('a file comes back through a write-only link, as a .zip', async () => {
  const { az, calls } = exchangeAz();
  const p = new AzureProvider(az, settings, undefined, () => PASSWORD);
  const m = await p.up(profile, ctx());
  await p.prepareExchange(m);
  const dir = await mkdtemp(path.join(tmpdir(), 'vmlab-test-'));
  const dest = path.join(dir, 'results.zip');
  try {
    await p.getFile(m, 'C:\\vmlab\\out', dest);
    const sas = calls.filter((c) => c[1] === 'blob' && c[2] === 'generate-sas').at(-1) ?? [];
    assert.equal(after(sas, '--permissions'), 'acw', 'create and write, not read');
    const download = calls.find((c) => c[1] === 'blob' && c[2] === 'download') ?? [];
    assert.equal(after(download, '-f'), dest);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('with the exchange made, a script writes its whole output to storage and that is what comes back', async () => {
  const { az, calls } = exchangeAz(
    (a) =>
      a[1] === 'run-command' && a[2] === 'show'
        ? JSON.stringify({
            executionState: 'Succeeded',
            exitCode: 0,
            output: 'only the last 4 KB',
            error: '',
          })
        : undefined,
    { 'out.txt': 'the whole output, from the first line', 'err.txt': '' },
  );
  const p = new AzureProvider(az, settings, undefined, () => PASSWORD);
  const m = await p.up(profile, ctx());
  await p.prepareExchange(m);
  const res = await p.exec(m, { name: 'a.ps1', content: 'x' }, 'system', 60);
  const create = calls.filter((c) => c[1] === 'run-command' && c[2] === 'create').at(-1) ?? [];
  assert.match(after(create, '--output-blob-uri') ?? '', /exchange\/vmlab-step-\d+-out\.txt\?sig=/);
  assert.match(after(create, '--error-blob-uri') ?? '', /exchange\/vmlab-step-\d+-err\.txt\?sig=/);
  assert.equal(res.ran, true);
  assert.match(res.output ?? '', /the whole output, from the first line/);
  assert.doesNotMatch(res.output ?? '', /only the last 4 KB/);
});

test('once the exchange holds a key, every az call after it is told to scrub that key from its errors', async () => {
  const { az, optionsSeen } = exchangeAz();
  const p = new AzureProvider(az, settings, undefined, () => PASSWORD);
  const m = await p.up(profile, ctx());
  await p.prepareExchange(m);
  await p.putFile(m, '/p/x.pdf', 'C:\\x.pdf');
  const last = optionsSeen.at(-1);
  assert.ok(last?.secrets?.includes('THE-ACCOUNT-KEY-123'), 'the key is on the scrub list');
});
