import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { ConfigError, deepMerge, loadConfig } from './config.ts';
import { repoRoot } from './paths.ts';
import { isScriptStep } from './schema.ts';

/** A copy of the repo's real config in a temp folder, so a test can break it without touching the repo. */
async function sandbox(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'vmlab-'));
  await cp(path.join(repoRoot(), 'vmlab.yaml'), path.join(dir, 'vmlab.yaml'));
  await cp(path.join(repoRoot(), 'config'), path.join(dir, 'config'), { recursive: true });
  return dir;
}

test('every example the repo ships is valid, and the run names resolve', async () => {
  const cfg = await loadConfig({ root: repoRoot(), local: false });
  assert.ok(cfg.profiles.has('windows-11'));
  assert.ok(cfg.profiles.has('windows-server-2025'));
  assert.ok(cfg.suites.has('windows-acl'));
  assert.ok(cfg.runs.has('windows-acl'));
  assert.equal(
    cfg.root.attestations.windows_client_licence.holds_eligible_licence,
    false,
    'the shipped default is not an attestation',
  );
});

test('every script a suite names exists, and holds the words the suite expects to see in its output', async () => {
  const cfg = await loadConfig({ root: repoRoot(), local: false });
  for (const { suite, dir } of cfg.suites.values()) {
    for (const step of suite.steps) {
      if (!isScriptStep(step)) continue;
      const text = await readFile(path.join(dir, step.script), 'utf8').catch(() => null);
      assert.ok(text !== null, `${suite.name}/${step.id}: ${step.script} does not exist`);
      for (const word of step.expect.output_contains ?? []) {
        assert.ok(text.includes(word), `${suite.name}/${step.id}: the script never prints "${word}"`);
      }
    }
  }
});

test('a bad value is reported with the file and the line', async () => {
  const dir = await sandbox();
  const file = path.join(dir, 'config', 'profiles', 'windows-11.yaml');
  const text = (await readFile(file, 'utf8')).replace(/^size: .*$/m, 'size: 42');
  await writeFile(file, text);
  await assert.rejects(loadConfig({ root: dir, local: false }), (e: unknown) => {
    assert.ok(e instanceof ConfigError);
    assert.match(e.problems.join('\n'), /config\/profiles\/windows-11\.yaml line \d+: size: /);
    return true;
  });
});

test('an unknown key is refused, so a typo cannot be silently ignored', async () => {
  const dir = await sandbox();
  const file = path.join(dir, 'vmlab.yaml');
  await writeFile(file, `${await readFile(file, 'utf8')}\nbudgett: {}\n`);
  await assert.rejects(loadConfig({ root: dir, local: false }), /budgett/);
});

test('a name must match its file name', async () => {
  const dir = await sandbox();
  const file = path.join(dir, 'config', 'runs', 'windows-acl.yaml');
  await writeFile(file, (await readFile(file, 'utf8')).replace('name: windows-acl', 'name: other'));
  await assert.rejects(loadConfig({ root: dir, local: false }), /must match the file name "windows-acl"/);
});

test('a run that names a missing profile is refused before anything is made', async () => {
  const dir = await sandbox();
  const file = path.join(dir, 'config', 'runs', 'windows-acl.yaml');
  await writeFile(file, (await readFile(file, 'utf8')).replace('windows-server-2025', 'nope'));
  await assert.rejects(loadConfig({ root: dir, local: false }), /no profile named "nope"/);
});

test('vmlab.local.yaml overrides the defaults, and is ignored when asked', async () => {
  const dir = await sandbox();
  await writeFile(
    path.join(dir, 'vmlab.local.yaml'),
    'attestations:\n  windows_client_licence:\n    holds_eligible_licence: true\n    note: "checked"\n',
  );
  const withLocal = await loadConfig({ root: dir });
  assert.equal(withLocal.root.attestations.windows_client_licence.holds_eligible_licence, true);
  assert.equal(withLocal.root.attestations.windows_client_licence.note, 'checked');
  const without = await loadConfig({ root: dir, local: false });
  assert.equal(without.root.attestations.windows_client_licence.holds_eligible_licence, false);
});

test('a later config directory wins over an earlier one, by name', async () => {
  const dir = await sandbox();
  const extra = path.join(dir, 'mine');
  await cp(path.join(dir, 'config', 'profiles'), path.join(extra, 'profiles'), { recursive: true });
  const file = path.join(extra, 'profiles', 'windows-server-2025.yaml');
  await writeFile(file, (await readFile(file, 'utf8')).replace(/^size: .*$/m, 'size: Standard_D2s_v5'));
  const cfg = await loadConfig({ root: dir, local: false, configDirs: ['mine'] });
  assert.equal(cfg.profiles.get('windows-server-2025')?.size, 'Standard_D2s_v5');
});

test('objects merge key by key and arrays are replaced', () => {
  assert.deepEqual(deepMerge({ a: { b: 1, c: 2 }, l: [1, 2] }, { a: { b: 9 }, l: [3] }), {
    a: { b: 9, c: 2 },
    l: [3],
  });
});
