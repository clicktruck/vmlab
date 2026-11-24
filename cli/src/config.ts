// Reads the config: vmlab.yaml (the defaults), vmlab.local.yaml (yours), and the config directories with
// profiles, suites, sources and runs. Later directories win over earlier ones, by name.
// Every problem names the file and the line, and nothing is made until the config is clean.
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { type Document, parseDocument } from 'yaml';
import type { z } from 'zod';
import { Profile, RootConfig, Run, Source, Suite } from './schema.ts';

export class ConfigError extends Error {
  readonly problems: string[];
  constructor(problems: string[]) {
    super(problems.join('\n'));
    this.name = 'ConfigError';
    this.problems = problems;
  }
}

export type Loaded = {
  /** The folder with vmlab.yaml: what a run may read files from, and where run records are written. */
  projectRoot: string;
  root: RootConfig;
  /** Where each part came from: a path from the repo root, for the run record. */
  origin: { files: string[]; configDirs: string[] };
  profiles: Map<string, Profile>;
  suites: Map<string, { suite: Suite; dir: string }>;
  sources: Map<string, Source>;
  runs: Map<string, Run>;
};

export type LoadOptions = {
  root: string;
  /** Extra config directories, added after the ones in vmlab.yaml, so they win. */
  configDirs?: string[];
  /** Read vmlab.local.yaml. Tests turn it off so they never depend on one person's file. */
  local?: boolean;
};

function lineOf(doc: Document.Parsed, source: string, issuePath: PropertyKey[]): number | null {
  const key = issuePath.filter((p): p is string | number => typeof p !== 'symbol');
  const node = key.length ? doc.getIn(key, true) : doc.contents;
  const range =
    node && typeof node === 'object' && 'range' in node
      ? (node as { range?: [number, number, number] | null }).range
      : null;
  const offset = range ? range[0] : null;
  if (offset === null) return null;
  return source.slice(0, offset).split('\n').length;
}

function check<T>(schema: z.ZodType<T>, value: unknown, doc: Document.Parsed, source: string, file: string) {
  const parsed = schema.safeParse(value);
  if (parsed.success) return { value: parsed.data, problems: [] as string[] };
  const problems = parsed.error.issues.map((issue) => {
    const where = issue.path.length ? issue.path.join('.') : '(whole file)';
    const line = lineOf(doc, source, issue.path);
    return `${file}${line ? ` line ${line}` : ''}: ${where}: ${issue.message}`;
  });
  return { value: undefined, problems };
}

async function readYaml(file: string, shown: string) {
  const source = await readFile(file, 'utf8');
  const doc = parseDocument(source);
  if (doc.errors.length) {
    const problems = doc.errors.map(
      (e) => `${shown} line ${e.linePos?.[0].line ?? '?'}: ${e.message.split('\n')[0]}`,
    );
    throw new ConfigError(problems);
  }
  return { source, doc, value: doc.toJS() as unknown };
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Objects merge key by key; anything else (arrays too) is replaced. */
export function deepMerge(base: unknown, over: unknown): unknown {
  if (!isObject(base) || !isObject(over)) return over === undefined ? base : over;
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(over)) out[k] = k in base ? deepMerge(base[k], v) : v;
  return out;
}

async function exists(p: string): Promise<boolean> {
  try {
    await readdir(p);
    return true;
  } catch {
    return false;
  }
}

