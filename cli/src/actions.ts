// One list of actions: the command line is made from it, and a test checks the README lists the same commands.

import { realAz } from './az.ts';
import { ConfigError, loadConfig } from './config.ts';
import { buildPlan, describePlan } from './plan.ts';
import { quiet, type Reporter } from './progress.ts';
import type { Provider } from './provider.ts';
import { AzureProvider, type AzureSettings } from './providers/azure.ts';
import { DryProvider } from './providers/dry.ts';
import { writeRecord } from './record.ts';
import { executeRun, exitCodeFor, summarise } from './runner.ts';

export const VERSION = '0.0.0';

export type Ctx = {
  root: string;
  configDirs: string[];
  local: boolean;
  json: boolean;
  yes: boolean;
  provider?: string;
  /** Asks the person a yes/no question. Returns false when there is nobody to ask. */
  confirm: (question: string) => Promise<boolean>;
  /** Prints progress as it happens. Default: nothing. */
  reporter?: Reporter;
  env: NodeJS.ProcessEnv;
};

export type ActionResult = { text: string; data?: unknown; exitCode: number };

export type Action = {
  /** One or two words: `list`, or `config check`. */
  name: string;
  summary: string;
  /** Takes the name of a run as its argument. */
  takesRun: boolean;
  run: (ctx: Ctx, run?: string) => Promise<ActionResult>;
};

export function makeProvider(name: string, settings?: AzureSettings, reporter?: Reporter): Provider {
  if (name === 'dry') return new DryProvider();
  if (name === 'azure') {
    if (!settings) throw new Error('the azure provider needs provider.azure in vmlab.yaml');
    return new AzureProvider(realAz, settings, undefined, undefined, reporter);
  }
  throw new Error(`unknown provider "${name}" (the providers are azure and dry)`);
}

/**
 * Fills in a profile's hourly price from the provider's own price list when the profile gives none, so the plan
 * can show a cost. A price that cannot be read stays unknown: a gap in the plan, never zero.
 */
async function withEstimates(cfg: Awaited<ReturnType<typeof loadConfig>>, provider: Provider) {
  if (!provider.estimate) return;
  for (const [name, profile] of cfg.profiles) {
    if (profile.estimated_usd_per_hour !== undefined) continue;
    const price = await provider.estimate(profile);
    if (price !== null) cfg.profiles.set(name, { ...profile, estimated_usd_per_hour: price });
  }
}

async function load(ctx: Ctx) {
  return loadConfig({ root: ctx.root, configDirs: ctx.configDirs, local: ctx.local });
}

function problems(e: unknown): ActionResult {
  if (e instanceof ConfigError)
    return {
      text: `Config problems:\n${e.problems.map((p) => `  ${p}`).join('\n')}`,
      data: { problems: e.problems },
      exitCode: 2,
    };
  return { text: String((e as Error).message), exitCode: 2 };
}

