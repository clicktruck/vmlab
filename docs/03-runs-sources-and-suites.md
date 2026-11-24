# Runs, sources and suites

**In short:** a test is a small file you write, not a script you run. A **run** names a machine **profile**, the **sources** (code to fetch) and the **suites** (scripts and checks). Everything lives in a config directory. vmlab fetches only what a policy allows. What is finished and what is not is in [ROADMAP.md](../ROADMAP.md).

## Why declarative

You say what should be tested and what must be true. vmlab does the making, fetching, running, checking and deleting, and writes down what it did. The same run file gives the same plan on any computer, and a person or an agent can read it, review it and change it.

## The config directory

```
vmlab.yaml                  the defaults (committed)
vmlab.local.yaml            your overrides (git ignores it)
config/
  profiles/                 one file per kind of machine
  suites/<name>/            suite.yaml and the scripts it runs
  sources/                  one file per thing that may be fetched
  runs/                     one file per test: profile + sources + suites
```

`config_dirs` in `vmlab.yaml` is a list. Later directories win over earlier ones, file by file. So a project keeps its own run, suite and source files in its own repo and points vmlab at them:

```
vmlab test my-run --config-dir ../my-project/vmlab
```

vmlab ships only general parts: machine profiles and suites that name no project. A project's own parts live with the project.

## The four kinds of file

| Kind | What it says | Example in this repo |
| --- | --- | --- |
| Profile | The machine: image, size, disk, network, and the licence it needs | [windows-11](../config/profiles/windows-11.yaml), [windows-server-2025](../config/profiles/windows-server-2025.yaml) |
| Suite | Steps to run on the machine, as whom, with a time limit and the checks on each step's output | [windows-acl](../config/suites/windows-acl/suite.yaml) |
| Source | Code that may be fetched onto the machine, and how | [example](../config/sources/example.yaml) |
| Run | One test: a profile, the sources (and refs), the suites | [windows-acl](../config/runs/windows-acl.yaml) |

### Suites that ship with vmlab

