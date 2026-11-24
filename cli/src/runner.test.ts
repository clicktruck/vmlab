import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { type Loaded, loadConfig } from './config.ts';
import { paths } from './fixtures.ts';
import { buildPlan } from './plan.ts';
import { StepReporter } from './progress.ts';
import type { ExecResult, Machine, Provider, RunContext, Script, ScriptInputs } from './provider.ts';
import { DryProvider } from './providers/dry.ts';
import { findSecrets, redact } from './record.ts';
import { evaluate, executeRun, exitCodeFor, summarise } from './runner.ts';
import type { Profile } from './schema.ts';
import { isScriptStep } from './schema.ts';

/** A provider the test controls: it returns what it is told, and writes down what was asked of it. */
class FakeProvider implements Provider {
  readonly name = 'fake';
  readonly calls: string[] = [];
  contexts: RunContext[] = [];
  private readonly exec_: (runAs: string) => Promise<ExecResult> | ExecResult;
  private readonly downFails: boolean;
  constructor(exec_: (runAs: string) => Promise<ExecResult> | ExecResult, downFails = false) {
    this.exec_ = exec_;
    this.downFails = downFails;
  }
  plan(): string[] {
    return [];
  }
  async up(profile: Profile, ctx: RunContext): Promise<Machine> {
    this.calls.push(`up ${profile.name}`);
    this.contexts.push(ctx);
    return { id: `fake-${profile.name}`, profile: profile.name };
  }
  inputsSeen: ScriptInputs[] = [];
  async exec(
    machine: Machine,
    _s: Script,
    runAs: string,
    _t: number,
    inputs: ScriptInputs = {},
  ): Promise<ExecResult> {
    this.calls.push(`exec ${machine.id} ${runAs}`);
    this.inputsSeen.push(inputs);
    return this.exec_(runAs);
  }
  async putFile(machine: Machine, local: string, remote: string): Promise<{ ran: boolean }> {
    this.calls.push(`putFile ${machine.id} ${path.basename(local)} -> ${remote}`);
    return { ran: true };
  }
  async getFile(machine: Machine, remote: string, local: string): Promise<{ ran: boolean }> {
    this.calls.push(`getFile ${machine.id} ${remote} -> ${path.basename(local)}`);
    return { ran: true };
  }
  async prepareExchange(machine: Machine): Promise<void> {
    this.calls.push(`prepareExchange ${machine.id}`);
  }
  async reboot(machine: Machine): Promise<{ ran: boolean }> {
    this.calls.push(`reboot ${machine.id}`);
    return { ran: true };
  }
  async down(machine: Machine): Promise<void> {
    this.calls.push(`down ${machine.id}`);
    if (this.downFails) throw new Error('the cloud said no');
  }
  async sweep(): Promise<string[]> {
    return [];
  }
}

async function ready(): Promise<Loaded> {
  const cfg = await loadConfig({ root: paths.root, local: false });
  cfg.root.attestations.windows_client_licence = {
    holds_eligible_licence: true,
    reference: 'case 123',
    note: 'test',
  };
  return cfg;
}

const GOOD: ExecResult = {
  ran: true,
  exitCode: 0,
  // What the access-list suite's checks look for: both scenarios, with each candidate fix leaving one entry.
  output: [
    'RUNNING AS: x',
    '=== SCENARIO 1: folder passes its entries down',
    '  H A,then remove others (logon SID)   protected=True entries=1 [x:F:own]',
    '  I replace whole list (restore)   protected=True entries=1 [x:F:own]',
    '=== SCENARIO 2: folder passes nothing down',
    '  H A,then remove others (logon SID)   protected=True entries=1 [x:F:own]',
    '  I replace whole list (restore)   protected=True entries=1 [x:F:own]',
    'DONE',
  ].join('\n'),
};

test('the checks a step asks for are applied to what came back', () => {
  const checks = evaluate(
    { exit_code: 0, output_contains: ['DONE'], output_not_contains: ['Exception'], output_matches: ['^RUN'] },
    0,
    'RUNNING\nDONE',
  );
  assert.ok(checks.every((c) => c.ok));
  assert.equal(
    evaluate({ output_contains: ['X'] }, 0, 'nothing').every((c) => c.ok),
    false,
  );
  assert.equal(
    evaluate({ output_matches: ['('] }, 0, 'x')[0]?.ok,
    false,
    'a bad pattern fails, it does not crash',
  );
});

