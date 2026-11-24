import assert from 'node:assert/strict';
import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { actions, type Ctx, makeProvider } from './actions.ts';
import { paths } from './fixtures.ts';
import { findSecrets } from './record.ts';

const action = (name: string) => {
  const a = actions.find((x) => x.name === name);
  assert.ok(a, `no action ${name}`);
  return a;
};

const ctx = (over: Partial<Ctx> = {}): Ctx => ({
  root: paths.root,
  configDirs: [],
  local: false,
  json: false,
  yes: false,
  provider: 'dry',
  confirm: async () => false,
  env: {},
  ...over,
});

test('the README lists every command the code has', async () => {
  const readme = await readFile(path.join(paths.root, 'README.md'), 'utf8');
  for (const a of actions) {
    assert.ok(readme.includes(`vmlab ${a.name}`), `README.md does not mention "vmlab ${a.name}"`);
  }
});

test('config check is clean on the repo, and says so', async () => {
  const r = await action('config check').run(ctx());
  assert.equal(r.exitCode, 0);
  assert.match(r.text, /Config is clean: 2 profiles, 7 suites, 1 sources, 7 runs/);
});

test('plan makes nothing and shows the gap for Windows 11', async () => {
  const r = await action('plan').run(ctx(), 'windows-acl');
  assert.equal(r.exitCode, 0);
  assert.match(r.text, /profile windows-11: GAP, will not run/);
  assert.match(r.text, /would make one windows machine "windows-server-2025"/);
});

test('plan of a missing run is a problem with a clear exit code', async () => {
  const r = await action('plan').run(ctx(), 'nope');
  assert.equal(r.exitCode, 2);
});

test('test without a yes makes nothing', async () => {
  const r = await action('test').run(ctx(), 'windows-acl');
  assert.equal(r.exitCode, 3);
  assert.match(r.text, /nothing was made/);
});

test('test with a yes on the dry provider runs, records, and is not a pass', async () => {
  const r = await action('test').run(ctx({ yes: true }), 'windows-acl');
  assert.equal(r.exitCode, 4, 'nothing ran, so this is a gap, not a pass');
  assert.match(r.text, /GAP\s+windows-server-2025 \/ windows-acl/);
  const file = /Record: (\S+)/.exec(r.text)?.[1];
  assert.ok(file);
  const text = await readFile(path.join(paths.root, file), 'utf8');
  assert.deepEqual(findSecrets(text), []);
  await rm(path.dirname(path.join(paths.root, file)), { recursive: true });
});

test('an unknown provider is refused and makes nothing', async () => {
  assert.throws(() => makeProvider('nope'), /unknown provider "nope"/);
  const r = await action('plan').run(ctx({ provider: 'nope' }), 'windows-acl');
  assert.equal(r.exitCode, 2);
  assert.match(r.text, /unknown provider/);
});

test('sweep with the dry provider and no yes deletes nothing', async () => {
  const r = await action('sweep').run(ctx());
  assert.equal(r.exitCode, 3);
  const done = await action('sweep').run(ctx({ yes: true }));
  assert.equal(done.exitCode, 0);
});
