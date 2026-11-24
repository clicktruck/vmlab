// The vmlab command. Made from the list of actions in actions.ts; nothing is defined twice.
import { createInterface } from 'node:readline/promises';
import { Command } from 'commander';
import { type Action, actions, type Ctx, VERSION } from './actions.ts';
import { repoRoot } from './paths.ts';
import { StepReporter } from './progress.ts';

async function confirm(question: string): Promise<boolean> {
  if (!process.stdin.isTTY) return false;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(`${question} [y/N] `);
  rl.close();
  return /^y(es)?$/i.test(answer.trim());
}

const program = new Command('vmlab')
  .description('Make a throwaway machine, run declared tests on it, and delete it.')
  .version(VERSION)
  .option('--root <dir>', 'the repo with vmlab.yaml and the config directories', repoRoot())
  .option('--config-dir <dir...>', 'more config directories; later ones win')
  .option('--no-local', 'ignore vmlab.local.yaml')
  .option('--provider <name>', 'use this provider instead of the one in vmlab.yaml (dry makes nothing)')
  .option('--yes', 'do not ask; say yes to the plan')
  .option('--json', 'print the result as JSON');

function ctxFrom(opts: Record<string, unknown>): Ctx {
  return {
    root: String(opts.root),
    configDirs: (opts.configDir as string[] | undefined) ?? [],
    local: opts.local !== false,
    json: Boolean(opts.json),
    yes: Boolean(opts.yes),
    provider: opts.provider as string | undefined,
    confirm,
    // Progress goes to stderr, so `--json` output on stdout stays clean.
    reporter: new StepReporter({
      write: (text) => process.stderr.write(text),
      spinner: Boolean(process.stderr.isTTY),
      columns: () => process.stderr.columns,
    }),
    env: process.env,
  };
}

function wire(parent: Command, action: Action, leaf: string) {
  const cmd = parent.command(action.takesRun ? `${leaf} <run>` : leaf).description(action.summary);
  cmd.action(async (...args: unknown[]) => {
    const run = action.takesRun ? (args[0] as string) : undefined;
    const ctx = ctxFrom(program.opts());
    const result = await action.run(ctx, run);
    console.log(ctx.json && result.data !== undefined ? JSON.stringify(result.data, null, 2) : result.text);
    process.exitCode = result.exitCode;
  });
}

const groups = new Map<string, Command>();
for (const action of actions) {
  const [first, second] = action.name.split(' ');
  if (second === undefined) wire(program, action, action.name);
  else {
    const group =
      groups.get(first as string) ?? program.command(first as string).description(`${first} commands`);
    groups.set(first as string, group);
    wire(group, action, second);
  }
}

await program.parseAsync();
