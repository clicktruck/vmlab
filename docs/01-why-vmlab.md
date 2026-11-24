# Why vmlab

**In short:** vmlab rents a clean machine for minutes, runs your tests on it, and deletes it. It exists because some bugs only appear on an operating system you do not have.

## Situation

- Your computer is a Mac with an Apple chip. It cannot run Intel Windows. It can run Windows for Arm in a virtual machine, but that machine cannot run Docker Desktop inside it, because nested virtualization is not available for Windows guests on Apple chips (Parallels says so for its own product; see [research](research/01-windows-vm-options.md)).
- The usual answer is a Windows runner on GitHub. That means a push, a wait, and a log. You cannot look inside the machine or try a second idea in the same minute.
- The case that started this: a pull request that locks a saved key file so only one user can open it, using the Windows tool `icacls`. It passed on Linux and macOS and failed three times on a GitHub Windows runner. Each try cost a push and ten minutes, and the log did not say why.
- Windows needs a licence. A test machine should not need a key bought, hunted for or typed in.

## Opportunity

- A cloud provider can create a fresh Windows machine in minutes. On Azure the licence is part of the hourly price, so no key is needed. A small one costs about five cents an hour: $0.0496 for a 2-CPU Windows Server machine in East US 2, from Azure's own price list, read 2026-11-23.
- The machine can be run from a script. The same script can be run by a person or by an agent such as Claude Code.
- If the machine is deleted when the test ends, the cost stays at cents and nothing is left to patch, secure or forget.

## Impact

| Today | With vmlab |
| --- | --- |
| A try takes a push and ten minutes | A try takes a few minutes, and a second idea can run on the same machine |
| The log is all you get | You can run any command on the machine and read its answer |
| Windows is out of reach on a Mac | A real Intel Windows machine, for cents |
| A product key to find | None: the licence is in the hourly price |
| A forgotten machine costs money every hour | Every run deletes what it made, and `sweep` finds anything left |

## What vmlab is not

- It is not a replacement for CI. CI runs on every pull request; vmlab is for a person or an agent who needs an answer now.
- It is not a long-lived development machine, a build farm, or a way to run production.
- It is not tied to one project. Nothing in vmlab names the project that started it.