export async function loadConfig(opts: LoadOptions): Promise<Loaded> {
  const problems: string[] = [];
  const files: string[] = [];

  // 1. The defaults, then your overrides, merged, then checked once.
  const base = await readYaml(path.join(opts.root, 'vmlab.yaml'), 'vmlab.yaml').catch((e: unknown) => {
    if (e instanceof ConfigError) throw e;
    throw new ConfigError(['vmlab.yaml: cannot be read: it is the file that holds the defaults']);
  });
  files.push('vmlab.yaml');
  let merged = base.value;
  let mergedDoc = base.doc;
  let mergedSource = base.source;
  if (opts.local !== false) {
    const localPath = path.join(opts.root, 'vmlab.local.yaml');
    const local = await readYaml(localPath, 'vmlab.local.yaml').catch((e: unknown) => {
      if (e instanceof ConfigError) throw e;
      return null; // no local file is normal
    });
    if (local) {
      files.push('vmlab.local.yaml');
      merged = deepMerge(base.value, local.value);
      // A problem in the merged result is reported against the file that holds the key, when it can tell.
      const inLocal = (pth: PropertyKey[]) => {
        const k = pth.filter((p): p is string | number => typeof p !== 'symbol');
        return local.doc.hasIn(k);
      };
      const result = RootConfig.safeParse(merged);
      if (!result.success) {
        for (const issue of result.error.issues) {
          const useLocal = inLocal(issue.path);
          const doc = useLocal ? local.doc : base.doc;
          const src = useLocal ? local.source : base.source;
          const line = lineOf(doc, src, issue.path);
          problems.push(
            `${useLocal ? 'vmlab.local.yaml' : 'vmlab.yaml'}${line ? ` line ${line}` : ''}: ${issue.path.join('.') || '(whole file)'}: ${issue.message}`,
          );
        }
        throw new ConfigError(problems);
      }
      mergedDoc = local.doc;
      mergedSource = local.source;
    }
  }
  const rootChecked = check(RootConfig, merged, mergedDoc, mergedSource, 'vmlab.yaml');
  if (!rootChecked.value) throw new ConfigError(rootChecked.problems);
  const root = rootChecked.value;

  // 2. The config directories, in order. A later one replaces a part of the same name.
  const dirs = [...root.config_dirs, ...(opts.configDirs ?? [])];
  const profiles = new Map<string, Profile>();
  const suites = new Map<string, { suite: Suite; dir: string }>();
  const sources = new Map<string, Source>();
  const runs = new Map<string, Run>();

  async function loadKind<T extends { name: string }>(
    dir: string,
    kind: string,
    schema: z.ZodType<T>,
    into: Map<string, T>,
  ) {
    const folder = path.join(dir, kind);
    if (!(await exists(folder))) return;
    for (const entry of (await readdir(folder)).sort()) {
      if (!entry.endsWith('.yaml')) continue;
      const shown = path.relative(opts.root, path.join(folder, entry)) || entry;
      const { source, doc, value } = await readYaml(path.join(folder, entry), shown);
      files.push(shown);
      const checked = check(schema, value, doc, source, shown);
      if (!checked.value) {
        problems.push(...checked.problems);
        continue;
      }
      const stem = entry.replace(/\.yaml$/, '');
      if (checked.value.name !== stem) {
        problems.push(`${shown} line 1: name: "${checked.value.name}" must match the file name "${stem}"`);
        continue;
      }
      into.set(checked.value.name, checked.value);
    }
  }

  for (const rel of dirs) {
    const dir = path.resolve(opts.root, rel);
    if (!(await exists(dir))) {
      problems.push(`config directory ${rel}: not found (named in vmlab.yaml or --config-dir)`);
      continue;
    }
    await loadKind(dir, 'profiles', Profile, profiles);
    await loadKind(dir, 'sources', Source, sources);
    await loadKind(dir, 'runs', Run, runs);
    const suitesDir = path.join(dir, 'suites');
    if (await exists(suitesDir)) {
      for (const entry of (await readdir(suitesDir)).sort()) {
        const file = path.join(suitesDir, entry, 'suite.yaml');
        const shown = path.relative(opts.root, file);
        let read: Awaited<ReturnType<typeof readYaml>>;
        try {
          read = await readYaml(file, shown);
        } catch (e) {
          if (e instanceof ConfigError) problems.push(...e.problems);
          continue; // a folder with no suite.yaml is not a suite
        }
        files.push(shown);
        const checked = check(Suite, read.value, read.doc, read.source, shown);
        if (!checked.value) {
          problems.push(...checked.problems);
          continue;
        }
        if (checked.value.name !== entry) {
          problems.push(
            `${shown} line 1: name: "${checked.value.name}" must match the folder name "${entry}"`,
          );
          continue;
        }
        suites.set(entry, { suite: checked.value, dir: path.dirname(file) });
      }
    }
  }

  // 3. Cross-checks: a name that is used must exist.
  if (!profiles.has(root.default_profile)) {
    problems.push(`vmlab.yaml: default_profile: no profile named "${root.default_profile}"`);
  }
  for (const [runName, run] of runs) {
    for (const p of run.profiles)
      if (!profiles.has(p)) problems.push(`run ${runName}: no profile named "${p}"`);
    for (const s of run.sources)
      if (!sources.has(s.name)) problems.push(`run ${runName}: no source named "${s.name}"`);
    for (const s of run.suites)
      if (!suites.has(s.name)) problems.push(`run ${runName}: no suite named "${s.name}"`);
  }
  if (problems.length) throw new ConfigError(problems);

  return {
    projectRoot: opts.root,
    root,
    origin: { files, configDirs: dirs },
    profiles,
    suites,
    sources,
    runs,
  };
}
