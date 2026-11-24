import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FETCH_SOURCE_SCRIPT, type Fetch, resolveSha, sourceDir } from './sources.ts';

const SHA = 'a'.repeat(40);
const src = { name: 'demo', repo: 'octocat/Hello-World', ref: 'master', tokenEnv: null };

function fakeFetch(
  status: number,
  body: unknown,
): { fetch: Fetch; seen: { url: string; headers: Record<string, string> }[] } {
  const seen: { url: string; headers: Record<string, string> }[] = [];
  const fetch: Fetch = async (url, init) => {
    seen.push({ url, headers: init.headers });
    return { ok: status >= 200 && status < 300, status, json: async () => body };
  };
  return { fetch, seen };
}

test('a ref becomes one exact commit id, asked of GitHub by name', async () => {
  const { fetch, seen } = fakeFetch(200, { sha: SHA });
  const got = await resolveSha(src, null, fetch);
  assert.deepEqual(got, { name: 'demo', repo: 'octocat/Hello-World', ref: 'master', sha: SHA });
  assert.equal(seen[0]?.url, 'https://api.github.com/repos/octocat/Hello-World/commits/master');
  assert.equal(seen[0]?.headers.Authorization, undefined, 'no token, no Authorization header');
});

test('a ref with a slash is encoded, so it stays one path piece', async () => {
  const { fetch, seen } = fakeFetch(200, { sha: SHA });
  await resolveSha({ ...src, ref: 'feature/x y' }, null, fetch);
  assert.match(seen[0]?.url ?? '', /\/commits\/feature%2Fx%20y$/);
});

test('a token is sent as a header, and is never in an error message', async () => {
  const token = 'tok-12345678901234567890';
  const { fetch, seen } = fakeFetch(404, {});
  await assert.rejects(resolveSha(src, token, fetch), (e: Error) => {
    assert.match(e.message, /404/);
    assert.match(e.message, /private/);
    assert.equal(e.message.includes(token), false);
    return true;
  });
  assert.equal(seen[0]?.headers.Authorization, `Bearer ${token}`);
});

test('a refused token and a made-up answer are both plain errors', async () => {
  await assert.rejects(resolveSha(src, 'x', fakeFetch(401, {}).fetch), /401.*token was refused/);
  await assert.rejects(
    resolveSha(src, null, fakeFetch(200, { sha: 'not-a-sha' }).fetch),
    /did not return a commit id/,
  );
});

test('a source lands in a folder named for it, under one root', () => {
  assert.equal(sourceDir('demo'), 'C:\\vmlab\\src\\demo');
});

test('the fetch script takes only a repo and a full commit id, and the token only as a parameter', () => {
  assert.match(FETCH_SOURCE_SCRIPT, /\$Sha -notmatch '\^\[0-9a-f\]\{40\}\$'/);
  assert.match(FETCH_SOURCE_SCRIPT, /\[string\]\$Token = ''/);
  assert.equal(
    /Write-Host.*\$Token|\$Token.*Out-File/.test(FETCH_SOURCE_SCRIPT),
    false,
    'the token is never printed or saved',
  );
});
