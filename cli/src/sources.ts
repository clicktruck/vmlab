// Fetching a source onto a machine, at one exact commit. Two parts:
//  1. This computer turns the ref (a branch, a tag, a pull request head) into a commit id, so the run records what
//     it really tested and the machine cannot be handed something that moved in between.
//  2. The machine downloads that commit as a zip from GitHub and unpacks it to C:\vmlab\src\<name>. A token, if the
//     source needs one, is read from your environment, is passed as a protected parameter, and is never written down.
// What may be fetched is decided before this, by the policy (policy.ts). Nothing here widens it.
import type { PlanSource } from './plan.ts';

export type Fetch = (
  url: string,
  init: { headers: Record<string, string> },
) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

export type ResolvedSource = { name: string; repo: string; ref: string; sha: string };

export const SOURCE_ROOT = 'C:\\vmlab\\src';

/** Where a source lands on the machine. The name is a plain name (the schema checks it), so this cannot escape. */
export const sourceDir = (name: string): string => `${SOURCE_ROOT}\\${name}`;

/** Asks GitHub which commit a ref points at. Throws a plain message; the token is never in it. */
export async function resolveSha(
  source: PlanSource,
  token: string | null,
  fetchFn: Fetch = fetch as unknown as Fetch,
): Promise<ResolvedSource> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'vmlab',
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const url = `https://api.github.com/repos/${source.repo}/commits/${encodeURIComponent(source.ref)}`;
  const res = await fetchFn(url, { headers });
  if (!res.ok) {
    const hint =
      res.status === 404
        ? ' (no such repo or ref, or it is private and no token was given)'
        : res.status === 401 || res.status === 403
          ? ' (the token was refused, or the rate limit was reached)'
          : '';
    throw new Error(`GitHub said ${res.status} when looking up ${source.repo} at ${source.ref}${hint}`);
  }
  const body = (await res.json()) as { sha?: unknown };
  if (typeof body.sha !== 'string' || !/^[0-9a-f]{40}$/.test(body.sha)) {
    throw new Error(`GitHub did not return a commit id for ${source.repo} at ${source.ref}`);
  }
  return { name: source.name, repo: source.repo, ref: source.ref, sha: body.sha };
}

/** Windows PowerShell: download one commit as a zip and unpack it so the files sit directly in Dest. */
export const FETCH_SOURCE_SCRIPT = `param([Parameter(Mandatory)][string]$Dest, [Parameter(Mandatory)][string]$Repo, [Parameter(Mandatory)][string]$Sha, [string]$Token = '')
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
if ($Repo -notmatch '^[\\w.-]+/[\\w.-]+$' -or $Sha -notmatch '^[0-9a-f]{40}$') { throw 'bad repo or commit id' }
$work = Join-Path $env:TEMP ('vmlab-src-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force $work | Out-Null
$zip = Join-Path $work 'source.zip'
$headers = @{ 'User-Agent' = 'vmlab'; 'Accept' = 'application/vnd.github+json' }
if ($Token) { $headers['Authorization'] = 'Bearer ' + $Token }
Invoke-WebRequest -Uri ('https://api.github.com/repos/' + $Repo + '/zipball/' + $Sha) -Headers $headers -OutFile $zip -UseBasicParsing
Expand-Archive -Path $zip -DestinationPath $work -Force
$top = Get-ChildItem -Directory $work | Select-Object -First 1
if (Test-Path $Dest) { Remove-Item -Recurse -Force $Dest }
New-Item -ItemType Directory -Force $Dest | Out-Null
Get-ChildItem -Force $top.FullName | Move-Item -Destination $Dest
$count = (Get-ChildItem -Recurse -File $Dest | Measure-Object).Count
Remove-Item -Recurse -Force $work
'fetched ' + $Repo + ' at ' + $Sha + ': ' + $count + ' files in ' + $Dest
`;
