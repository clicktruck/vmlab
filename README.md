# vmlab

**Test on the Windows you do not have.** vmlab rents a fresh, real Windows 11 or Windows Server machine in Azure for a few minutes, runs your tests on it, gives you an honest report, and deletes the machine. About six cents for two machines. Nothing left behind.

<p align="center">
  <img src="docs/assets/flow.svg" alt="How a vmlab test runs: plan and cost shown first, you say yes, a fresh Windows machine is rented in Azure, your scripts run, output and files come back, the machine is deleted, and a report says pass, fail or gap." width="1000">
</p>

**Early software.** MIT licensed. What is finished, half-finished and planned is in [ROADMAP.md](ROADMAP.md), and the evidence for each claim is in [docs/07-what-has-been-proven.md](docs/07-what-has-been-proven.md).

## Why use it

| You have | vmlab gives you |
| --- | --- |
| A Mac with an Apple chip, which cannot run Intel Windows | A real Intel Windows machine in minutes |
| A bug that only shows on a CI Windows runner, one push and ten minutes at a time | A machine you can run anything on and read the answer from, in the same minute |
| A fear of a forgotten cloud machine | Every run deletes what it made, even when a test fails. `vmlab sweep` finds anything left |
| A suspicion that "it passed" hides what did not run | A report with three answers: pass, fail, and **gap** (not run, never counted as a pass) |
| A licence to find and a key to type | Windows Server's licence is in the hourly price. For Windows 11, you state the eligible licence you already hold, once, and vmlab records it |
| A project that should not depend on a tool | Nothing in vmlab names a project. Your run files live in your own repo |

## Quick start

You need Docker, `just` and `git`. Nothing else is installed on your computer: the cloud tools run in a container. Run every command in a terminal, in the vmlab folder. The full steps, with the output to expect at each one, are in [docs/05-install.md](docs/05-install.md).

```bash
just doctor            # checks Docker, just and git; names what is missing
just images            # builds the image (a few minutes the first time)
just login             # signs in to Azure once (a code to type at a web address)
just vmlab config check
just vmlab --provider azure plan windows-acl
just vmlab --provider azure test windows-acl
```

If your organisation blocks that sign-in, `just adopt-login` and a dedicated service principal (`just sp-create`, `just sp-login`) are the other two routes, both in [docs/05-install.md](docs/05-install.md).

`plan` makes nothing and shows what a run would create, where, for how long, and what it should cost. `test` shows the same plan, asks `[y/N]`, and only then makes machines. While it runs you see one line per step with a time on it, and at the end the total.

Windows 11 on Azure needs an eligible Microsoft licence, which only you can confirm. vmlab asks you to state it once, in your own git-ignored `vmlab.local.yaml`, and records what you stated. Until then Windows 11 is shown as a **gap**, never silently skipped. See [docs/04-azure-and-windows-11-access.md](docs/04-azure-and-windows-11-access.md).

## Testing on Windows: what a run costs and what to expect

