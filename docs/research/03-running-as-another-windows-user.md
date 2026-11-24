# Running a program as another Windows user, with nobody signed in

**Checked 2026-11-23.** Sources are linked beside each claim. **Stated** means the source says it. **Inferred** means it is our reading. **Measured** means a vmlab run record shows it ([07](../07-what-has-been-proven.md)). **Not found** means we looked and found nothing. This page is filled in from sources and records, never from memory.

## The question

A test often has to run as an ordinary user, the way a person's own program does: with that user's **profile** loaded (their part of the registry and their saved keys). vmlab reaches a machine as the system account, through Azure Run Command. How does it start a program as an ordinary account so that per-user things such as DPAPI work?

## Three ways, and what is known about each

| Way | What it is | Profile loaded? | Known trouble |
| --- | --- | --- | --- |
| **Run Command's own run-as** | Azure starts the script as the named user. The docs ask only that the user exists and the Secondary Logon service runs ([Microsoft](https://learn.microsoft.com/en-us/azure/virtual-machines/windows/run-command-managed)) | **No** (Measured, run 8: DPAPI said the profile was not loaded). Nothing public reports this (Not found) | The handler's source is not public, so no fix can be expected from our side |
| **A scheduled task with a stored password** | Windows logs the account on as a batch job and starts the program. This is what Packer ([source](https://github.com/hashicorp/packer-plugin-sdk/blob/main/guestexec/elevated.go)), Vagrant and Test Kitchen ([source](https://github.com/WinRb/winrm-elevated/blob/main/lib/winrm-elevated/scripts/elevated_shell.ps1)) do | **Yes on Windows Server 2025** (Measured, run 9) | **On client Windows the task may never start until someone has signed in at the screen** (below) |
| **A direct launch** | Log the account on (`LogonUser`), load its profile, start the program with its token. Ansible's `runas` does this through `CreateProcessWithTokenW` with the profile flag ([source](https://github.com/ansible/ansible/blob/devel/lib/ansible/module_utils/csharp/Ansible.Become.cs)); its guide says this is how to get past limits including DPAPI ([guide](https://github.com/ansible/ansible-documentation/blob/devel/docs/docsite/rst/os_guide/windows_winrm.rst)) | Expected yes (Inferred). **Not yet measured** | The window station and desktop the program is given: without access to them a program ends at once with `0xC0000142` ([Microsoft](https://learn.microsoft.com/en-us/archive/blogs/winsdk/what-is-up-with-the-application-failed-to-initialize-properly-0xc0000142-error)) |

Microsoft's own page says `CreateProcessWithLogonW` cannot be called from the system account, and points to `LogonUser` with `CreateProcessAsUser` ([Microsoft](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-createprocesswithlogonw)). `CreateProcessAsUser` does not load a profile: `LoadUserProfile` must be called first ([Microsoft](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-createprocessasuserw)). DPAPI keeps its keys in the profile and cannot decrypt without it ([Microsoft](https://learn.microsoft.com/en-us/dotnet/api/system.security.cryptography.protecteddata)).

## The stall on client Windows

**Measured (runs 9 and 10):** on Windows 11 Enterprise 25H2 a stored-password task for a new ordinary account went to **Queued** and never started, three times and after a restart. Windows logged the account on (security event 4624). No program ran. The same task ran on Windows Server 2025.

**Stated by others, never explained:**

- A GitHub Actions image issue (2024): Packer's task on a Windows 11 Enterprise Azure image does not go on until someone logs on to the machine; the same works on Windows Server 2022, and a commenter says the multi-session Windows 11 image works ([actions/runner-images #10118](https://github.com/actions/runner-images/issues/10118)).
- The Packer mailing list (2020): works on Windows Server 2012 to 2019, not on Windows 10 in Azure, until the admin user has logged in. The workaround given: turn on automatic sign-in, restart, run, turn it off ([post](https://www.mail-archive.com/packer-tool@googlegroups.com/msg04977.html)).
- Packer's task already turns both battery settings off, so those reports are **not** the battery condition.

**Not found:** any Microsoft page that explains it, or any report that a cloud machine looks "on battery". The schema's defaults are the same on client and Server Windows ([MS-TSCH](https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-tsch/2e1de7c6-804e-40db-8aeb-9e0df2b9bb02)).

**What the Task Scheduler's own log would say.** The log `Microsoft-Windows-TaskScheduler/Operational` is off by default; `wevtutil sl Microsoft-Windows-TaskScheduler/Operational /e:true` turns it on. Event names, from a public copy of the provider's manifest for an older build ([manifest](https://github.com/repnz/etw-providers-docs/blob/master/Manifests-Win10-18990/Microsoft-Windows-TaskScheduler.xml)):

| Event | Meaning |
| --- | --- |
| 100, 102 | Task started, task completed |
| 101, 104 | Task start failed, logon failure |
| 129, 200, 201 | Created the task's process, action started, action completed |
| 322, 324 | Launch request ignored or queued because an instance is already running |
| **325** | **Launch request queued** |
| 326 | Not launched: computer on batteries |
| 332 | Not launched: user not logged on |
| 135 | Not launched: machine not idle |

No run of ours has read this log yet. The `windows-task-probe` suite turns it on and prints what it holds.

## Azure Run Command, two more facts

- **Output.** The result keeps only the last 4 KB. Whole output needs `outputBlobUri` and `errorBlobUri` ([Microsoft](https://learn.microsoft.com/en-us/rest/api/compute/virtual-machine-run-commands/create-or-update)).
- **Waiting.** `az vm run-command create` waits for the script to end. The Azure CLI asks "is it done?" at the interval the service names, or every **30 seconds** if it names none ([source](https://github.com/Azure/azure-sdk-for-python/blob/main/sdk/core/azure-core/azure/core/polling/base_polling.py)). **Measured:** across runs 1 to 10 every one of 65 "send and wait" steps took a multiple of about 31 seconds (32, 63, 154…). So each step loses up to 30 seconds to the wait, which is at most about 1,950 of the 11,519 seconds those runs took (17%); the true figure is not known until it is tried. (Send steps were 6,932 seconds in all, but that includes the scripts themselves, the first-command warm-up and the 300-second timeouts.) `--no-wait` plus our own check of the instance view every few seconds is the supported way round it. **Not yet built**: a change to how every step waits should be tried by itself, not during a diagnosis.

## What this means for vmlab

1. The scheduled task may not work on client Windows with nobody signed in, whatever its settings. That is what others report (their tasks had the battery settings off); we have measured it only with default settings so far. The probe tries explicit settings.
2. The direct launch is the likely replacement on every system. It needs one live run to prove, and the probe tries four forms of it.
3. Signing an account in at the screen automatically is a second tool, and the only way to get a real desktop session (which a desktop program such as Docker Desktop needs).
