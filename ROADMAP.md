# vmlab roadmap

This is the one place that says what is finished, what is half-finished, and what is not started. The README and the docs link here instead of repeating it, so a status is never in two places.

**Last updated:** 2026-11-23. A status moves only when something real happened: a live run, a merged change, or a decision. The evidence is in [docs/07-what-has-been-proven.md](docs/07-what-has-been-proven.md).

## How to read the statuses

| Status | What it means |
| --- | --- |
| **Completed** | Built, tested, and run on real Azure machines. The evidence is named |
| **Partial** | Built and passing its tests against a fake `az`, but not yet run on a real machine, or only part of it has been. The row says which part |
| **In progress** | Being run or changed right now |
| **Planned** | Decided and wanted, not built yet |
| **Open** | Not decided. Someone has to choose before it can be built |
| **Not wanted** | Decided against, with the decision number |

"Tested" always means unit tests that need no cloud (`just check`). "Run on real Azure" means a run record exists from a real machine. Those are different, and the table keeps them apart.

## What works today

| Feature | Status | Evidence and notes |
| --- | --- | --- |
| Config directory: profiles, suites, sources and runs, layered, with your own `vmlab.local.yaml`; mistakes named by file and line | **Completed** | Used by every live run. `vmlab config check` |
| Published JSON Schemas for the config and the run record | **Completed** | `schema/`, checked by a test |
| A syntax check of every PowerShell script vmlab sends to a Windows machine (`just lint-ps`, in a throwaway PowerShell container) | **Completed** | Found a real bug before it cost a run. A smoke check only: it parses with PowerShell 7, the machines run Windows PowerShell 5.1, and it runs nothing |
| `vmlab plan`: what would be made, where, for how long, with a cost estimate from Azure's public price list | **Completed** | Run before every live test |
| Yes before anything is made; a budget line that stops an expensive plan | **Completed** | Every live run asked and waited |
| Azure provider: one resource group per machine, tagged with an expiry, no public address, deleted at the end and checked gone | **Completed** | Live runs 3 to 7 on 2026-11-23; [the live runs](docs/07-what-has-been-proven.md#the-live-runs) |
| Windows Server 2025 and Windows 11 Enterprise machines | **Completed** | Both made and deleted in every live run since run 3. Windows 11 uses the `Windows_Client` licence type once you attest your licence |
| Size and quota checks before anything is made, with a plain message | **Completed** | Found and fixed in live runs 1 and 2 |
| Scripts run as the administrator user or the system account, with checks on the exit code and the output | **Completed** | Live runs 4 to 7 |
| Progress output: a spinner on the working step, a time on each milestone, a total at the end | **Completed** | Seen on every live run |
| Run record (`runs/<id>/run.json`) with the exact values used, every step, its output, its time and every gap | **Completed** | Read back from live runs |
| Pass, fail and **gap** reporting; a gap is never a pass; exit codes `0`, `1`, `2`, `3`, `4` | **Completed** | Tested; gap seen live for a Windows 11 profile before its licence was attested |
| Windows 11 licence attestation, with a place for a support case number | **Completed** | Used live. The case number field is only recorded, never checked |
| Deny-by-default source policy | **Partial** | Tested. No live run has fetched a source yet |
| Restart steps (`kind: reboot`) | **Completed** | Run 8: both machines restarted in about 73 seconds and the next step ran |
| Named inputs, with secrets read only from the environment and sent as protected parameters | **Partial** | Tested, including that a secret never reaches the record. First live use is the `building-blocks` suite |
| Private storage for files in and out, and for a script's whole output (Run Command alone keeps about 4 KB) | **Partial** | Tested with a fake. Not yet run live |
| Fetching a source at one exact commit (the ref is turned into a commit id on your computer; the machine downloads that commit) | **Partial** | Tested with a fake GitHub. It also needs the machine to reach the internet, which is not yet known (below) |
| Steps that run as an ordinary account (`run_as: user:NAME`) | **Partial** | Run 8: vmlab made the accounts and scripts ran as them, but Run Command starts them **without loading the account's profile**, which broke DPAPI. The step is now run through a scheduled task that logs the account on as a batch job, so the profile is loaded. Runs 9 and 10: **works on Windows Server 2025; on Windows 11 every such step timed out.** The task logs the account on but stays Queued and never starts the program. Cause unknown. The wrapper now sets every task setting, fails in a minute when a task never starts and reads the scheduler's log; Others report the same stall on client Windows until someone signs in at the screen ([research/03](docs/research/03-running-as-another-windows-user.md)). The `windows-task-probe` suite tries ten ways, four of them without Task Scheduler, then signs an account in and asks again |
| `vmlab sweep`: delete anything vmlab made that is past its expiry | **Partial** | Tested with a fake. Not yet run against real leftovers |
| Sign in with a device code (`just login`) | **Partial** | Works where the organisation allows it. At least one organisation's policy blocks it, so two other routes exist |
| Sign in by copying your own browser sign-in in (`just adopt-login`) | **Completed** | Used for the live runs |
| Sign in as a dedicated service principal that can use one subscription (`just sp-create`, `just sp-login`) | **Partial** | Built and shell-checked. Not yet run |

## The suites that ship

| Suite | The question it answers | Status |
| --- | --- | --- |
| [windows-acl](config/suites/windows-acl/suite.yaml) | What does Windows do with a file's access list, and which fix leaves exactly one entry? | **Completed**. Four runs; results in [research/02](docs/research/02-windows-file-access-lists.md) |
| [network-probe](config/suites/network-probe/suite.yaml) | Can a machine reach GitHub, Docker, Microsoft and PyPI? | **Planned to run**: written, not yet run. Run it before anything that downloads |
| [building-blocks](config/suites/building-blocks/suite.yaml) | Do inputs, secrets, whole output, files in and out, a source fetch and a restart all work? | **Planned to run**: written, not yet run |
| [windows-dpapi](config/suites/windows-dpapi/suite.yaml) | Does DPAPI protect a small secret for one user, and who else can open it? | **Partial**: **Completed on Windows Server 2025** (run 9: only the user can open the protected secret, before and after a restart). **Open on Windows 11**: its ordinary-account steps timed out |
| [windows-task-probe](config/suites/windows-task-probe/suite.yaml) | Which way of starting a program as an ordinary Windows account gives it a loaded profile and working DPAPI? Ten ways, four without Task Scheduler, before and after an account is signed in at the screen | **Planned to run**: written, not yet run (the `windows-11-diagnose` run) |
| [windows-credential-manager](config/suites/windows-credential-manager/suite.yaml) | Does Credential Manager keep a small secret for one user, and who else can read it? | **Planned to run**: written, not yet run. It runs as an ordinary account, so it probably meets the same missing-profile limit as the DPAPI run |
| [windows-docker-desktop](config/suites/windows-docker-desktop/suite.yaml) | Can Docker Desktop be installed on Windows 11 and run a Linux container? Needs nested virtualization, which is not yet known to be available | **Planned to run**: written, not yet run. The installer's hash is empty on purpose, so the first run installs nothing and prints the hash it saw |

## Commands

| Command | Status |
| --- | --- |
| `vmlab config check` | **Completed** |
| `vmlab list` | **Completed** |
| `vmlab plan RUN` | **Completed** |
| `vmlab test RUN` | **Completed** |
| `vmlab sweep` | **Partial** (see above) |
| `vmlab up`, `vmlab run`, `vmlab down`: the same steps one at a time, for looking around | **Planned** |
| `vmlab status`: list what vmlab has made that still exists | **Planned** |

## Questions that a live run has to answer

These are not features; they are facts about Azure and Windows that decide what can be built next. Each names the run that answers it.

| Question | Status | Answered by |
| --- | --- | --- |
| Can a machine vmlab makes reach the internet? Microsoft says new virtual networks have no implicit outbound route (read 2026-11-23); which API version the Azure CLI uses is not known | **Open** | `network-probe` |
| Can Run Command start a script as an ordinary account with no desktop sign-in? | **Answered, with a catch** | Run 8: yes, it runs as the account, but with no profile loaded |
| Does a scheduled task (the account logged on as a batch job) give a step a loaded profile? | **Answered for Server 2025: yes. Windows 11: no, so far** | Runs 9 and 10. The `windows-11-diagnose` run tries seven ways on Windows 11 and reads the Task Scheduler's own log |
| Does Run Command's whole-output storage link work from a machine in a private subnet? Microsoft says same-region storage stays reachable | **Open** | `building-blocks` |
| Can Docker Desktop run on a rented Windows 11 machine at all? | **Open** | `windows-docker-desktop` |

## What comes next

| Item | Status | Notes |
| --- | --- | --- |
| Give a machine an explicit way out to the internet (for example a NAT gateway) | **Open** | Only if `network-probe` says it is needed. It has a cost, so the plan would show it first |
| Run a step as another named account on Linux machines, and Linux and macOS profiles | **Open** | Not decided. The provider interface is meant to make a new system an adapter, not a rewrite |
| Other clouds (AWS, Google Cloud, Oracle) | **Open** | Not planned yet |
| A local virtual machine provider (VirtualBox, UTM, VMware Fusion) | **Not wanted** | Decided against: D7 |
| More kinds of check on a step (beyond exit code and output text) | **Open** | |
| Run the machines of one run side by side instead of one after another | **Open** | Slower but simpler today |
| Stop waiting in 30-second jumps: start a step without waiting and check its state every few seconds | **Planned** | Measured: every send step takes a multiple of about 31 seconds, so each wastes up to 30 ([research/03](docs/research/03-running-as-another-windows-user.md)). To be tried by itself on `building-blocks`, never during a diagnosis |
| Replace the scheduled task with a direct launch for `user:NAME` steps | **Open** | Depends on what the probe shows |
| A step that needs an earlier step: skip it, as a gap, when that one failed | **Planned** | Run 9 spent minutes on steps that could not pass |
| Keep one machine up and send it scripts one at a time (`up`, `run`, `down`) | **Planned** | The fallback if a question does not settle in one more run: it turns a 30-minute loop into a 1-minute one |
| Spot pricing for the machines | **Open** | Cheaper, but a machine can be taken back mid-run. Not tried |
| Continuous checks for vmlab itself on GitHub | **Open** | `just check` runs in Docker today; no hosted workflow yet |
| Dependabot, GitHub actions pinned to a commit, and release automation | **Planned** | Stated in `AGENTS.md` as the intended setup. The repo has no `.github/` folder yet |
| Docs still to write: every setting as a question (`08-config.md`), writing a suite (`09-writing-a-suite.md`), adding a provider (`10-adding-a-provider.md`), clean-up (`11-cleanup.md`) | **Planned** | |

## Where decisions are recorded

[docs/decisions.md](docs/decisions.md) has every decision with its date and who made it. Nothing here counts as decided unless it is there.
