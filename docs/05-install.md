# Install and first commands

**In short:** you need Docker, `just` and `git`. Everything else runs in a container. Sign in to Azure once; the token lives in a Docker volume on your computer, never in this folder or the image.

Every command below runs in a terminal **in the vmlab folder**. Nothing here makes anything in Azure until `vmlab test` and your yes.

## 1. Check the computer

```bash
just doctor
```

Expect three lines that start with `ok`, then `All three are here.` A missing tool is named with the command to install it.

## 2. Build the image

```bash
just images
```

Expect a few minutes the first time (it installs Node, the Azure CLI and the dependencies), then `Image vmlab-cli Built`.

## 3. Check the config (makes nothing)

```bash
just vmlab config check
```

Expect `Config is clean: 2 profiles, 1 suites, 1 sources, 1 runs`. A mistake is reported with the file and the line.

## 4. See what a run would do (reads Azure's public price list only)

```bash
just vmlab --provider azure plan windows-acl
```

Expect a plan for each machine profile, an estimated cost (for example `at most $0.14`), and no `CANNOT GO AHEAD` line. If Windows 11 shows `GAP`, you have not set the licence attestation yet ([04](04-azure-and-windows-11-access.md)).

## 5. Sign in to Azure (once)

```bash
just login --tenant YOUR-TENANT.onmicrosoft.com
```

Expect a line with a web address and a short code. Open the address in your browser, type the code, and approve any multi-factor prompt. The terminal then lists your subscriptions. Check who you are signed in as:

```bash
just whoami
```

Expect a table with your subscription name, `Enabled`, your tenant and your user. To forget the sign-in: `just logout`.

**If the browser says "You don't have access to this".** Your organisation's sign-in rules may block the device-code kind of sign-in (a common rule; the error's **More details** names the code and sometimes the policy). The ordinary browser sign-in on your own computer may still work. Then:

```bash
az login --tenant YOUR-TENANT.onmicrosoft.com
just adopt-login
```

The first signs in on this computer (the Azure CLI, if you have one; it opens your browser). The second asks `Copy it? [y/N]`, then copies two files, your tokens and your subscription list, into the Docker volume vmlab uses, and prints the subscription it can now see. It shows no secrets. It leaves a second copy of your sign-in in Docker until you run `just logout`. 

**Route B: a dedicated sign-in for vmlab (a service principal).** Better for repeated or unattended runs, because vmlab then does not use your own sign-in at all.

| What | Detail |
| --- | --- |
| Create it | Sign in first by either way above, then `just sp-create` (or `just sp-create my-name`). It asks `Create it? [y/N]`, because it makes an identity in your directory |
| What it is | An app registration and service principal with the **Contributor** role on the one subscription you are signed in to, and nothing else. A secret made by Azure, valid one year, kept in the Docker volume, never printed |
| What you need | The right to register applications in your directory (for example Application Administrator) **and** to assign roles on the subscription (Owner or User Access Administrator) |
| Then | Your own sign-in is removed from the volume. vmlab runs as the robot. `just whoami` shows its application id instead of your name |
| Already have one | `just sp-login` asks for the tenant, application id and a secret you type without it showing |
| Expiry | After a year the secret stops working: make a new one with `just sp-create`, and delete the old one in the Azure portal, **Microsoft Entra ID**, **App registrations**, your app, **Certificates & secrets** |
| Delete it | In the portal, **App registrations**, the app, **Delete**. Then `just logout` removes the secret from the volume |

The Azure CLI keeps a service principal's secret in its config folder inside the volume, **unencrypted**. That is the Azure CLI's own behaviour. `just logout` deletes the volume. Your organisation may restrict who can register applications; if `just sp-create` is refused, the error says why. A licence attestation for Windows 11 is still **yours**: the service principal is not a person and holds no licence.

## 6. The first real run (makes machines, costs a few cents)

```bash
just vmlab --provider azure test windows-acl
```

It prints the plan and asks `[y/N]`. Nothing is made unless you answer `y`. Then it tells you each step as it happens, with the time since the run began and how long each step took:

```
[00:00:02] windows-server-2025: > making the machine
[00:00:03]   windows-server-2025: > checking the Azure services (registering any that are not)
[00:00:05]   windows-server-2025: done: checking the Azure services (registering any that are not) (2.1s)
[00:00:09]   windows-server-2025: ⠹ creating the VM (usually 3 to 6 minutes)   <- the spinner, redrawn in place
[00:04:21]   windows-server-2025: ✔ creating the VM (usually 3 to 6 minutes) (4m12s)   <- what the line becomes
```

On a terminal the step that is working shows a spinner at the left of its text, and its line is rewritten with a tick and its duration when it ends. Each milestone is stamped with the time it began. Without a terminal (a log or CI), you get one line when a step starts and one when it ends. A step that fails says `FAILED` with its time. The progress goes to the screen's error channel, so `--json` output stays clean. At the end you get a table of results, the total time, and the path of a record under `runs/` that keeps every step with its start time and duration. The exit code is `0` only when every step passed. See [the README](../README.md) for the others.

If vmlab says you have no vCPU quota for the size, that is a limit on a new subscription, not a fault: see [06](06-sizing-and-cost.md#quota-the-limit-that-decided-it) for how to ask for more, or use a size from a family that has room.

If anything is left behind, `just vmlab sweep` deletes what is past its expiry. You can also check by hand: in the Azure portal, **Resource groups** should hold nothing that starts with `vmlab-`.
