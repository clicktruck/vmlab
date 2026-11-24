// A plan: what a run would make, where, for how long, at what estimated cost, and what cannot go ahead.
// Nothing here touches a cloud. A profile that cannot run is a gap, with its reason: never a pass, never omitted.
import { existsSync, realpathSync } from 'node:fs';
import path from 'node:path';
import type { Loaded } from './config.ts';
import { resolveInputs } from './inputs.ts';
import { checkSource } from './policy.ts';
import type { AttestationName } from './schema.ts';
import { isScriptStep } from './schema.ts';

/** Something that did not happen or is not known. `minor` ones (an unknown cost) do not stop a run counting as complete. */
export type Gap = { profile?: string; what: string; why: string; minor?: boolean };

export type PlanProfile = {
  name: string;
  status: 'ready' | 'gap';
  reason?: string;
  image: string;
  size: string;
  licenceType: 'included' | 'Windows_Client';
  estimatedUsd: number | null;
};

export type PlanSource = { name: string; repo: string; ref: string; tokenEnv: string | null };

export type Plan = {
  run: string;
  provider: string;
  ttlMinutes: number;
  deletePolicy: 'always' | 'on_success' | 'never';
  profiles: PlanProfile[];
  sources: PlanSource[];
  suites: string[];
  estimatedUsd: number | null;
  maxEstimatedUsd: number;
  /** Files to put on each machine and to bring back, and whether the file exchange (private storage in the run) is made. */
  files: { in: { from: string; to: string }[]; out: { from: string; to: string }[] };
  exchange: boolean;
  gaps: Gap[];
  /** Reasons the run cannot start at all. Empty means it may go ahead (with its gaps listed). */
  problems: string[];
  /** The attestations the plan relied on, with what the person set, for the run record. */
  attestations: Partial<
    Record<AttestationName, { holds_eligible_licence: boolean; reference: string; note: string }>
  >;
};

export function buildPlan(
  cfg: Loaded,
  runName: string | undefined,
  providerName?: string,
  env: NodeJS.ProcessEnv = process.env,
): Plan {
  const name = runName ?? '';
  const run = cfg.runs.get(name);
  const plan: Plan = {
    run: name,
    provider: providerName ?? cfg.root.provider.name,
    ttlMinutes: cfg.root.lifetime.ttl_minutes,
    deletePolicy: cfg.root.lifetime.delete,
    profiles: [],
    sources: [],
    suites: [],
    estimatedUsd: null,
    maxEstimatedUsd: cfg.root.budget.max_estimated_usd,
    files: { in: [], out: [] },
    exchange: false,
    gaps: [],
    problems: [],
    attestations: {},
  };
  if (!run) {
    plan.problems.push(`no run named "${name}" (try: vmlab list)`);
    return plan;
  }

  // Files in come from inside the project only: a run file cannot reach anywhere else on this computer.
  const base = realpathSync(cfg.projectRoot);
  for (const f of run.files?.in ?? []) {
    const abs = path.resolve(cfg.projectRoot, f.from);
    if (!existsSync(abs)) {
      plan.problems.push(`files.in: ${f.from} does not exist`);
      continue;
    }
    const inside = path.relative(base, realpathSync(abs));
    if (inside.startsWith('..') || path.isAbsolute(inside)) {
      plan.problems.push(`files.in: ${f.from} is outside the project folder, so a run may not read it`);
      continue;
    }
    plan.files.in.push({ from: f.from, to: f.to });
  }
  for (const f of run.files?.out ?? []) plan.files.out.push({ from: f.from, to: f.to });
  plan.exchange = Boolean(run.exchange) || plan.files.in.length > 0 || plan.files.out.length > 0;

  // Sources: deny by default.
  for (const ref of run.sources) {
    const source = cfg.sources.get(ref.name);
    if (!source) continue; // the loader already refused a missing one
    const wanted = ref.ref ?? source.default_ref;
    const refused = checkSource(cfg.root.policy.sources, source.repo, wanted);
    if (refused) plan.problems.push(refused);
    plan.sources.push({
      name: source.name,
      repo: source.repo,
      ref: wanted,
      tokenEnv: source.auth?.token_env ?? null,
    });
  }

  for (const s of run.suites) {
    plan.suites.push(s.name);
    const suite = cfg.suites.get(s.name);
    if (suite) {
      for (const step of suite.suite.steps) {
        if (!isScriptStep(step)) continue;
        const checked = resolveInputs(suite.suite, step.inputs ?? [], s.inputs, env);
        plan.problems.push(...checked.problems.filter((p) => !plan.problems.includes(p)));
      }
    }
    for (const needed of suite?.suite.needs.sources ?? []) {
      if (!run.sources.some((r) => r.name === needed)) {
        plan.problems.push(`suite ${s.name} needs source "${needed}", which the run does not list`);
      }
    }
  }

  for (const profileName of run.profiles) {
    const profile = cfg.profiles.get(profileName);
    if (!profile) continue;
    const entry: PlanProfile = {
      name: profile.name,
      status: 'ready',
      image: profile.image,
      size: profile.size,
      licenceType: profile.licence.type,
      estimatedUsd:
        profile.estimated_usd_per_hour === undefined
          ? null
          : Math.round(profile.estimated_usd_per_hour * (plan.ttlMinutes / 60) * 100) / 100,
    };

    const need = profile.licence.requires_attestation;
    if (need) {
      const attested = cfg.root.attestations[need];
      plan.attestations[need] = attested;
      if (!attested.holds_eligible_licence) {
        entry.status = 'gap';
        entry.reason = `needs the attestation "${need}": set attestations.${need}.holds_eligible_licence to true in vmlab.local.yaml once you have confirmed it (docs/04)`;
      }
    }
    for (const s of run.suites) {
      const suite = cfg.suites.get(s.name)?.suite;
      if (suite && suite.os !== profile.os) {
        entry.status = 'gap';
        entry.reason = `suite ${s.name} is for ${suite.os}, and this profile is ${profile.os}`;
      }
    }
    if (entry.status === 'gap')
      plan.gaps.push({ profile: profile.name, what: 'profile will not run', why: entry.reason ?? '' });
    plan.profiles.push(entry);
  }

  // Cost: a sum of what is known. An unknown is a gap, never zero.
  const ready = plan.profiles.filter((p) => p.status === 'ready');
  const unknown = ready.filter((p) => p.estimatedUsd === null);
  for (const p of unknown) {
    plan.gaps.push({
      profile: p.name,
      what: 'cost unknown',
      why: 'the profile has no estimated_usd_per_hour',
      minor: true,
    });
  }
  if (ready.length > 0 && unknown.length === 0) {
    plan.estimatedUsd = Math.round(ready.reduce((n, p) => n + (p.estimatedUsd ?? 0), 0) * 100) / 100;
    if (plan.estimatedUsd > plan.maxEstimatedUsd) {
      plan.problems.push(
        `the estimated cost $${plan.estimatedUsd} is over the budget line $${plan.maxEstimatedUsd} (budget.max_estimated_usd)`,
      );
    }
  }
  if (ready.length === 0) plan.problems.push('no profile can run, so nothing would be tested (see the gaps)');
  return plan;
}

