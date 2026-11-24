// Runs a plan: make each machine, run the suites' steps on it, check what came back, and delete the machine.
// A machine is always deleted unless the person's config says otherwise, even when a step throws.
// A step that could not run is `not-run`, a gap. It is never turned into a pass.
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import type { Loaded } from './config.ts';
import { resolveInputs } from './inputs.ts';
import type { Plan } from './plan.ts';
import { formatSeconds, quiet, type Reporter } from './progress.ts';
import type { Machine, Provider } from './provider.ts';
import { type CheckResult, type Cleanup, type RunRecord, redact, type StepResult } from './record.ts';
import { type Expect, isScriptStep } from './schema.ts';
import { FETCH_SOURCE_SCRIPT, type Fetch, type ResolvedSource, resolveSha, sourceDir } from './sources.ts';

/** Unpacks a .zip that came back from a machine. Python is in the image; a test passes its own. */
export const unzipWithPython = (zip: string, dest: string): Promise<void> =>
  new Promise((resolve, reject) => {
    execFile('python3', ['-m', 'zipfile', '-e', zip, dest], (error, _out, stderr) =>
      error ? reject(new Error(`could not unpack ${zip}: ${stderr || error.message}`)) : resolve(),
    );
  });

export type RunOptions = {
  unzip?: (zip: string, dest: string) => Promise<void>;
  now?: () => Date;
  /** Values that must never appear in the record (for example a token read from the environment). */
  secrets?: string[];
  version: string;
  /** Where `env:NAME` inputs are read from. Default: this process's environment. */
  env?: NodeJS.ProcessEnv;
  /** Tells the person what is happening. Default: nothing is printed (the timeline is still kept). */
  reporter?: Reporter;
  /** How GitHub is asked for a commit id. Default: the real one. A test passes its own. */
  fetch?: Fetch;
};

/** The checks a step's expectations ask for, applied to what the machine returned. */
export function evaluate(expect: Expect, exitCode: number, output: string): CheckResult[] {
  const checks: CheckResult[] = [];
  if (expect.exit_code !== undefined) {
    checks.push({
      check: `exit code is ${expect.exit_code}`,
      ok: exitCode === expect.exit_code,
      detail: `was ${exitCode}`,
    });
  }
  for (const s of expect.output_contains ?? [])
    checks.push({ check: `output contains "${s}"`, ok: output.includes(s) });
  for (const s of expect.output_not_contains ?? []) {
    checks.push({ check: `output does not contain "${s}"`, ok: !output.includes(s) });
  }
  for (const s of expect.output_matches ?? []) {
    let ok = false;
    try {
      ok = new RegExp(s).test(output);
    } catch {
      /* a bad pattern is a failed check, not a crash */
    }
    checks.push({ check: `output matches /${s}/`, ok });
  }
  return checks;
}

