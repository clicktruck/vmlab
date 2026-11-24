// The record of a run: the exact values used, each step, each result, and every gap. Kept in runs/<id>/run.json.
// It must never hold a secret: anything that looks like one is checked for, and known values are blanked out.
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Gap, Plan } from './plan.ts';
import type { TimelineEntry } from './progress.ts';
import type { ResolvedSource } from './sources.ts';

export type CheckResult = { check: string; ok: boolean; detail?: string };

export type StepResult = {
  profile: string;
  suite: string;
  step: string;
  runAs: string;
  /** `not-run` is a gap (the dry provider, or a profile that could not start): never a pass. */
  status: 'pass' | 'fail' | 'not-run';
  exitCode?: number;
  checks: CheckResult[];
  output: string;
  seconds: number;
};

export type Cleanup = { profile: string; deleted: boolean; note: string };

export type RunRecord = {
  id: string;
  vmlab: string;
  started: string;
  finished: string;
  /** Every step with its start and how long it took, in the order they ran. */
  timeline: TimelineEntry[];
  plan: Plan;
  /** The exact commit each source was tested at (a ref can move; a commit id cannot). */
  sources: ResolvedSource[];
  results: StepResult[];
  gaps: Gap[];
  cleanup: Cleanup[];
};

const SECRET_PATTERNS: RegExp[] = [
  /gh[pousr]_[A-Za-z0-9]{20,}/g,
  /github_pat_[A-Za-z0-9_]{20,}/g,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/g,
  /AKIA[0-9A-Z]{16}/g,
  /(?:password|passwd|secret|token)["']?\s*[:=]\s*["'][^"'\s]{8,}["']/gi,
];

/** Everything that looks like a secret, for a test and for the writer to refuse. */
export function findSecrets(text: string): string[] {
  return SECRET_PATTERNS.flatMap((re) => text.match(re) ?? []);
}

/** Blank out known secret values (from the environment) and anything that looks like one. */
export function redact(text: string, secrets: string[]): string {
  let out = text;
  for (const s of secrets) if (s.length >= 8) out = out.split(s).join('[redacted]');
  for (const re of SECRET_PATTERNS) out = out.replace(re, '[redacted]');
  return out;
}

export async function writeRecord(root: string, record: RunRecord): Promise<string> {
  const text = JSON.stringify(record, null, 2);
  const found = findSecrets(text);
  if (found.length) {
    throw new Error(
      `the run record looks like it holds a secret (${found.length} match), so it was not written`,
    );
  }
  const dir = path.join(root, 'runs', record.id);
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, 'run.json');
  await writeFile(file, `${text}\n`);
  return path.relative(root, file);
}
