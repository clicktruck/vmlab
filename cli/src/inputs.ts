// Named values a suite's scripts take. A script declares them in a `param(...)` block and a step lists the ones it takes.
// A value can be written in the run file, or read from an environment variable on this computer with `env:NAME`.
// A secret one can only be given as `env:NAME`, so a secret is never written in a file, and it travels to the machine
// as a protected parameter: encrypted, never printed, never in the run record.
import type { Suite } from './schema.ts';

export type ResolvedInputs = {
  parameters: Record<string, string>;
  protectedParameters: Record<string, string>;
  problems: string[];
};

export function resolveInputs(
  suite: Suite,
  names: string[],
  given: Record<string, string> | undefined,
  env: NodeJS.ProcessEnv,
): ResolvedInputs {
  const out: ResolvedInputs = { parameters: {}, protectedParameters: {}, problems: [] };
  const declared = suite.inputs ?? {};
  for (const name of Object.keys(given ?? {})) {
    if (!(name in declared)) out.problems.push(`suite ${suite.name} has no input named "${name}"`);
  }
  for (const name of names) {
    const spec = declared[name];
    if (!spec) {
      out.problems.push(
        `a step of suite ${suite.name} takes the input "${name}", which the suite does not declare`,
      );
      continue;
    }
    const wanted = given?.[name] ?? spec.default;
    if (wanted === undefined) {
      out.problems.push(`input "${name}" of suite ${suite.name} has no value: give it in the run file`);
      continue;
    }
    const fromEnv = /^env:([A-Z_][A-Z0-9_]*)$/.exec(wanted);
    if (spec.secret && !fromEnv) {
      out.problems.push(
        `input "${name}" of suite ${suite.name} is a secret, so it must be given as env:NAME (an environment variable), never written in a file`,
      );
      continue;
    }
    const value = fromEnv ? env[fromEnv[1] as string] : wanted;
    if (value === undefined || value === '') {
      out.problems.push(
        `input "${name}" of suite ${suite.name}: the environment variable ${fromEnv?.[1]} is not set`,
      );
      continue;
    }
    (spec.secret ? out.protectedParameters : out.parameters)[name] = value;
  }
  return out;
}