test('every machine is made, used and deleted, and a pass is a pass', async () => {
  const cfg = await ready();
  const provider = new FakeProvider(() => GOOD);
  const record = await executeRun(cfg, buildPlan(cfg, 'windows-acl'), provider, { version: 'test' });
  assert.deepEqual(
    provider.calls.filter((c) => c.startsWith('up') || c.startsWith('down')),
    ['up windows-11', 'down fake-windows-11', 'up windows-server-2025', 'down fake-windows-server-2025'],
  );
  assert.ok(record.results.every((r) => r.status === 'pass'));
  assert.ok(record.cleanup.every((c) => c.deleted));
  // Each step ran as each user it names: admin and system, on both machines.
  assert.equal(record.results.length, 4);
});

test('a failing check is a failure, and the machine is still deleted', async () => {
  const cfg = await ready();
  const provider = new FakeProvider(() => ({ ran: true, exitCode: 0, output: 'Exception: boom' }));
  const record = await executeRun(cfg, buildPlan(cfg, 'windows-acl'), provider, { version: 'test' });
  assert.ok(record.results.every((r) => r.status === 'fail'));
  assert.equal(exitCodeFor(record), 1);
  assert.ok(provider.calls.includes('down fake-windows-11'));
});

test('a step that throws is a failure, and the machine is still deleted', async () => {
  const cfg = await ready();
  const provider = new FakeProvider(() => {
    throw new Error('the connection dropped');
  });
  const record = await executeRun(cfg, buildPlan(cfg, 'windows-acl'), provider, { version: 'test' });
  assert.ok(record.results.every((r) => r.status === 'fail'));
  assert.equal(provider.calls.filter((c) => c.startsWith('down')).length, 2);
});

test('a machine that could not be deleted is said loudly, and is a gap', async () => {
  const cfg = await ready();
  const provider = new FakeProvider(() => GOOD, true);
  const record = await executeRun(cfg, buildPlan(cfg, 'windows-acl'), provider, { version: 'test' });
  assert.ok(record.cleanup.every((c) => !c.deleted && /DELETE FAILED/.test(c.note)));
  assert.ok(record.gaps.some((g) => g.what === 'machine not deleted'));
  assert.equal(exitCodeFor(record), 4, 'passing but leaving a machine behind is not a clean pass');
});

test('delete: never leaves the machine, says how to delete it, and is not a clean pass', async () => {
  const cfg = await ready();
  cfg.root.lifetime.delete = 'never';
  const provider = new FakeProvider(() => GOOD);
  const record = await executeRun(cfg, buildPlan(cfg, 'windows-acl'), provider, { version: 'test' });
  assert.equal(provider.calls.filter((c) => c.startsWith('down')).length, 0);
  assert.match(record.cleanup[0]?.note ?? '', /LEFT IN PLACE/);
  assert.equal(exitCodeFor(record), 4);
});

