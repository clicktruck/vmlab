import assert from 'node:assert/strict';
import { test } from 'node:test';
import { type Loaded, loadConfig } from './config.ts';
import { paths } from './fixtures.ts';
import { buildPlan, describePlan } from './plan.ts';

async function base(): Promise<Loaded> {
  return loadConfig({ root: paths.root, local: false });
}

test('without the attestation, Windows 11 is a gap with its reason, and Server 2025 still runs', async () => {
  const plan = buildPlan(await base(), 'windows-acl');
  const win11 = plan.profiles.find((p) => p.name === 'windows-11');
  assert.equal(win11?.status, 'gap');
  assert.match(win11?.reason ?? '', /windows_client_licence/);
  assert.equal(plan.profiles.find((p) => p.name === 'windows-server-2025')?.status, 'ready');
  assert.ok(plan.gaps.some((g) => g.profile === 'windows-11'));
  assert.deepEqual(plan.problems, []);
});

test('with the attestation, Windows 11 is ready and the plan records what the person set', async () => {
  const cfg = await base();
  cfg.root.attestations.windows_client_licence = {
    holds_eligible_licence: true,
    reference: 'case 123',
    note: 'confirmed by a person',
  };
  const plan = buildPlan(cfg, 'windows-acl');
  assert.equal(plan.profiles.find((p) => p.name === 'windows-11')?.status, 'ready');
  assert.equal(plan.profiles.find((p) => p.name === 'windows-11')?.licenceType, 'Windows_Client');
  assert.equal(plan.attestations.windows_client_licence?.note, 'confirmed by a person');
  assert.equal(plan.attestations.windows_client_licence?.reference, 'case 123');
  assert.match(
    describePlan(plan),
    /attestation windows_client_licence: you state you hold it; reference: case 123/,
  );
  cfg.root.attestations.windows_client_licence.reference = '';
  assert.match(describePlan(buildPlan(cfg, 'windows-acl')), /reference: \(none yet\)/);
});

test('an unknown cost is a gap, never zero', async () => {
  const plan = buildPlan(await base(), 'windows-acl');
  assert.equal(plan.estimatedUsd, null);
  assert.ok(plan.gaps.some((g) => g.what === 'cost unknown'));
});

test('a known cost over the budget line stops the run', async () => {
  const cfg = await base();
  const server = cfg.profiles.get('windows-server-2025');
  assert.ok(server);
  server.estimated_usd_per_hour = 50;
  const plan = buildPlan(cfg, 'windows-acl');
  assert.match(plan.problems.join('\n'), /over the budget line/);
});

test('a source outside the policy stops the run, and the default policy allows nothing', async () => {
  const cfg = await base();
  cfg.runs.set('with-source', {
    name: 'with-source',
    description: 'x',
    profiles: ['windows-server-2025'],
    sources: [{ name: 'example' }],
    suites: [{ name: 'windows-acl' }],
  });
  assert.match(buildPlan(cfg, 'with-source').problems.join('\n'), /not allowed/);
  cfg.root.policy.sources.allow = ['github.com/octocat/*'];
  assert.deepEqual(buildPlan(cfg, 'with-source').problems, []);
});

test('a suite for another operating system is a gap on that profile', async () => {
  const cfg = await base();
  const suite = cfg.suites.get('windows-acl');
  assert.ok(suite);
  suite.suite.os = 'linux';
  const plan = buildPlan(cfg, 'windows-acl');
  assert.ok(plan.profiles.every((p) => p.status === 'gap'));
  assert.match(plan.problems.join('\n'), /no profile can run/);
});

test('a missing run is a problem, and the description names gaps and problems', async () => {
  const cfg = await base();
  assert.match(buildPlan(cfg, 'nope').problems.join(''), /no run named "nope"/);
  const text = describePlan(buildPlan(cfg, 'windows-acl'));
  assert.match(text, /GAP \[windows-11\]/);
});

test('an input that does not exist, or a secret written in a file, stops the run before anything is made', async () => {
  const cfg = await base();
  const suite = cfg.suites.get('windows-acl');
  assert.ok(suite);
  suite.suite.inputs = { Token: { secret: true } };
  const step = suite.suite.steps[0];
  assert.ok(step && !('kind' in step));
  step.inputs = ['Token'];
  cfg.runs.set('x', {
    name: 'x',
    description: 'x',
    profiles: ['windows-server-2025'],
    sources: [],
    suites: [{ name: 'windows-acl', inputs: { Token: 'written-in-the-file', Other: 'y' } }],
  });
  const problems = buildPlan(cfg, 'x').problems.join('\n');
  assert.match(problems, /secret, so it must be given as env:NAME/);
  assert.match(problems, /no input named "Other"/);
});