export async function executeRun(
  cfg: Loaded,
  plan: Plan,
  provider: Provider,
  opts: RunOptions,
): Promise<RunRecord> {
  const now = opts.now ?? (() => new Date());
  const started = now();
  const stamp = started
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d+Z$/, 'Z');
  const id = `${stamp}-${plan.run}-${randomBytes(2).toString('hex')}`;
  const expiresAt = new Date(started.getTime() + plan.ttlMinutes * 60_000);
  const secrets = [...(opts.secrets ?? [])];
  // Every secret input of every suite in this run is scrubbed from every step's output, whichever step was given it.
  for (const s of cfg.runs.get(plan.run)?.suites ?? []) {
    const suite = cfg.suites.get(s.name)?.suite;
    if (!suite) continue;
    for (const step of suite.steps) {
      if (isScriptStep(step))
        secrets.push(
          ...Object.values(
            resolveInputs(suite, step.inputs ?? [], s.inputs, opts.env ?? process.env).protectedParameters,
          ),
        );
    }
  }
  const reporter = opts.reporter ?? quiet();
  const run = cfg.runs.get(plan.run);
  const results: StepResult[] = [];
  const cleanup: Cleanup[] = [];
  const gaps = [...plan.gaps];

  function notRun(profile: string, why: string) {
    for (const s of run?.suites ?? []) {
      for (const step of cfg.suites.get(s.name)?.suite.steps ?? []) {
        for (const runAs of isScriptStep(step) ? step.run_as : ['-']) {
          results.push({
            profile,
            suite: s.name,
            step: step.id,
            runAs,
            status: 'not-run',
            checks: [],
            output: why,
            seconds: 0,
          });
        }
      }
    }
  }

  // Sources: turn each ref into one exact commit before anything is made, so a bad token or ref costs nothing.
  const resolved: ResolvedSource[] = [];
  const tokens = new Map<string, string>();
  let sourceProblem: string | null = null;
  for (const src of plan.sources) {
    try {
      const token = src.tokenEnv ? ((opts.env ?? process.env)[src.tokenEnv] ?? '') : '';
      if (src.tokenEnv && !token)
        throw new Error(
          `source ${src.name} needs the environment variable ${src.tokenEnv}, and it is not set`,
        );
      if (token) {
        tokens.set(src.name, token);
        secrets.push(token);
      }
      resolved.push(
        await reporter.timed(`finding the commit for ${src.name} (${src.repo} at ${src.ref})`, () =>
          resolveSha(src, token || null, opts.fetch),
        ),
      );
    } catch (e) {
      sourceProblem = redact(`a source could not be fetched: ${(e as Error).message}`, secrets);
      gaps.push({ what: `source ${src.name} was not fetched`, why: sourceProblem });
      break;
    }
  }

  for (const entry of plan.profiles) {
    if (sourceProblem) {
      notRun(entry.name, sourceProblem);
      continue;
    }
    if (entry.status === 'gap') {
      notRun(entry.name, entry.reason ?? 'the profile could not run');
      continue;
    }
    const profile = cfg.profiles.get(entry.name);
    if (!profile) continue;
    const ctx = {
      runId: id,
      expiresAt,
      tags: { ...cfg.root.tags, vmlab_run: id, vmlab_expires: expiresAt.toISOString() },
      licenceType: entry.licenceType,
    };
    let machine: Machine | null = null;
    let failed = false;
    try {
      reporter.info(`profile ${profile.name}: starting (${profile.image}, ${profile.size})`);
      machine = await reporter.timed('making the machine', () => provider.up(profile, ctx), {
        profile: profile.name,
      });
      if (plan.exchange) {
        await reporter.timed(
          'preparing the file exchange',
          () => provider.prepareExchange(machine as Machine),
          {
            profile: profile.name,
          },
        );
        for (const f of plan.files.in) {
          const t2 = Date.now();
          let entry: StepResult;
          try {
            const r = await reporter.timed(
              `putting ${f.from} on the machine`,
              () => provider.putFile(machine as Machine, path.resolve(cfg.projectRoot, f.from), f.to),
              { profile: profile.name },
            );
            entry = {
              profile: profile.name,
              suite: '(files)',
              step: `in ${f.from}`,
              runAs: '-',
              status: r.ran ? 'pass' : 'not-run',
              checks: r.ran ? [{ check: `${f.from} is on the machine at ${f.to}`, ok: true }] : [],
              output: r.ran ? 'copied' : '(dry provider: nothing was copied)',
              seconds: (Date.now() - t2) / 1000,
            };
          } catch (e) {
            entry = {
              profile: profile.name,
              suite: '(files)',
              step: `in ${f.from}`,
              runAs: '-',
              status: 'fail',
              checks: [
                {
                  check: 'the file was copied',
                  ok: false,
                  detail: redact(String((e as Error).message), secrets),
                },
              ],
              output: '',
              seconds: (Date.now() - t2) / 1000,
            };
            failed = true;
          }
          if (entry.status === 'not-run')
            gaps.push({ profile: profile.name, what: `file ${f.from} was not copied`, why: entry.output });
          results.push(entry);
        }
      }
      for (const src of resolved) {
        const t3 = Date.now();
        const dest = sourceDir(src.name);
        let fetched: StepResult;
        try {
          const token = tokens.get(src.name);
          const res = await reporter.timed(
            `fetching ${src.repo}@${src.sha.slice(0, 7)} to ${dest}`,
            () =>
              provider.exec(
                machine as Machine,
                { name: 'vmlab-fetch-source.ps1', content: FETCH_SOURCE_SCRIPT },
                'system',
                600,
                {
                  parameters: { Dest: dest, Repo: src.repo, Sha: src.sha },
                  protectedParameters: token ? { Token: token } : {},
                },
              ),
            { profile: profile.name },
          );
          fetched = {
            profile: profile.name,
            suite: '(sources)',
            step: src.name,
            runAs: 'system',
            status: !res.ran ? 'not-run' : res.exitCode === 0 ? 'pass' : 'fail',
            exitCode: res.ran ? res.exitCode : undefined,
            checks: res.ran ? [{ check: `${src.name} is at ${dest}`, ok: res.exitCode === 0 }] : [],
            output: redact(res.output, secrets),
            seconds: (Date.now() - t3) / 1000,
          };
        } catch (e) {
          fetched = {
            profile: profile.name,
            suite: '(sources)',
            step: src.name,
            runAs: 'system',
            status: 'fail',
            checks: [
              {
                check: 'the source was fetched',
                ok: false,
                detail: redact(String((e as Error).message), secrets),
              },
            ],
            output: '',
            seconds: (Date.now() - t3) / 1000,
          };
        }
        if (fetched.status === 'fail') failed = true;
        if (fetched.status === 'not-run')
          gaps.push({
            profile: profile.name,
            what: `source ${src.name} was not fetched`,
            why: fetched.output,
          });
        results.push(fetched);
      }
      for (const s of run?.suites ?? []) {
        const loaded = cfg.suites.get(s.name);
        if (!loaded) continue;
        for (const step of loaded.suite.steps) {
          if (!isScriptStep(step)) {
            const t1 = Date.now();
            let rebooted: StepResult;
            try {
              const res = await reporter.timed(
                `restarting the machine (${s.name}/${step.id})`,
                () => provider.reboot(machine as Machine, step.timeout_seconds),
                { profile: profile.name },
              );
              rebooted = {
                profile: profile.name,
                suite: s.name,
                step: step.id,
                runAs: '-',
                status: res.ran ? 'pass' : 'not-run',
                checks: res.ran ? [{ check: 'the machine came back', ok: true }] : [],
                output: res.ran ? 'restarted' : '(dry provider: nothing was restarted)',
                seconds: (Date.now() - t1) / 1000,
              };
            } catch (e) {
              rebooted = {
                profile: profile.name,
                suite: s.name,
                step: step.id,
                runAs: '-',
                status: 'fail',
                checks: [
                  {
                    check: 'the machine came back',
                    ok: false,
                    detail: redact(String((e as Error).message), secrets),
                  },
                ],
                output: '',
                seconds: (Date.now() - t1) / 1000,
              };
            }
            if (rebooted.status === 'fail') failed = true;
            if (rebooted.status === 'not-run') {
              gaps.push({
                profile: profile.name,
                what: `${s.name}/${step.id} did not run`,
                why: rebooted.output,
              });
            }
            results.push(rebooted);
            // After a failed restart nothing later in this suite can be trusted.
            if (rebooted.status === 'fail') break;
            continue;
          }
          const content = await readFile(path.join(loaded.dir, step.script), 'utf8');
          const given = resolveInputs(loaded.suite, step.inputs ?? [], s.inputs, opts.env ?? process.env);
          const stepSecrets = [...secrets, ...Object.values(given.protectedParameters)];
          for (const runAs of step.run_as) {
            const t0 = Date.now();
            let result: StepResult;
            try {
              const res = await reporter.timed(
                `running ${s.name}/${step.id} as ${runAs}`,
                () =>
                  provider.exec(
                    machine as Machine,
                    { name: step.script, content },
                    runAs,
                    step.timeout_seconds,
                    { parameters: given.parameters, protectedParameters: given.protectedParameters },
                  ),
                { profile: profile.name },
              );
              const output = redact(res.output, stepSecrets);
              if (!res.ran) {
                result = {
                  profile: profile.name,
                  suite: s.name,
                  step: step.id,
                  runAs,
                  status: 'not-run',
                  checks: [],
                  output,
                  seconds: 0,
                };
              } else {
                const checks = evaluate(step.expect, res.exitCode, output);
                result = {
                  profile: profile.name,
                  suite: s.name,
                  step: step.id,
                  runAs,
                  status: checks.every((c) => c.ok) ? 'pass' : 'fail',
                  exitCode: res.exitCode,
                  checks,
                  output,
                  seconds: (Date.now() - t0) / 1000,
                };
              }
            } catch (e) {
              result = {
                profile: profile.name,
                suite: s.name,
                step: step.id,
                runAs,
                status: 'fail',
                checks: [
                  { check: 'the step ran', ok: false, detail: redact(String((e as Error).message), secrets) },
                ],
                output: '',
                seconds: (Date.now() - t0) / 1000,
              };
            }
            if (result.status === 'fail') failed = true;
            if (result.status === 'not-run') {
              gaps.push({
                profile: profile.name,
                what: `${s.name}/${step.id} as ${runAs} did not run`,
                why: result.output,
              });
            }
            results.push(result);
          }
        }
      }
    } catch (e) {
      const why = redact(`could not make or use the machine: ${(e as Error).message}`, secrets);
      gaps.push({ profile: profile.name, what: 'profile did not run', why });
      notRun(profile.name, why);
      failed = true;
    } finally {
      // Bring back what the run asked for before the machine goes, and never let a failure here stop the delete.
      if (machine && plan.files.out.length) {
        for (const f of plan.files.out) {
          const base = path.join(cfg.projectRoot, 'runs', id, 'files', entry.name);
          const zip = path.join(base, `${f.to}.zip`);
          try {
            await mkdir(base, { recursive: true });
            const got = await reporter.timed(
              `bringing ${f.from} back`,
              () => provider.getFile(machine as Machine, f.from, zip),
              {
                profile: profile.name,
              },
            );
            if (!got.ran) {
              gaps.push({
                profile: profile.name,
                what: `file ${f.from} was not brought back`,
                why: '(dry provider: nothing was copied)',
              });
              continue;
            }
            await (opts.unzip ?? unzipWithPython)(zip, path.join(base, f.to));
            await rm(zip, { force: true });
          } catch (e) {
            gaps.push({
              profile: profile.name,
              what: `file ${f.from} was not brought back`,
              why: redact(String((e as Error).message), secrets),
            });
          }
        }
      }
      if (machine) {
        const keep = plan.deletePolicy === 'never' || (plan.deletePolicy === 'on_success' && failed);
        if (keep) {
          cleanup.push({
            profile: profile.name,
            deleted: false,
            note: `LEFT IN PLACE on purpose (delete: ${plan.deletePolicy}). It costs money until deleted. Machine ${machine.id}; it expires at ${expiresAt.toISOString()} and \`vmlab sweep\` will delete it after that.`,
          });
        } else {
          try {
            const made = machine;
            await reporter.timed('deleting the machine and checking it is gone', () => provider.down(made), {
              profile: profile.name,
            });
            cleanup.push({ profile: profile.name, deleted: true, note: 'deleted' });
          } catch (e) {
            const note = `DELETE FAILED: ${redact((e as Error).message, secrets)}. Run \`vmlab sweep\` after ${expiresAt.toISOString()} or delete machine ${machine.id} by hand.`;
            cleanup.push({ profile: profile.name, deleted: false, note });
            gaps.push({ profile: profile.name, what: 'machine not deleted', why: note });
          }
        }
      }
    }
  }

  return {
    id,
    vmlab: opts.version,
    started: started.toISOString(),
    finished: now().toISOString(),
    timeline: reporter.timeline(),
    plan,
    sources: resolved,
    results,
    gaps,
    cleanup,
  };
}

