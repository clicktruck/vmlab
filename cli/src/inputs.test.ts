import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveInputs } from './inputs.ts';
import type { Suite } from './schema.ts';

const suite: Suite = {
  name: 's',
  description: 'x',
  os: 'windows',
  needs: { sources: [] },
  inputs: { Version: { default: '1.2.3' }, Url: {}, Token: { secret: true } },
  steps: [{ id: 'a', kind: 'reboot', timeout_seconds: 5 }],
};

test('a value comes from the run, else the default; env:NAME is read from the environment', () => {
  const r = resolveInputs(
    suite,
    ['Version', 'Url'],
    { Url: 'env:THE_URL' },
    { THE_URL: 'https://example.test/x' },
  );
  assert.deepEqual(r.problems, []);
  assert.deepEqual(r.parameters, { Version: '1.2.3', Url: 'https://example.test/x' });
});

test('a secret input can only be given as env:NAME, and then it is a protected parameter', () => {
  assert.match(
    resolveInputs(suite, ['Token'], { Token: 'literal-secret' }, {}).problems.join(),
    /must be given as env:NAME/,
  );
  const ok = resolveInputs(suite, ['Token'], { Token: 'env:TOKEN_VAR' }, { TOKEN_VAR: 'shh-value' });
  assert.deepEqual(ok.problems, []);
  assert.deepEqual(ok.protectedParameters, { Token: 'shh-value' });
  assert.deepEqual(ok.parameters, {});
});

test('a missing value, an unset variable and an unknown name are each a problem that says which', () => {
  assert.match(resolveInputs(suite, ['Url'], {}, {}).problems.join(), /input "Url".*has no value/);
  assert.match(
    resolveInputs(suite, ['Token'], { Token: 'env:NOPE' }, {}).problems.join(),
    /environment variable NOPE is not set/,
  );
  assert.match(resolveInputs(suite, [], { Mystery: 'x' }, {}).problems.join(), /no input named "Mystery"/);
  assert.match(resolveInputs(suite, ['Ghost'], {}, {}).problems.join(), /does not declare/);
});

test('an input written as an empty string is a choice, not a missing variable: it is simply not sent', () => {
  const suite = {
    name: 's',
    description: 'x',
    os: 'windows' as const,
    needs: { sources: [] },
    inputs: { Url: { default: 'https://example.test/x' }, Hash: {} },
    steps: [],
  };
  const r = resolveInputs(suite, ['Url', 'Hash'], { Hash: '' }, {});
  assert.deepEqual(r.problems, []);
  assert.deepEqual(r.parameters, { Url: 'https://example.test/x' });
  // An environment variable that is set but empty is still a mistake.
  const e = resolveInputs(suite, ['Hash'], { Hash: 'env:NOPE' }, { NOPE: '' });
  assert.match(e.problems.join('\n'), /the environment variable NOPE is not set/);
});
