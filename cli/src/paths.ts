import path from 'node:path';

/** The repo: VMLAB_ROOT when set (the container sets it to /project), else two folders above this file. */
export function repoRoot(): string {
  return process.env.VMLAB_ROOT ?? path.resolve(import.meta.dirname, '..', '..');
}
