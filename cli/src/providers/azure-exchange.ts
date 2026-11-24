// The exchange: a small storage area made inside a run's resource group, used to move files to and from the machine
// and to bring back a script's whole output (Run Command itself returns only about 4 KB). It is deleted with the
// resource group, so nothing outlives the run. Nothing is public: a file is reached only through a link that is valid
// for two hours and allows one thing (read, or write) on one name. The account key never leaves this computer.
import { randomBytes } from 'node:crypto';
import type { Az } from '../az.ts';

const CONTAINER = 'exchange';
const HOURS = 2;

export type ExchangeSettings = { rg: string; location: string; subscription: string | null };

export class AzureExchange {
  private readonly az: Az;
  private readonly where: ExchangeSettings;
  private account = '';
  private key = '';
  private ready: Promise<void> | null = null;

  constructor(az: Az, where: ExchangeSettings) {
    this.az = az;
    this.where = where;
  }

  private sub(args: string[]): string[] {
    return this.where.subscription ? [...args, '--subscription', this.where.subscription] : args;
  }

  private run(args: string[]) {
    return this.az(this.sub(args), { secrets: this.key ? [this.key] : [] });
  }

  /** Makes the storage account and its one private container, once. */
  ensure(): Promise<void> {
    this.ready ??= (async () => {
      // 3 to 24 lower-case letters and digits, and unique across Azure.
      this.account = `vl${randomBytes(8).toString('hex')}`;
      await this.run([
        'storage',
        'account',
        'create',
        '-g',
        this.where.rg,
        '-n',
        this.account,
        '-l',
        this.where.location,
        '--sku',
        'Standard_LRS',
        '--kind',
        'StorageV2',
        '--allow-blob-public-access',
        'false',
        '--min-tls-version',
        'TLS1_2',
        '--https-only',
        'true',
        '-o',
        'none',
      ]);
      this.key = (
        await this.run([
          'storage',
          'account',
          'keys',
          'list',
          '-g',
          this.where.rg,
          '--account-name',
          this.account,
          '--query',
          '[0].value',
          '-o',
          'tsv',
        ])
      ).stdout.trim();
      await this.run([
        'storage',
        'container',
        'create',
        '-n',
        CONTAINER,
        '--account-name',
        this.account,
        '--account-key',
        this.key,
        '-o',
        'none',
      ]);
    })();
    return this.ready;
  }

  private expiry(): string {
    return `${new Date(Date.now() + HOURS * 3600_000).toISOString().slice(0, 16)}Z`;
  }

  /**
   * A link to one blob that allows only what `permissions` says: r to read; acw to create and write; racw for a
   * script's output, because Azure's Run Command asks for read as well when it appends to the blob (run 14 got
   * nothing back with acw).
   */
  async link(blob: string, permissions: 'r' | 'acw' | 'racw'): Promise<string> {
    await this.ensure();
    const out = await this.run([
      'storage',
      'blob',
      'generate-sas',
      '--account-name',
      this.account,
      '--account-key',
      this.key,
      '-c',
      CONTAINER,
      '-n',
      blob,
      '--permissions',
      permissions,
      '--expiry',
      this.expiry(),
      '--https-only',
      '--full-uri',
      '-o',
      'tsv',
    ]);
    return out.stdout.trim().replace(/^"|"$/g, '');
  }

  async upload(localPath: string, blob: string): Promise<void> {
    await this.ensure();
    await this.run([
      'storage',
      'blob',
      'upload',
      '--account-name',
      this.account,
      '--account-key',
      this.key,
      '-c',
      CONTAINER,
      '-n',
      blob,
      '-f',
      localPath,
      '--overwrite',
      '--no-progress',
      '-o',
      'none',
    ]);
  }

  async download(blob: string, localPath: string): Promise<void> {
    await this.ensure();
    await this.run([
      'storage',
      'blob',
      'download',
      '--account-name',
      this.account,
      '--account-key',
      this.key,
      '-c',
      CONTAINER,
      '-n',
      blob,
      '-f',
      localPath,
      '--no-progress',
      '-o',
      'none',
    ]);
  }

  /** The secrets this exchange holds, so a caller can scrub them from messages. */
  secrets(): string[] {
    return this.key ? [this.key] : [];
  }
}

/** Windows PowerShell that downloads one file from a link. Both values arrive as parameters, the link protected. */
export const DOWNLOAD_SCRIPT = `param([Parameter(Mandatory)][string]$Dest, [Parameter(Mandatory)][string]$Url)
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
New-Item -ItemType Directory -Force (Split-Path -Parent $Dest) | Out-Null
Invoke-WebRequest -Uri $Url -OutFile $Dest -UseBasicParsing
'downloaded ' + (Get-Item $Dest).Length + ' bytes to ' + $Dest
`;

/** Windows PowerShell that zips a file or a folder's contents and sends it to a link. */
export const UPLOAD_SCRIPT = `param([Parameter(Mandatory)][string]$Path, [Parameter(Mandatory)][string]$Url)
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
if (-not (Test-Path $Path)) { throw "nothing at $Path" }
$zip = Join-Path $env:TEMP ('vmlab-out-' + [guid]::NewGuid().ToString('N') + '.zip')
if (Test-Path -PathType Container $Path) { Compress-Archive -Path (Join-Path $Path '*') -DestinationPath $zip -Force } else { Compress-Archive -Path $Path -DestinationPath $zip -Force }
Invoke-RestMethod -Method Put -Uri $Url -InFile $zip -Headers @{ 'x-ms-blob-type' = 'BlockBlob' } | Out-Null
'sent ' + (Get-Item $zip).Length + ' bytes from ' + $Path
Remove-Item $zip -Force
`;