What each suite has shown so far is in [ROADMAP.md](../ROADMAP.md#the-suites-that-ship).

| Suite | Question it answers |
| --- | --- |
| [windows-acl](../config/suites/windows-acl/suite.yaml) | What does Windows do with a file's access list? |
| [network-probe](../config/suites/network-probe/suite.yaml) | Can the machine reach GitHub, Docker, Microsoft and PyPI? |
| [windows-docker-desktop](../config/suites/windows-docker-desktop/suite.yaml) | Can Docker Desktop be installed on Windows 11 and run a Linux container? Needs nested virtualization, and a desktop program must start without a desktop; neither is known yet |
| [windows-dpapi](../config/suites/windows-dpapi/suite.yaml) | Does DPAPI protect a small secret for one user, and who can open it? As one ordinary user, another, the administrator and the system account, before and after a restart |
| [windows-task-probe](../config/suites/windows-task-probe/suite.yaml) | Which way of starting a program as an ordinary Windows account gives it a loaded profile and working DPAPI? Ten ways, four without Task Scheduler, before and after an account is signed in at the screen |
| [windows-credential-manager](../config/suites/windows-credential-manager/suite.yaml) | Does Credential Manager keep a small secret for one user from a program with no desktop? Who can read it, which persistence kinds and sizes work, and does it survive a restart |

### Step kinds and inputs

A suite step is either a **script** (the default: a file, who runs it, a time limit and its checks) or a **restart** (`kind: reboot`): vmlab restarts the machine and waits until Azure reports it running with its agent ready, then goes on. A script cannot survive a restart, so anything that needs one (for example installing Docker Desktop) is split in two scripts with a restart between them.

A step's `run_as` can be `admin`, `system`, or `user:NAME`. The first time a step asks for `user:alice`, vmlab makes that ordinary local account on the machine (a member of Users only, allowed to log on as a batch job) with a password it chose for this run, and blanks the password out of everything it saves. The step then runs through a scheduled task as that account, so Windows loads the account's profile, the way it would for a program the account started. (Azure's own run-as-user does not load a profile, which broke DPAPI in run 8.) The account goes away with the machine. What has been seen live is in [07](07-what-has-been-proven.md); the roadmap says what is still unproven.

A suite can declare **inputs**, named values its scripts take. A step lists the ones it takes (`inputs: [Version]`), and its script declares them in a `param(...)` block. The run file gives the values. A value can be written in the file, or read from an environment variable on your computer with `env:NAME`. A **secret** input (`secret: true`) can only be given as `env:NAME`, so a secret is never written in a file. It travels to the machine as a *protected* parameter, and it is blanked out of every step's output and out of the record.

### Files in and out, and whole output

Run Command hands back only about the last 4 KB of a script's output, and it cannot take a file. A run can ask for the **exchange** to get past both. The exchange is a small storage account made inside the run's own resource group, so it is deleted with the machine and nothing outlives the run. Nothing in it is public. A file is reached only through a link that is good for two hours and allows one thing (read, or write) on one name. The links are passed to the machine as protected parameters and are blanked out of every output and of the record. The account key never leaves your computer.

```yaml
exchange: true            # script output comes back whole, not cut at 4 KB
files:
  in:                     # put these on each machine before the suites run
    - { from: work/input/piece.pdf, to: 'C:\vmlab\in\piece.pdf' }
  out:                    # bring these back after; a folder comes back as its contents, in a .zip
    - { from: 'C:\vmlab\out', to: results.zip }
```

A `from` for `in` must be a path inside the project. A `to` for `out` is a plain file name: the file is saved as `runs/<id>/files/<profile>/<to>`. Any `files` entry turns the exchange on. Sending a file to a rented machine copies it to Azure, so only send what you are free to send.

### Checks a suite step can make

Only what vmlab can see from the outside: `exit_code`, `output_contains`, `output_not_contains`, `output_matches` (a regular expression). A step that fails a check is a failed test, with the output kept. More kinds of check are **Open**.

## Coverage across systems

A run names a list of profiles and runs the same suites on each machine, one after another (side by side is **Open**). The report is one table: suite by profile, with pass, fail, or a **gap** with its reason. A profile that could not run, for example a Windows 11 profile whose attestation is still `false`, is a gap. It is never shown as a pass and never left out.

```yaml
profiles: [windows-11, windows-server-2025]
```

## Fetching and testing other sources

A source is code from somewhere else that a run tests: a pull request, a branch, or a commit.

1. **Allow.** Nothing is fetched unless `policy.sources.allow` in your config matches it (for example `github.com/your-name/*`). The default is to allow nothing. A run that names a source outside the policy fails at the plan step.
2. **Pin.** vmlab resolves the ref (a branch, `refs/pull/68/head`, or a commit) to one commit before anything is made. The plan shows the commit, and the run record keeps it. What was tested is exactly known.
3. **Fetch on the machine.** The machine downloads that exact commit as an archive from GitHub (not a clone, so no Git is needed on it) and unpacks it. A public repo needs no token.
4. **A private repo** needs a read-only token. You give it as an environment variable on your computer, named in the source file (`token_env`). The plan says a token will be sent. The token goes to the machine through the cloud's protected-parameter channel, is never printed or logged, and goes away when the machine is deleted. Use a token that can only read that one repo.
5. **The machine is the only place the code runs.** It has no public address, holds no other secrets, and is deleted at the end. Even so, a source you do not trust should not be allowed: running its code is the point.

The source lands in `C:\vmlab\src\<name>` on each machine, as the files directly (no wrapping folder), and a suite's scripts can rely on that path. If the commit cannot be found, or a token the source needs is not set, the run stops before any machine is made and says so as a gap. The record's `sources` list holds the commit each source was tested at.

What is **not** checked yet: that the machine can reach GitHub at all (see below), that the archive download and the protected-parameter channel work as described (they are Azure and GitHub features, to be tried live), and the size limits of Run Command.

### Can the machine reach the internet?

Fetching a source, installing a tool, or pulling a container image all need the machine to reach the internet, and the machines vmlab makes have no public address. Microsoft's page on default outbound access (read 2026-11-23; the page is dated 2026-07-24) says that for API versions released after 31 March 2026, a *new* virtual network's subnets are private by default, so a machine without a public address has no implicit outbound route. The explicit ones it lists are a NAT gateway (its recommended method), a load balancer with outbound rules, a public IP on the machine, or a firewall. It also says a machine in a private subnet can still reach Azure Storage in the same region, and that Windows activation and updates need an explicit route. Which API version the Azure CLI used for the machines in our earlier runs is **not known**, so whether they have internet is **not known**: those runs needed none. The `network-probe` suite in `config/suites/` tries a handful of addresses and fails if any is unreachable. Run it before anything that downloads. If it fails, the fix is an explicit outbound route; that is a decision to make with the cost shown first.

## Windows 11 and the licence

Windows Server's licence is in the hourly price. Windows 11 on Azure is different: Microsoft's page says the user must hold an eligible subscription licence, and it names Microsoft 365 E3, E5, A3, A5, F3, **Business Premium** and Student Use Benefit. Another Microsoft licensing guide leaves Business Premium unticked for Azure. The two pages disagree, so vmlab does not guess. A Windows 11 profile requires an **attestation**: `attestations.windows_client_licence.holds_eligible_licence`, which is `false` until you set it to `true` after checking with Microsoft. It is a statement about *you*, so it lives in your own `vmlab.local.yaml`, set **once**, with a note on who confirmed it and when. vmlab refuses to make the machine while it is `false`. When it is `true`, vmlab passes the `Windows_Client` licence type to Azure on the request that creates the machine, and the run record shows what you set and your note. Windows 11 is a required target (D9), so confirming your licence is the first thing to do before the first Windows 11 run. Sources are in [research/01](research/01-windows-vm-options.md).

## Open

| Question | Notes |
| --- | --- |
| More kinds of checks | Files that exist, a JSON value, a Windows access list. Start with the four above |
| Setting up tools on the machine | A suite that installs Node or Git, run first. Proposed: an ordinary suite named in the run before the others |
| Docker Desktop on Windows 11 | Needs a size that allows nested virtualization (see [research](research/01-windows-vm-options.md)). A profile setting for it is proposed, not designed |
| Other places to fetch from | GitLab, a plain URL. Proposed: only GitHub in version 0.1 |