export function describePlan(plan: Plan, providerLines: Map<string, string[]> = new Map()): string {
  const out: string[] = [];
  out.push(`Plan for run "${plan.run}" with provider ${plan.provider}`);
  out.push(
    `  every object lives at most ${plan.ttlMinutes} minutes and is tagged with its expiry; delete: ${plan.deletePolicy}`,
  );
  for (const p of plan.profiles) {
    out.push(
      `  profile ${p.name}: ${p.status === 'ready' ? 'ready' : 'GAP, will not run'} (${p.image}, ${p.size})`,
    );
    if (p.reason) out.push(`    why: ${p.reason}`);
    for (const line of providerLines.get(p.name) ?? []) out.push(`    ${line}`);
  }
  for (const [name, a] of Object.entries(plan.attestations)) {
    out.push(
      `  attestation ${name}: ${a.holds_eligible_licence ? 'you state you hold it' : 'NOT set'}; reference: ${a.reference || '(none yet)'}`,
    );
  }
  if (plan.exchange) {
    out.push(
      `  file exchange: private storage made inside each run's resource group (${plan.files.in.length} file(s) in, ${plan.files.out.length} out) and deleted with it`,
    );
  }
  for (const s of plan.sources)
    out.push(
      `  source ${s.name}: ${s.repo} at ${s.ref}${s.tokenEnv ? ` (a read-only token from $${s.tokenEnv} would be sent to the machine)` : ''}`,
    );
  out.push(`  suites: ${plan.suites.join(', ')}`);
  out.push(
    plan.estimatedUsd === null
      ? '  estimated cost: unknown (see the gaps)'
      : `  estimated cost: at most $${plan.estimatedUsd} (budget line $${plan.maxEstimatedUsd})`,
  );
  for (const g of plan.gaps) out.push(`  GAP${g.profile ? ` [${g.profile}]` : ''}: ${g.what}: ${g.why}`);
  for (const pr of plan.problems) out.push(`  CANNOT GO AHEAD: ${pr}`);
  return out.join('\n');
}
