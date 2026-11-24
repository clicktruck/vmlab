# What Windows does with a file's access list

**Status: four runs done (2026-11-23).** Two ways of making the file private were observed to work everywhere tried. This page is filled in from a run record (`runs/<id>/run.json`), never from memory. Where a result was not observed, or only guessed, it says so.

## The question

A program saves a secret, such as an access token, in a file. On macOS and Linux it makes the file readable by its owner alone (mode 600). On Windows the same idea is an **access control list** (ACL): the list of who may open the file. A new file normally **inherits** its list from the folder it is in, so it usually starts with several entries (for example the system account, the Administrators group, and the current user). To make a file private, a program has to:

1. give the current user full control, and
2. stop the file inheriting, and remove the entries it inherited.

The Windows tool `icacls` does both. This note records what it does in practice, on the Windows versions in the suite's run, in the order and combination a program would use.

## The method

The suite is [`config/suites/windows-acl`](../../config/suites/windows-acl/suite.yaml). It runs on each machine, once as an administrator user and once as the system account. In each run it creates new files in a new folder and locks each file one way:

| Variant | What it does |
| --- | --- |
| Before | A new file, untouched, to show what it inherits |
| A | Grant the current user full control (`/grant:r`), then turn inheritance off and remove inherited entries (`/inheritance:r`) |
| B | Turn inheritance off first, then grant |
| C | PowerShell's own ACL call (`Set-Acl`) with inheritance off and one rule |
| D | Copy the inherited entries into the file (`/inheritance:d`), remove the system and Administrators entries by name, then grant |
| F | Variant A, then remove the system account and Administrators by their well-known SIDs. Added after the first run |

For each file it prints, on one line, who may open it, whether each entry was inherited, and whether the list is **protected** (inheritance off). Run Command returns only about 4 KB of output, so the script is compact on purpose. A second scenario, added after the first run, makes the files in a folder that passes no entries down. The check for "private" is: one entry, the current user, not inherited, and the list is protected.

The steps ran on machines made by vmlab: Windows 11 Enterprise 25H2 and Windows Server 2025, each in Azure, with no public address, deleted at the end of the run.

## Results

### Run on 2026-11-23: a folder whose entries pass down (the usual case)

Run through vmlab on **Windows 11 Enterprise 25H2 (build 26200)** and **Windows Server 2025 Datacenter Azure Edition (build 26100)**, each as the administrator user the machine was made with and as the system account. All eight runs finished with exit code 0. The record is `runs/20261123T210109Z-windows-acl-9306/run.json` (kept locally; run records are not committed).

| Step | Entries on the new file |
| --- | --- |
| Before (untouched) | Two, both **inherited**: `BUILTIN\Administrators` and `NT AUTHORITY\SYSTEM`, full control. Not protected |
| A: grant the user (`/grant:r`), then `/inheritance:r` | **One**: the current user, full control, **not inherited**. Protected |
| B: `/inheritance:r` first, then grant | The same: one entry, protected |
| C: PowerShell `Set-Acl` with one rule | The same |
| D: `/inheritance:d`, remove SYSTEM and Administrators by name, then grant | The same |

When the program ran as the system account, "the current user" was `NT AUTHORITY\SYSTEM`, and the result was one entry for it, in the same four ways.

**What this shows:** in this setup, the plain recipe (A: grant, then turn inheritance off) does what is wanted, on both systems, for both kinds of user. The order did not matter (A and B).

**What it does not show:** a different result seen elsewhere. A test of the same recipe on a hosted build machine (a Windows Server 2025 image used by a code host) once left **three** entries on the file, not one, each *not* marked inherited: the system account, the Administrators group and the current user. The second run explains it.

### Run on 2026-11-23, second run: a folder that passes nothing down

Same two systems, same two kinds of user. Record: `runs/20261123T214248Z-windows-acl-8252/run.json`.

| Where the file was made | A new file starts with |
| --- | --- |
| A folder that passes its entries down | Two **inherited** entries (Administrators, SYSTEM) |
| A folder that passes **nothing** down | Two or three **explicit** entries, copied from the creating process's default: SYSTEM (full control), Administrators, and, for an administrator user, a **logon-session** entry (read and execute). For the system account: SYSTEM (full control) and Administrators (read and execute) |

What each recipe left in the second kind of folder, as the administrator user (both systems gave the same):

