// The one place that runs the Azure CLI. It uses execFile with an argument list: no shell is involved, so nothing
// in an argument (a name, a tag, a script) can be read as a command. An error never carries the arguments, because
// they can hold a password: it carries the first words of the command, and the CLI's own message, scrubbed.
import { execFile } from 'node:child_process';
import { redact } from './record.ts';

export type AzOptions = { timeoutMs?: number; secrets?: string[] };
export type AzResult = { stdout: string; stderr: string };
/** Runs `az` with these arguments. Tests pass a fake with the same shape. */
export type Az = (args: string[], opts?: AzOptions) => Promise<AzResult>;

export class AzError extends Error {
  constructor(args: string[], stderr: string, secrets: string[]) {
    // Only the command's own words (up to the first flag): flags and their values can hold a password.
    const firstFlag = args.findIndex((a) => a.startsWith('-'));
    const where = (firstFlag === -1 ? args : args.slice(0, firstFlag)).slice(0, 3).join(' ');
    const lines = stderr.trim().split('\n').filter(Boolean);
    // The first line and the last two: a traceback buries the real error at the end.
    const kept = lines.length > 3 ? [lines[0], '...', ...lines.slice(-2)] : lines;
    const said = redact(kept.join(' / ').slice(0, 700), secrets);
    super(`az ${where} failed: ${said || '(no message)'}`);
    this.name = 'AzError';
  }
}

export const realAz: Az = (args, opts = {}) =>
  new Promise((resolve, reject) => {
    execFile(
      'az',
      args,
      { timeout: opts.timeoutMs ?? 15 * 60_000, maxBuffer: 32 * 1024 * 1024, env: process.env },
      (error, stdout, stderr) => {
        if (error) reject(new AzError(args, stderr || error.message, opts.secrets ?? []));
        else resolve({ stdout, stderr });
      },
    );
  });