/** One line per profile and suite: pass, fail or gap. Never a blank, never a pass for what did not run. */
export function summarise(record: RunRecord): string {
  const out: string[] = [];
  const keys = [...new Set(record.results.map((r) => `${r.profile} / ${r.suite}`))];
  for (const key of keys) {
    const rows = record.results.filter((r) => `${r.profile} / ${r.suite}` === key);
    const fail = rows.filter((r) => r.status === 'fail').length;
    const gap = rows.filter((r) => r.status === 'not-run').length;
    const pass = rows.filter((r) => r.status === 'pass').length;
    const verdict = fail ? 'FAIL' : gap ? 'GAP' : 'PASS';
    out.push(`  ${verdict.padEnd(5)} ${key}  (${pass} passed, ${fail} failed, ${gap} not run)`);
  }
  for (const c of record.cleanup) out.push(`  cleanup [${c.profile}]: ${c.note}`);
  const total = (Date.parse(record.finished) - Date.parse(record.started)) / 1000;
  const perProfile = [
    ...new Set(record.timeline.filter((t) => t.profile && t.level === 0).map((t) => t.profile as string)),
  ].map(
    (p) =>
      `${p} ${formatSeconds(record.timeline.filter((t) => t.profile === p && t.level === 0).reduce((n, t) => n + t.seconds, 0))}`,
  );
  out.push(
    `  total processing time: ${formatSeconds(total)}${perProfile.length ? ` (${perProfile.join(', ')})` : ''}`,
  );
  return out.join('\n');
}

/** 0 only when everything passed; 1 for any failure; 4 when nothing failed but something did not run. */
export function exitCodeFor(record: RunRecord): number {
  if (record.results.some((r) => r.status === 'fail')) return 1;
  if (
    record.results.some((r) => r.status === 'not-run') ||
    record.cleanup.some((c) => !c.deleted) ||
    record.gaps.some((g) => !g.minor)
  ) {
    return 4;
  }
  return 0;
}