| Recipe | Entries left | Private? |
| --- | --- | --- |
| **A:** grant the user, then `/inheritance:r` (the code in the pull request) | **Four**: SYSTEM, Administrators, the logon session, and the user | **No** |
| B: `/inheritance:r`, then grant | The same four | **No** |
| C: PowerShell `Set-Acl` with a new, protected list holding one rule | **One**: the user | Yes |
| D: copy the entries, remove SYSTEM and Administrators by name, then grant | Two: the logon session and the user | No |
| F: A, then remove SYSTEM and Administrators by SID | Two, as D. **And as the system account, zero entries**: it removed the only entry, so nobody could open the file | **No, and unsafe** |

**What this shows (observed):** when the folder passes nothing down, turning inheritance off removes nothing, because nothing was inherited. A grant only *adds* an entry. So the recipe leaves whatever the process's default entries were. Only a recipe that **replaces the whole list**, or reads it back and removes every other entry, gives one entry. This matches the hosted machine's three explicit, non-inherited entries.

**What it does not show (inferred, not tested):** that the hosted machine's temporary folder passes nothing down. Its result is consistent with that, but nobody read its folder's list. Removing entries by a fixed list of well-known names or SIDs is not safe: it misses the logon session, and it can remove the user's own entry.

### Run on 2026-11-23, third run: a first candidate fix (variant G)

Same two systems, same two kinds of user. Record: `runs/20261123T221102Z-windows-acl-5499/run.json`.

Variant G: grant the user, turn inheritance off, **read the list back and remove every entry that is not the current user, by the name `icacls` printed**. It uses only `icacls`.

| Where | As | Entries left by G | Private? |
| --- | --- | --- | --- |
| A folder that passes its entries down | administrator user, system account | One | Yes |
| A folder that passes nothing down | system account | One | Yes |
| A folder that passes nothing down | **administrator user** | **Two**: the user and the logon session | **No** |

**What this shows (observed):** removing by printed name works for SYSTEM and Administrators but not for the logon-session entry. `icacls` prints it as `NT AUTHORITY\LogonSessionId_0_<n>` with read-and-execute, and a removal that names it by that text left it in place. The script threw away `icacls`'s answer to the removal, so **why** it did nothing was not recorded; that is a gap, and the next run prints it. The same happened on Windows 11 and on Windows Server 2025.

**What it means for a fix:** a program that checks the result afterwards, and refuses to write the secret unless exactly one entry is left, would have stopped here instead of writing into a file that anyone in the logon session could read. That check is worth keeping whatever fix is chosen.

### Run on 2026-11-23, fourth run: two fixes (variants H and I)

Same two systems, same two kinds of user. Record: `runs/20261123T222957Z-windows-acl-c714/run.json`. All four steps passed their checks.

| Variant | What it does | Entries left, in every case tried (2 systems × 2 users × 2 kinds of folder) |
| --- | --- | --- |
| **H** | Grant the user, turn inheritance off, read the list back, remove every other entry. A logon-session name is first turned into its SID (`S-1-5-5-0-<n>`) | **One**: the user (or the system account when that is who runs) |
| **I** | Replace the whole list in one step: write a one-entry list for the user's SID to a file, then `icacls <folder> /restore <file>` | **One**, the same |
| C | PowerShell `Set-Acl` with a new, protected list | One, as before |

**What this shows (observed):**
- Each removal printed "Successfully processed 1 files". The earlier failure was the logon-session name: removing it **by SID** worked.
- `icacls /restore` with a list written as UTF-16 (`Set-Content -Encoding Unicode`) and one line of text, `D:P(A;;FA;;;<the user's SID>)`, set the list in one step. It needed no reading back and no names.
- `icacls /save` writes text that is awkward to parse: it is UTF-16, it uses short codes (`LA`, `BA`, `SY`) for some accounts and a full SID for others, and it writes rights as numbers (`0x1200a9`). A fix that reads names from plain `icacls` output (H) avoids that, but the names are in the Windows display language.

**What it does not show (not tested):** a Windows in a language other than English. `icacls` prints account names in the display language, so a fix that matches names (H) may behave differently there; a fix that never reads a name (I) should not. Nor was the file's **owner** checked, nor a file on a network share or a non-NTFS drive. Variant I's list file was written to the system's temporary folder and deleted straight after.

### Timings and cost, same run

| | Windows 11 | Windows Server 2025 |
| --- | --- | --- |
| Making the machine | 3m04s | 1m41s |
| The script, as the administrator user (first use of Run Command on a new machine) | 3m36s | 2m35s |
| The script, as the system account | 33s | 1m05s |
| Deleting the group | 2m07s | 3m08s |

The whole run took 17.8 minutes. Compute cost at the Windows rate on `Standard_D2s_v6` in East US was about **6 cents** for both machines together.

## What was not tested

- Windows editions that cannot be rented from Azure (Home, Education).
- A file on a network share, or on a drive that is not NTFS.
- A program that runs inside a container on Windows rather than on Windows itself.
