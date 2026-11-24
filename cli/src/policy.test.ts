import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkSource, globToRegExp, refAllowed, sourceAllowed } from './policy.ts';

test('the default allows nothing', () => {
  assert.equal(sourceAllowed([], 'octocat/Hello-World'), false);
  assert.match(checkSource({ allow: [], refs: ['*'] }, 'octocat/Hello-World', 'main') ?? '', /not allowed/);
});

test('a rule matches an owner, and * stays inside one segment', () => {
  assert.equal(sourceAllowed(['github.com/octocat/*'], 'octocat/Hello-World'), true);
  assert.equal(sourceAllowed(['github.com/octocat/*'], 'someone-else/Hello-World'), false);
  assert.equal(sourceAllowed(['github.com/octocat/*'], 'octocat/a/b'), false);
  assert.equal(sourceAllowed(['github.com/octocat/Hello-World'], 'octocat/Hello-World'), true);
  assert.equal(sourceAllowed(['github.com/octocat/Hello-World'], 'octocat/Hello-World2'), false);
});

test('a dot in a rule is a dot, not any character', () => {
  assert.equal(sourceAllowed(['github.com/octocat/a.b'], 'octocat/axb'), false);
  assert.equal(sourceAllowed(['github.com/octocat/a.b'], 'octocat/a.b'), true);
});

test('refs: a lone * allows anything, pull-request refs match their pattern', () => {
  assert.equal(refAllowed(['*'], 'fix/windows-private-token'), true);
  assert.equal(refAllowed(['main', 'refs/pull/*/head'], 'refs/pull/68/head'), true);
  assert.equal(refAllowed(['main', 'refs/pull/*/head'], 'refs/pull/68/merge'), false);
  assert.equal(refAllowed(['main'], 'main2'), false);
  assert.equal(globToRegExp('fix/**').test('fix/a/b'), true);
});

test('checkSource says which rule refused', () => {
  const policy = { allow: ['github.com/octocat/*'], refs: ['main'] };
  assert.equal(checkSource(policy, 'octocat/x', 'main'), null);
  assert.match(checkSource(policy, 'octocat/x', 'dev') ?? '', /ref "dev"/);
});