Two machines, one after the other, take about 17 minutes and cost about 6 cents of compute (measured on real Azure, 2026-11-23; prices change and the plan shows the current estimate). The step-by-step timings are in [docs/07-what-has-been-proven.md](docs/07-what-has-been-proven.md#what-a-run-costs-and-how-long-it-takes).

Things worth knowing before you drive Windows tests this way. Each is written up in [docs/06-sizing-and-cost.md](docs/06-sizing-and-cost.md):

- **A new Azure subscription often cannot use the cheap sizes.** Quota is per size family and can be zero. vmlab checks the quota before it makes anything and says so, instead of failing after a minute with a hidden error.
- **A size can be "offered" and still blocked in a region.** vmlab matches the size name exactly, because Azure's search returns look-alike names.
- **Run Command keeps only about 4 KB of a script's output.** A run can ask for a private storage area so the whole output and files can come back.
- **Machines have no public address.** Whether they can reach the internet depends on how Azure made the network. The `network-probe` suite checks it before you rely on a download ([docs/03](docs/03-runs-sources-and-suites.md#can-the-machine-reach-the-internet)).
- **What Windows really does can differ from what the docs say.** Example: a file's access list, tested on both systems, in [docs/research/02-windows-file-access-lists.md](docs/research/02-windows-file-access-lists.md).

## How a test is written

A test is a small file, not a script you run. A **run** names the machine profiles, the code to fetch, and the suites. A **suite** is a folder: a `suite.yaml` and the scripts it runs. The same suites run on every profile, and the report is one table.

```yaml
# config/runs/network-probe.yaml
name: network-probe
description: Tries a handful of addresses from a Windows 11 machine and from Windows Server 2025.
profiles: [windows-11, windows-server-2025]
sources: []
suites:
  - name: network-probe
```

```yaml
# config/suites/network-probe/suite.yaml
name: network-probe
description: Tries a few well-known addresses from the machine and prints one line each.
os: windows
needs:
  sources: []
steps:
  - id: reach
    script: 01-reach.ps1       # runs on the machine
    run_as: [system]           # or admin, or user:NAME (an ordinary account vmlab makes)
    timeout_seconds: 300
    expect:                    # what vmlab can check from outside
      exit_code: 0
      output_contains: ["DONE"]
      output_not_contains: ["FAIL"]
```

A step can also be a **restart** (`kind: reboot`), take **inputs** (secrets only from the environment, protected on the way, never saved), put **files in** and bring **files out**, and test **a source** fetched at one exact commit if your policy allows it. Everything is written up, with the config layout, in [docs/03-runs-sources-and-suites.md](docs/03-runs-sources-and-suites.md). Your project keeps its own run files and points vmlab at them.

## Suites that ship

What each suite has shown so far is in [ROADMAP.md](ROADMAP.md#the-suites-that-ship).

| Suite | The question it answers |
| --- | --- |
| [windows-acl](config/suites/windows-acl/suite.yaml) | What does Windows do with a file's access list, and which way of making a file private really leaves one entry? Results in [research/02](docs/research/02-windows-file-access-lists.md) |
| [network-probe](config/suites/network-probe/suite.yaml) | Can the machine reach GitHub, Docker, Microsoft and PyPI? |
| [building-blocks](config/suites/building-blocks/suite.yaml) | Do inputs, secrets, whole output, files, a source fetch and a restart all work on a real machine? |
| [windows-docker-desktop](config/suites/windows-docker-desktop/suite.yaml) | Can Docker Desktop be installed on Windows 11 and run a Linux container? |
| [windows-dpapi](config/suites/windows-dpapi/suite.yaml) | Does DPAPI protect a small secret for one user, and who else can open it? |
| [windows-task-probe](config/suites/windows-task-probe/suite.yaml) | Which way of starting a program as an ordinary Windows account gives it a loaded profile and working DPAPI? Ten ways, four without Task Scheduler, before and after an account is signed in at the screen |
| [windows-credential-manager](config/suites/windows-credential-manager/suite.yaml) | Does Credential Manager keep a small secret for one user, and who else can read it? |

## Commands

Which commands are finished and which are planned is in [ROADMAP.md](ROADMAP.md#commands).

| Command | What it does |
| --- | --- |
| `vmlab config check` | Checks your config and names the file and line of any mistake. Makes nothing |
| `vmlab list` | Lists the profiles, suites, sources and runs it can find |
| `vmlab plan RUN` | Shows what a run would make, where, for how long, and the estimated cost. Makes nothing |
| `vmlab test RUN` | Plan, ask yes, make the machines, run the suites, delete the machines, report |
| `vmlab sweep` | Deletes anything vmlab made that is past its expiry time. Asks first |

Run them with `just vmlab ...`, and add `--provider azure` to use real Azure (the default `dry` provider makes and runs nothing, so you can see a whole run for free).

**Exit codes.** `0` only when every step ran and passed. `1` when anything failed. `4` when nothing failed but something did not run: a gap is never a pass. `2` when the config or plan is wrong. `3` when you did not say yes.

## Promises

- **Nothing is made without a plan you have seen and a yes from you.**
- **Everything made is deleted,** even when a test fails. Anything left is found by `sweep`.
- **No passwords or tokens in the repo, the logs, the image or the run record.** Sign-in tokens live in a Docker volume on your computer.
- **You can read and change every setting,** and each run records the exact values it used.
- **Sources are deny-by-default.** Nothing is fetched onto a machine unless your policy allows that repository and ref.
- **Windows 11 is a required target,** because a lot of real machines run it. If it cannot run, that is a gap in the report.

## Where things are

```
vmlab.yaml            defaults (committed)
vmlab.local.yaml      your own statements, such as your licence note (git-ignored)
config/profiles/      machine descriptions: system, image, size
config/suites/        a folder per suite: suite.yaml and its scripts
config/runs/          what to test, on which profiles
config/sources/       code a run may fetch, and how
runs/                 one record per run, with every step's output (git-ignored)
docs/                 the design, the install steps, cost, research, and every decision
cli/                  the TypeScript command line (it runs from source in Docker)
```

Start with [docs/README.md](docs/README.md) for the full list, and [ROADMAP.md](ROADMAP.md) for what is done and what is next. Decisions, with the date and who made them, are in [docs/decisions.md](docs/decisions.md).

## License

MIT. See [LICENSE](LICENSE).