test('the run is announced step by step, timed, and the record keeps the timeline', async () => {
  const cfg = await ready();
  const lines: string[] = [];
  const reporter = new StepReporter({ write: (l) => lines.push(l) });
  const record = await executeRun(cfg, buildPlan(cfg, 'windows-acl'), new FakeProvider(() => GOOD), {
    version: 'test',
    reporter,
  });
  const text = lines.join('\n');
  assert.match(text, /> windows-11: making the machine/);
  assert.match(text, /done: windows-11: running windows-acl\/experiments as admin \(\d/);
  assert.match(text, /done: windows-11: deleting the machine and checking it is gone/);
  assert.equal(
    record.timeline.length,
    8,
    'two machines, each: made, two scripts run (admin, system), deleted',
  );
  assert.match(summarise(record), /total processing time: /);
  assert.deepEqual(findSecrets(JSON.stringify(record)), []);
});

test('a profile that could not run is not-run, never a pass', async () => {
  const cfg = await loadConfig({ root: paths.root, local: false }); // no attestation
  const provider = new FakeProvider(() => GOOD);
  const record = await executeRun(cfg, buildPlan(cfg, 'windows-acl'), provider, { version: 'test' });
  const win11 = record.results.filter((r) => r.profile === 'windows-11');
  assert.ok(win11.length > 0 && win11.every((r) => r.status === 'not-run'));
  assert.equal(
    provider.calls.some((c) => c.includes('windows-11')),
    false,
    'nothing was made for it',
  );
  assert.equal(exitCodeFor(record), 4);
  assert.match(summarise(record), /GAP\s+windows-11 \/ windows-acl/);
});

test('the dry provider makes nothing and everything is a gap', async () => {
  const cfg = await ready();
  const record = await executeRun(cfg, buildPlan(cfg, 'windows-acl', 'dry'), new DryProvider(), {
    version: 'test',
  });
  assert.ok(record.results.every((r) => r.status === 'not-run'));
  assert.equal(exitCodeFor(record), 4);
});

test('the licence type is given to the provider only through the plan, and every object is tagged with its expiry', async () => {
  const cfg = await ready();
  const provider = new FakeProvider(() => GOOD);
  await executeRun(cfg, buildPlan(cfg, 'windows-acl'), provider, {
    version: 'test',
    now: () => new Date('2026-01-01T00:00:00Z'),
  });
  const win11 = provider.contexts.find((c) => c.licenceType === 'Windows_Client');
  assert.ok(win11);
  assert.equal(win11.expiresAt.toISOString(), '2026-01-01T01:00:00.000Z');
  assert.equal(win11.tags.vmlab_expires, '2026-01-01T01:00:00.000Z');
  assert.equal(provider.contexts.find((c) => c.licenceType === 'included')?.licenceType, 'included');
});

test('a secret never reaches the record: known values are blanked and token shapes are found', async () => {
  const cfg = await ready();
  const token = 'ghp_abcdefghijklmnopqrstuvwxyz0123456789';
  const provider = new FakeProvider(() => ({
    ran: true,
    exitCode: 0,
    output: `DONE using ${token} and RUNNING AS`,
  }));
  const record = await executeRun(cfg, buildPlan(cfg, 'windows-acl'), provider, {
    version: 'test',
    secrets: [token],
  });
  assert.equal(JSON.stringify(record).includes(token), false);
  assert.deepEqual(findSecrets(JSON.stringify(record)), []);
  assert.equal(redact('a ghp_abcdefghijklmnopqrstuvwxyz0123456789 b', []), 'a [redacted] b');
  assert.ok(findSecrets('password: "hunter2hunter2"').length > 0);
});

/** A suite made in the test, using the real script file, with a restart between two runs of it. */
async function withRebootSuite(cfg: Loaded) {
  const real = cfg.suites.get('windows-acl');
  assert.ok(real);
  const step = real.suite.steps[0];
  assert.ok(step && isScriptStep(step));
  cfg.suites.set('with-reboot', {
    dir: real.dir,
    suite: {
      name: 'with-reboot',
      description: 'x',
      os: 'windows',
      needs: { sources: [] },
      inputs: { Greeting: { default: 'hi' }, Token: { secret: true } },
      steps: [
        { ...step, id: 'before', run_as: ['system'], inputs: ['Greeting', 'Token'] },
        { id: 'restart', kind: 'reboot', timeout_seconds: 600 },
        { ...step, id: 'after', run_as: ['system'] },
      ],
    },
  });
  cfg.runs.set('with-reboot', {
    name: 'with-reboot',
    description: 'x',
    profiles: ['windows-server-2025'],
    sources: [],
    suites: [{ name: 'with-reboot', inputs: { Token: 'env:A_TEST_TOKEN' } }],
  });
}

test('a restart step restarts the machine between two scripts, in order, and counts as a pass', async () => {
  const cfg = await ready();
  await withRebootSuite(cfg);
  const env = { A_TEST_TOKEN: 'ghp_abcdefghijklmnopqrstuvwxyz0123456789' };
  const provider = new FakeProvider(() => GOOD);
  const record = await executeRun(cfg, buildPlan(cfg, 'with-reboot', undefined, env), provider, {
    version: 'test',
    env,
  });
  assert.deepEqual(
    provider.calls.filter((c) => !c.startsWith('up') && !c.startsWith('down')),
    [
      'exec fake-windows-server-2025 system',
      'reboot fake-windows-server-2025',
      'exec fake-windows-server-2025 system',
    ],
  );
  assert.deepEqual(
    record.results.map((r) => [r.step, r.runAs, r.status]),
    [
      ['before', 'system', 'pass'],
      ['restart', '-', 'pass'],
      ['after', 'system', 'pass'],
    ],
  );
});

test('inputs reach the script by name; a secret one is protected, and never appears in the record', async () => {
  const cfg = await ready();
  await withRebootSuite(cfg);
  const token = 'a-plain-secret-value-not-token-shaped';
  const env = { A_TEST_TOKEN: token };
  const provider = new FakeProvider(() => ({ ...GOOD, output: `${GOOD.output}\n${token}` }));
  const record = await executeRun(cfg, buildPlan(cfg, 'with-reboot', undefined, env), provider, {
    version: 'test',
    env,
  });
  assert.deepEqual(provider.inputsSeen[0], {
    parameters: { Greeting: 'hi' },
    protectedParameters: { Token: token },
  });
  assert.deepEqual(
    provider.inputsSeen[1],
    { parameters: {}, protectedParameters: {} },
    'a step that names no inputs gets none',
  );
  assert.equal(JSON.stringify(record).includes(token), false);
});

test('the dry provider does not restart anything, so a restart is a gap and not a pass', async () => {
  const cfg = await ready();
  await withRebootSuite(cfg);
  const env = { A_TEST_TOKEN: 'x'.repeat(12) };
  const record = await executeRun(cfg, buildPlan(cfg, 'with-reboot', 'dry', env), new DryProvider(), {
    version: 'test',
    env,
  });
  assert.equal(record.results.find((r) => r.step === 'restart')?.status, 'not-run');
  assert.equal(exitCodeFor(record), 4);
});

test('files go in before the suites and come back after, and the exchange is made first', async () => {
  const cfg = await ready();
  cfg.runs.set('with-files', {
    name: 'with-files',
    description: 'x',
    files: {
      in: [{ from: 'vmlab.yaml', to: 'C:\\vmlab\\in\\vmlab.yaml' }],
      out: [{ from: 'C:\\vmlab\\out', to: 'results' }],
    },
    profiles: ['windows-server-2025'],
    sources: [],
    suites: [{ name: 'windows-acl' }],
  });
  const provider = new FakeProvider(() => GOOD);
  const unzipped: string[] = [];
  const record = await executeRun(cfg, buildPlan(cfg, 'with-files'), provider, {
    version: 'test',
    unzip: async (zip, dest) => {
      unzipped.push(`${path.basename(zip)} -> ${path.basename(dest)}`);
    },
  });
  await rm(path.join(cfg.projectRoot, 'runs', record.id), { recursive: true, force: true });
  assert.deepEqual(
    provider.calls.map((c) => c.split(' ').slice(0, 1).join(' ')).filter((c) => c !== 'up' && c !== 'down'),
    ['prepareExchange', 'putFile', 'exec', 'exec', 'getFile'],
  );
  assert.deepEqual(unzipped, ['results.zip -> results']);
  assert.ok(record.results.some((r) => r.suite === '(files)' && r.status === 'pass'));
  assert.deepEqual(
    record.cleanup.map((c) => c.deleted),
    [true],
  );
});

test('a file that cannot be brought back is a gap, and the machine is still deleted', async () => {
  const cfg = await ready();
  cfg.runs.set('with-files', {
    name: 'with-files',
    description: 'x',
    files: { out: [{ from: 'C:\\vmlab\\out', to: 'results' }] },
    profiles: ['windows-server-2025'],
    sources: [],
    suites: [{ name: 'windows-acl' }],
  });
  const provider = new FakeProvider(() => GOOD);
  provider.getFile = async () => {
    throw new Error('nothing at C:\\vmlab\\out');
  };
  const record = await executeRun(cfg, buildPlan(cfg, 'with-files'), provider, { version: 'test' });
  await rm(path.join(cfg.projectRoot, 'runs', record.id), { recursive: true, force: true });
  assert.ok(record.gaps.some((g) => /was not brought back/.test(g.what) && /nothing at/.test(g.why)));
  assert.deepEqual(
    record.cleanup.map((c) => c.deleted),
    [true],
  );
  assert.equal(exitCodeFor(record), 4);
});

test('a run may read files only from inside the project, and only ones that exist', async () => {
  const cfg = await ready();
  cfg.runs.set('x', {
    name: 'x',
    description: 'x',
    files: {
      in: [
        { from: '../../etc/hosts', to: 'C:\\a' },
        { from: 'nope.pdf', to: 'C:\\b' },
        { from: 'vmlab.yaml', to: 'C:\\c' },
      ],
    },
    profiles: ['windows-server-2025'],
    sources: [],
    suites: [{ name: 'windows-acl' }],
  });
  const problems = buildPlan(cfg, 'x').problems.join('\n');
  assert.match(problems, /\.\.\/\.\.\/etc\/hosts/);
  assert.match(problems, /nope\.pdf does not exist/);
  assert.equal(/vmlab\.yaml/.test(problems), false);
});

function withSource(cfg: Loaded, tokenEnv: string | null) {
  cfg.root.policy.sources.allow = ['github.com/octocat/*'];
  cfg.sources.set('demo', {
    name: 'demo',
    type: 'git-github',
    repo: 'octocat/Hello-World',
    default_ref: 'master',
    auth: tokenEnv ? { token_env: tokenEnv } : null,
  });
  cfg.runs.set('with-source', {
    name: 'with-source',
    description: 'x',
    profiles: ['windows-server-2025'],
    sources: [{ name: 'demo' }],
    suites: [{ name: 'windows-acl' }],
  });
}

const SHA = 'b'.repeat(40);
const githubSays = (status: number, body: unknown) => async () => ({
  ok: status < 300,
  status,
  json: async () => body,
});

test('a source is pinned to one commit, fetched on each machine before the suites, and the commit is recorded', async () => {
  const cfg = await ready();
  withSource(cfg, 'DEMO_TOKEN');
  const token = 'a-plain-secret-value-not-token-shaped';
  const env = { DEMO_TOKEN: token };
  const provider = new FakeProvider(() => ({ ...GOOD, output: `${GOOD.output}\n${token}` }));
  const record = await executeRun(cfg, buildPlan(cfg, 'with-source', undefined, env), provider, {
    version: 'test',
    env,
    fetch: githubSays(200, { sha: SHA }),
  });
  assert.deepEqual(record.sources, [{ name: 'demo', repo: 'octocat/Hello-World', ref: 'master', sha: SHA }]);
  assert.deepEqual(provider.inputsSeen[0], {
    parameters: { Dest: 'C:\\vmlab\\src\\demo', Repo: 'octocat/Hello-World', Sha: SHA },
    protectedParameters: { Token: token },
  });
  const fetchStep = record.results.find((r) => r.suite === '(sources)');
  assert.equal(fetchStep?.status, 'pass');
  assert.equal(record.results.indexOf(fetchStep as never), 0, 'before any suite step');
  assert.equal(JSON.stringify(record).includes(token), false);
});

test('a public source sends no token at all', async () => {
  const cfg = await ready();
  withSource(cfg, null);
  const provider = new FakeProvider(() => GOOD);
  await executeRun(cfg, buildPlan(cfg, 'with-source'), provider, {
    version: 'test',
    fetch: githubSays(200, { sha: SHA }),
  });
  assert.deepEqual(provider.inputsSeen[0]?.protectedParameters, {});
});

test('a missing token, or a ref GitHub does not know, stops the run before any machine is made', async () => {
  const cfg = await ready();
  withSource(cfg, 'DEMO_TOKEN');
  const noToken = new FakeProvider(() => GOOD);
  const a = await executeRun(cfg, buildPlan(cfg, 'with-source', undefined, {}), noToken, {
    version: 'test',
    env: {},
  });
  assert.deepEqual(noToken.calls, [], 'nothing was made');
  assert.match(a.gaps.map((g) => g.why).join('\n'), /DEMO_TOKEN.*not set/);
  assert.equal(exitCodeFor(a), 4);

  const unknown = new FakeProvider(() => GOOD);
  const env = { DEMO_TOKEN: 'a-plain-secret-value-not-token-shaped' };
  const b = await executeRun(cfg, buildPlan(cfg, 'with-source', undefined, env), unknown, {
    version: 'test',
    env,
    fetch: githubSays(404, {}),
  });
  assert.deepEqual(unknown.calls, []);
  assert.match(b.gaps.map((g) => g.why).join('\n'), /404/);
  assert.equal(
    b.results.every((r) => r.status === 'not-run'),
    true,
  );
});

test('a source outside the policy is refused at the plan, so it is never looked up', async () => {
  const cfg = await ready();
  withSource(cfg, null);
  cfg.root.policy.sources.allow = ['github.com/someone-else/*'];
  assert.match(buildPlan(cfg, 'with-source').problems.join('\n'), /not allowed/);
});
