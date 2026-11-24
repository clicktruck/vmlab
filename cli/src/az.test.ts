import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AzError } from './az.ts';

test('an error never carries the arguments, so a password in them cannot leak', () => {
  const password = 'Xk3-very-secret-PassW0rd';
  const args = ['vm', 'create', '--admin-password', password, '--name', 'x'];
  const e = new AzError(args, `ERROR: the value ${password} is not valid`, [password]);
  assert.equal(e.message.includes(password), false);
  assert.match(e.message, /^az vm create failed: /);
  assert.equal(e.message.includes('--admin-password'), false);
});

test('a token-shaped string in the CLI message is scrubbed even when it was not named as a secret', () => {
  const e = new AzError(['x'], 'bad token ghp_abcdefghijklmnopqrstuvwxyz0123456789 here', []);
  assert.equal(e.message.includes('ghp_'), false);
});

test('a long message is cut, and an empty one still says something', () => {
  assert.ok(new AzError(['a', 'b'], 'x'.repeat(5000), []).message.length < 800);
  assert.match(new AzError(['a'], '', []).message, /no message/);
});

test('a traceback keeps its first line and its last two, because the real error is usually at the end', () => {
  const stderr = [
    'ERROR: unexpected',
    'Traceback',
    'line a',
    'line b',
    'line c',
    'ValueError: the real reason',
    'ERROR: last',
  ].join('\n');
  const m = new AzError(['vm', 'create'], stderr, []).message;
  assert.match(m, /ERROR: unexpected.*the real reason.*ERROR: last/);
  assert.equal(m.includes('line b'), false);
});