export const actions: Action[] = [
  {
    name: 'config check',
    summary: 'Check the config files and say which file and line is wrong. Makes nothing.',
    takesRun: false,
    async run(ctx) {
      try {
        const cfg = await load(ctx);
        const text = `Config is clean: ${cfg.profiles.size} profiles, ${cfg.suites.size} suites, ${cfg.sources.size} sources, ${cfg.runs.size} runs (read ${cfg.origin.files.join(', ')}).`;
        return { text, data: { files: cfg.origin.files }, exitCode: 0 };
      } catch (e) {
        return problems(e);
      }
    },
  },
  {
    name: 'list',
    summary: 'List the profiles, suites, sources and runs in the config directories.',
    takesRun: false,
    async run(ctx) {
      try {
        const cfg = await load(ctx);
        const rows = (title: string, items: [string, string][]) => [
          `${title}:`,
          ...items.map(([n, d]) => `  ${n}: ${d}`),
        ];
        const text = [
          ...rows(
            'profiles',
            [...cfg.profiles.values()].map((p) => [p.name, p.description]),
          ),
          ...rows(
            'suites',
            [...cfg.suites.values()].map((s) => [s.suite.name, s.suite.description]),
          ),
          ...rows(
            'sources',
            [...cfg.sources.values()].map((s) => [s.name, `${s.repo} at ${s.default_ref}`]),
          ),
          ...rows(
            'runs',
            [...cfg.runs.values()].map((r) => [r.name, r.description]),
          ),
        ].join('\n');
        return {
          text,
          data: {
            profiles: [...cfg.profiles.keys()],
            suites: [...cfg.suites.keys()],
            sources: [...cfg.sources.keys()],
            runs: [...cfg.runs.keys()],
          },
          exitCode: 0,
        };
      } catch (e) {
        return problems(e);
      }
    },
  },
  {
    name: 'plan',
    summary: 'Show what a run would make, where, for how long and at what estimated cost. Makes nothing.',
    takesRun: true,
    async run(ctx, run) {
      try {
        const cfg = await load(ctx);
        const provider = makeProvider(
          ctx.provider ?? cfg.root.provider.name,
          cfg.root.provider.azure,
          ctx.reporter,
        );
        await withEstimates(cfg, provider);
        const plan = buildPlan(cfg, run, provider.name);
        const lines = new Map<string, string[]>();
        for (const p of plan.profiles) {
          const profile = cfg.profiles.get(p.name);
          if (profile && p.status === 'ready') {
            lines.set(
              p.name,
              provider.plan(profile, {
                runId: 'plan-xxxx',
                expiresAt: new Date(Date.now() + plan.ttlMinutes * 60_000),
                tags: cfg.root.tags,
                licenceType: p.licenceType,
              }),
            );
          }
        }
        return { text: describePlan(plan, lines), data: plan, exitCode: plan.problems.length ? 2 : 0 };
      } catch (e) {
        return problems(e);
      }
    },
  },
  {
    name: 'sweep',
    summary: 'Delete what vmlab made that has passed its expiry time. Asks first.',
    takesRun: false,
    async run(ctx) {
      let provider: Provider;
      try {
        const cfg = await load(ctx);
        provider = makeProvider(
          ctx.provider ?? cfg.root.provider.name,
          cfg.root.provider.azure,
          ctx.reporter,
        );
      } catch (e) {
        return problems(e);
      }
      const yes =
        ctx.yes ||
        (await ctx.confirm(
          `Delete every resource group ${provider.name} holds that vmlab made and that is past its expiry?`,
        ));
      if (!yes)
        return {
          text: 'No yes, so nothing was deleted. (Say yes at the prompt, or pass --yes.)',
          exitCode: 3,
        };
      try {
        const deleted = await provider.sweep(new Date());
        return {
          text: deleted.length
            ? `Deleted ${deleted.length}: ${deleted.join(', ')}`
            : 'Nothing was past its expiry.',
          data: { deleted },
          exitCode: 0,
        };
      } catch (e) {
        return { text: `Sweep failed: ${(e as Error).message}`, exitCode: 1 };
      }
    },
  },
  {
    name: 'test',
    summary: 'Plan, ask yes, make the machines, run the suites, delete the machines, and report.',
    takesRun: true,
    async run(ctx, run) {
      const reporter = ctx.reporter ?? quiet();
      let cfg: Awaited<ReturnType<typeof load>>;
      let provider: Provider;
      try {
        cfg = await load(ctx);
        provider = makeProvider(ctx.provider ?? cfg.root.provider.name, cfg.root.provider.azure, reporter);
        await withEstimates(cfg, provider);
      } catch (e) {
        return problems(e);
      }
      const plan = buildPlan(cfg, run, provider.name);
      const shown = describePlan(plan);
      if (plan.problems.length) return { text: `${shown}\n\nNothing was made.`, data: plan, exitCode: 2 };
      const yes =
        ctx.yes ||
        (await ctx.confirm(`${shown}\n\nMake these machines, run the suites, and delete them afterwards?`));
      if (!yes)
        return {
          text: `${shown}\n\nNo yes, so nothing was made. (Say yes at the prompt, or pass --yes.)`,
          data: plan,
          exitCode: 3,
        };
      const secrets = plan.sources.flatMap((s) =>
        s.tokenEnv && ctx.env[s.tokenEnv] ? [ctx.env[s.tokenEnv] as string] : [],
      );
      const record = await executeRun(cfg, plan, provider, { version: VERSION, secrets, reporter });
      const file = await writeRecord(ctx.root, record);
      const code = exitCodeFor(record);
      const gaps = record.gaps.map((g) => `  GAP${g.profile ? ` [${g.profile}]` : ''}: ${g.what}: ${g.why}`);
      const text = [
        `Run ${record.id}`,
        summarise(record),
        ...gaps,
        `Record: ${file}`,
        code === 0
          ? 'Everything passed.'
          : code === 1
            ? 'At least one step FAILED.'
            : 'Nothing failed, but not everything ran: see the gaps above. This is not a pass.',
      ].join('\n');
      return { text, data: record, exitCode: code };
    },
  },
];
