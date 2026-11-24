# What has been proven

**In short:** this page is the evidence. It lists what vmlab has been seen to do on real Azure machines, with the date and the run, what was measured, and what has not been shown yet. What is finished, half-finished and planned is in [ROADMAP.md](../ROADMAP.md). That page links here for the proof.

## What the words mean here

| Word | Meaning |
| --- | --- |
| **Proven** | A run record exists from real Azure machines, and it shows the thing happening. The run is named |
| **Tested** | Unit tests pass against a fake `az`. They need no cloud and run with `just check`. A test shows the code does what its author meant, not that Azure or Windows agrees |
| **Syntax-checked** | `just lint-ps` parses every PowerShell script with PowerShell 7 in a container. The machines run Windows PowerShell 5.1, so this catches typos only. It runs nothing |
| **Not shown** | Neither of the above, or only part of it |

Run records are kept on the computer that made them (`runs/` is git-ignored, because a record can hold a project's own output). The run ids below are the folder names.

## What has been seen on real Azure

| Claim | Evidence | What it does not show |
| --- | --- | --- |
| The plan, the size check and the quota check run before anything is made, and say plainly why they stop | Runs 1 and 2 stopped at them with nothing made; run 3 passed them | A region other than East US |
| One resource group per machine, tagged with its expiry, no public address, deleted at the end and checked gone | Runs 3 to 7, every machine | A group left behind by a crash (`vmlab sweep` has not been run on one) |
| A Windows Server 2025 machine and a Windows 11 Enterprise machine (with the `Windows_Client` licence type, once the licence is attested) are made and deleted | Runs 3 to 7 | That Microsoft's licence terms are met: that is your statement, not something vmlab can check |
| A script runs as the administrator user and as the system account, and the exit code and the output come back | Runs 4 to 7 | A script as an ordinary account (the DPAPI and Credential Manager suites are the first) |
| Checks on the exit code and the output decide pass or fail | Run 6 had a step that failed a check and the result said so | |
| A restart step restarts the machine, waits until it can run scripts again, and the suite carries on | Run 8: both machines restarted in about 73 seconds, and the next step ran | |
| A step can run as an ordinary local account that vmlab makes, with a password only the run knows, **with its profile loaded**, with nobody signed in | Run 12, on **Windows 11** and **Windows Server 2025**: every step as `alice` and `bob` ran, and DPAPI worked for each, which needs a loaded profile. (Run 9 had shown it on Windows Server 2025; run 11 showed why Windows 11 needed the task started with its conditions ignored) | An `admin` step still goes through Azure's own run-as, which loads no profile. Other Windows versions and editions |
| DPAPI (PowerShell `ProtectedData` and the `SecureString` text form) protects a small secret for one user | Runs 11 and 12, on **Windows 11** and **Windows Server 2025**: the user protected a secret and opened it, and again after a restart. Another ordinary user could not (`Key not valid for use in specified state`). The system account could not. Each of those two first proved it could use DPAPI on its own data, so the refusal is a real one. The protected bytes did not hold the secret in clear | An **administrator**: left out until admin steps run with a profile. An administrator who knows or resets the user's password. Anything but the PowerShell route. A signed-in person's own program (the test account is logged on as a batch job) |
| Windows Credential Manager keeps a small secret for one user, reached with `CredWrite` and `CredRead` from PowerShell | Run 13, on **Windows 11** and **Windows Server 2025**: an ordinary account saved a made-up secret and read it back, and again after a restart. Another ordinary account and the system account found nothing under that name (error 1168, not found), after the suite had proved a secret was saved. All three persistence kinds were accepted. A secret of **2,560 bytes was accepted and 2,561 was refused** (error 1783) | An **administrator** (left out until admin steps run with a profile). A signed-in person's own program (the test account is logged on as a background job). Whether the "this sign-in only" kind really goes at sign-out. The `cmdkey` tool and the `PasswordVault` class |
| A Windows 11 machine made by vmlab can reach the internet | Run 11: GitHub, Microsoft, Docker's download and registry hosts and PyPI all answered | Windows Server 2025 (same kind of network, not yet probed). Whether Azure keeps giving new networks a way out |
| A run's progress shows a time on each milestone and a total at the end | Every run | |
| The run record holds the exact values used, each step, its output and its time | Read back from runs 4 to 7 | |

## What a run costs and how long it takes

Measured on `Standard_D2s_v6` in East US, on 2026-11-23, one machine after the other. Prices come from Azure's public price list and change; the plan shows the current estimate.

| Step | Windows 11 | Windows Server 2025 |
| --- | --- | --- |
| Making the machine | about 3 minutes (2m07s for the VM alone, ready in 3m02s) | about 1.5 to 2 minutes |
| First script as the administrator user (Run Command warms up on a new machine) | about 3.5 minutes | about 2.5 minutes |
| A later script as the system account | about 30 seconds | about 30 seconds |
| Deleting the machine and checking it is gone | 2 to 3 minutes | 2 to 3 minutes |
| **A whole run on both machines** | **16 to 18 minutes** | |
| **Compute cost of that run** | **about 6 cents** (run 4; the later runs used the same two machines for the same time) | |

## The live runs

Runs 1 to 7 on 2026-11-23, runs 8 to 13 that evening and night (their records are stamped 2026-11-24 in UTC), all against one pay-as-you-go subscription.

| Run | What | Result |
| --- | --- | --- |
| 1 | `Standard_B2s` and `Standard_B2ms`, East US 2 | Stopped by the size check: those sizes are not offered to the subscription. Nothing was made |
| 2 | `Standard_B2s_v2`, East US | The size passed the size check. **Both machines were refused within about 3 seconds** (vCPU quota 0 for its family). The Azure CLI crashed while reporting it. Each resource group was deleted and checked gone in 17 seconds. Nothing was left behind and nothing was billed |
| 3 | `Standard_D2s_v6`, East US | **Both machines were made and deleted.** Windows 11: VM created in 2m07s (machine ready in 3m02s), deleted in 3m08s. Windows Server 2025: VM created in 1m36s, deleted in 2m07s. The quota check passed in 1 second, and the size lookup (49 seconds) ran once, not twice. **The script step failed on all four runs in 0.2 seconds**: `az vm run-command create` requires the name as `--run-command-name`, and the code passed `-n`. Both resource groups were deleted and checked gone. Machines lived about 6 and 4 minutes, so the compute cost was a few cents |
| 4 | The same, with the flag fixed. First access-list suite | **Passed end to end.** Both machines made, the script run as the administrator user and as the system account on each, all eight results read back, both groups deleted and checked gone. 17.8 minutes, about 6 cents of compute. The first Run Command on a new machine took 2.5 to 3.5 minutes; the second took 0.5 to 1 minute |
| 5 | Access-list suite, second scenario: a folder that passes nothing down | Passed end to end again (16.2 minutes). Reproduced a failure seen on a hosted build machine, and showed one recipe to be unsafe (see [research/02](research/02-windows-file-access-lists.md)) |
| 6 | Access-list suite, with a first candidate fix (variant G) | Ran end to end in 16m19s. **The fix failed for an administrator user in a folder that passes nothing down** on both systems: it left a second entry, the logon session. Both machines deleted. The check caught it; the result said so |
| 7 | Access-list suite, with two new candidate fixes (variants H and I) | Ran end to end in about 16m46s. **Both fixes left exactly one entry in all eight cases** (two systems, two users, two kinds of folder). Both machines deleted. Record `20261123T222957Z-windows-acl-c714` |
| 8 | DPAPI suite (first live use of restart steps and `user:NAME`) | Ran end to end in 27m50s; both machines deleted. **Restart and `user:NAME` worked.** **The DPAPI question was not answered:** `Protect` failed for the ordinary account on both systems with "not having the user profile loaded", because Run Command's run-as-user starts the script without loading the account's profile. (Run Command also printed "System error thrown for RunAs user … Error code: 1 … Secondary Logon". Across runs 8 to 10 that line appears on every run-as step that exits with code 1, including administrator steps, and on none that exit 0, so it looks like the handler's wording for a non-zero exit, not a separate fault. Inferred from the records, not confirmed in Microsoft's documentation.) Every later step then found no protected file. **Two steps in the suite passed for the wrong reason**: "others cannot open it" printed DENIED because the file did not exist. The suite now fails when the file is missing. Record `20261124T005007Z-windows-dpapi-55c9` |
| 9 | DPAPI suite again, after `user:NAME` steps were changed to run through a scheduled task so the profile is loaded | Ran end to end in 49m, both machines deleted. **Windows Server 2025: every step passed**, including DPAPI as `alice` before and after a restart, and refusals for `bob`, the administrator and the system account. **Windows 11: every `user:NAME` step timed out after 300 seconds** (the system-account and restart steps passed), so the DPAPI question is open there. Record `20261124T014701Z-windows-dpapi-312c`. Diagnostics were added to the wrapper to say why on the next run. The `SecureString` refusal line printed "wrong text came back" for the others, a script slip now fixed |

| 10 | DPAPI suite on Windows 11 alone, with diagnostics | Ran in 35m31s; the machine was deleted. **Every ordinary-account step timed out again.** The diagnostics: the task was **Queued** (never Running), its last result was 0x0, **no output file existed, and no process was running as the account**. Windows did record successful logons for the account (event 4624) at the moment the task started, so the password and the batch-logon right were accepted. The same wrapper ran in full on Windows Server 2025 in run 9. Record `20261124T030457Z-windows-dpapi-windows-11-4a58` |
| 11 | One Windows 11 machine, three suites: network reach, ten ways to run as an ordinary account, then DPAPI | Ran end to end in 24m11s, every step passed its checks, the machine was deleted. **Network:** all eight addresses answered. **With nobody signed in:** a task as the system account ran in 1 second. Stored-password tasks stayed **Queued** whether their settings were default or explicit, and through `schtasks` (scheduler events 325 "queued", 110, 325; the machine reported mains power and no battery). **The same kind of task started with its conditions ignored ran in 1 second**, with the profile loaded and DPAPI working. **A direct launch** (log the account on, load its profile, start the program with its token) worked with a batch and with an interactive logon. The route through the Secondary Logon service ended at once with `0xC0000142`. A task with no stored password could not be registered (access denied). **After a second account was signed in at the screen** (automatic sign-in, 6 seconds after the restart): a stored-password task for a *different* account ran in 2 seconds, so the hold is machine-wide and any sign-in lifts it. **DPAPI suite, then:** every step passed. Record `20261124T052500Z-windows-11-diagnose-bf51` |
| 12 | DPAPI suite on both systems, with nobody signed in, after the wrapper was changed to start its task with the conditions ignored | Ran end to end in 26m42s. **All 14 steps passed on Windows 11 and on Windows Server 2025**, and both machines were deleted. The ordinary-account steps that sat in the queue for 300 seconds in runs 9 and 10 took 33 to 129 seconds, most of it the fixed 30-second waits. Record `20261124T060542Z-windows-dpapi-ffaf` |
| 13 | Credential Manager suite on both systems, with nobody signed in | Ran end to end in 26m07s. **All 12 steps passed on Windows 11 and on Windows Server 2025**, and both machines were deleted. Record `20261124T063747Z-windows-credential-manager-efe4` |

**Left behind in the subscription:** `NetworkWatcherRG`, made by Azure itself the first time a network was created in the region. It holds one Network Watcher and carries none of vmlab's tags, so `vmlab sweep` does not touch it. Whether it costs anything was not checked.

## What has not been shown yet

These are built and tested, but no real machine has run them. Each is on the [roadmap](../ROADMAP.md) with the run that will answer it.

- Inputs, and secrets sent as protected parameters.
- Files in and out, and whole script output past 4 KB (private storage in the run).
- Fetching a source at one exact commit.
- `vmlab sweep` on something really left behind.
- Whether a Windows Server 2025 machine can reach the internet (Windows 11 can: run 11).
- Whether Docker Desktop can run on a rented Windows 11 machine.
