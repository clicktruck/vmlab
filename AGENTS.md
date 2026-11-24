# AGENTS.md: vmlab

Rules for any agent working in this repo. All rules live in this one file; `CLAUDE.md` contains only `@AGENTS.md`.

## Whole repo

- **Docs lead the code.** `docs/` says what to build; `cli/` follows. If code and docs disagree, fix one in the same change.
- **Nothing is made in a cloud without a plan and a yes.** Every command that creates something shows a plan first: what it will make, in which region, at what estimated cost an hour, and when it will be deleted. It makes nothing until the person says yes (`--yes` for a script the person wrote themselves).
- **Everything made is deleted.** Each run deletes what it made, even when it fails. Every cloud object carries a tag with an expiry time, and `vmlab sweep` deletes anything past it. A run never leaves a machine behind without saying so, loudly.
- **The person stays in control.** The provider, size, image, region, lifetime and tests live in a config file that can be read and changed. Each run records the exact values it used.
- **This repo is public** (D4, D5; MIT). Nothing private goes in it: no private repo or project names, customers, tokens, subscription or tenant ids, email addresses or real scores. Examples use invented or public things. A project's own runs and suites live in that project's repo.
- **Report gaps, never hide them.** A step that did not run, a test that could not start, a delete that failed: each is listed with its reason. Never show a gap as a pass.
- **No secrets in the repo, the logs or the image.** Passwords are made fresh for each run and never printed or saved. Sign-in tokens live in a Docker volume, never in the repo and never in the image. A test checks that run records hold no secrets.
- **The host stays clean.** Everything runs through `just` and Docker Compose. The host needs Docker, `just` and `git`, and nothing else: don't add a step that needs Node, Python or a cloud CLI on it. A new host tool goes in `scripts/prereqs.sh` and `docs/03-install.md`.
- **Never change the global toolchain.** No `mise use -g`, no `mise upgrade`, no edits under `~/.config/mise`. This repo pins what it needs in `mise.toml`.
- **One Justfile for every system.** Recipes run under `sh`, so keep them to plain `sh` syntax and let scripts in `scripts/` carry any logic.
- **Latest dependencies, locked.** Add a dependency at its latest release and commit the lock file (`cli/pnpm-lock.yaml`). Add one only when code uses it. Dependabot (weekly, with a seven-day wait for new releases) and pinning every GitHub action to a commit are the intended setup; neither exists yet because the repo has no `.github/` folder (ROADMAP.md).
- **Tests never need a cloud.** Unit tests use the fake `dry` provider. Tests against a real cloud are `just live`, cost money, are never run by CI, and are never run without the person's yes.
- **Docs match what was actually tested.** After a live run or any change in behaviour, the docs are brought in line in the same change: what was run, when, what it did, what failed and how it was fixed, and what is still untested. A doc never describes something as working that was only designed or only tested with a fake. Mark it **Built, not yet run live**, **Tested live on DATE**, or **Planned**. Lessons that apply to anyone, such as a size a new subscription cannot use, go in `docs/research/` in neutral words, with no names, tenants or ids.
- **One place for status.** What is Completed, Partial, In progress, Planned, Open or Not wanted lives only in `ROADMAP.md`, and the evidence for it in `docs/07-what-has-been-proven.md`. The README and the docs link there and do not repeat a status. After a live run, update both in the same change.
- **A "no" needs a "yes" beside it.** A step that expects a refusal (denied, not found) must first prove there was something to refuse, and fail when there was not. Two steps passed for the wrong reason in run 8 because the file they were refused did not exist.
- **Facts are checked and cited.** Claims about clouds, prices, images and licences carry their source and the date checked (`docs/research/`). Prices and images change monthly. Say "not checked" when you did not check.
- **Decisions.** Record each decision in `docs/decisions.md` with the date and who decided. Never record a decision the person has not made. Mark anything undecided **Open** and anything not built **Planned**.
- **Commits.** Conventional Commits, and pull request titles too, so a release tool can read them later (none is set up yet: ROADMAP.md). Stage explicit paths.
- **Checks.** `just check` before a commit.

## `docs/`

- One topic per file, numbered in reading order. Keep `docs/README.md` as the index.
- Write for an 8th-grade reader: plain words, short sentences, jargon defined once. Frame analysis as situation, opportunity, impact. Tables for options, with one recommendation. A picture where it helps, with nothing overlapping.
- Where a doc says how to run something, give the complete command, say which terminal it runs in, and say what output to expect.
- Research claims go in `docs/research/` with their source and the date checked.

## `cli/` (TypeScript)

- Reads the config file, plans, creates, runs tests on, and deletes machines, and writes run records.
- **Erasable TypeScript only.** Node runs the sources directly: no enums, no parameter properties, imports end in `.ts`.
- **One list of actions** in `cli/src/actions.ts`; the command line is made from it, with a test that the docs list the same commands.
- **Providers are plug-ins** that implement one interface (`cli/src/provider.ts`): `plan`, `up`, `exec`, `down`, `sweep`. Nothing outside a provider names a cloud. The `dry` provider is the fake used by tests.
- The config is checked against a JSON Schema kept in the repo. A bad config fails before anything is made, and says which line.
- Tests sit beside the code as `*.test.ts` and run with `node --test`.

## `config/`

- Everything declarative lives in a config directory: `profiles/`, `suites/<name>/`, `sources/` and `runs/` ([docs/03](docs/03-runs-sources-and-suites.md)). Every file is checked against a JSON Schema in `schema/`, and the tests load every example, so examples stay valid.
- A suite is a folder: `suite.yaml` (what runs, as whom, and what must be true afterwards) plus the scripts it runs on the machine.
- vmlab ships general parts only. A suite, source or run for one project lives with that project and is named by `--config-dir`.
- **Deny by default.** Nothing is fetched or run from a source unless a policy rule allows it. A run is pinned to one commit, and the commit is recorded.
