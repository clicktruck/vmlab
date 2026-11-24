# How vmlab works

**In short:** you write a config file and a suite of scripts. vmlab shows you a plan, asks yes, makes a machine, runs the suites on it, deletes the machine, and writes down what happened. What is finished and what is not is in [ROADMAP.md](../ROADMAP.md).

## A run, start to finish

| Step | What happens | If it goes wrong |
| --- | --- | --- |
| 1. Check | The config is checked against the schema. You are signed in to the cloud. The size and image exist in your region | Stops. Nothing was made. Says which line or which check |
| 2. Plan | Prints what will be made, the region, the estimated cost an hour, the expiry time, and what will be deleted | Stops if the estimate is over your budget line |
| 3. Yes | You say yes, or you passed `--yes` | No yes, no machine |
| 4. Make | One resource group (a folder for everything made), tagged with the run and its expiry. One machine inside it, with no public address and no open ports | Deletes what was made so far, then says what failed |
| 5. Run | Each suite's scripts run on the machine, one at a time, as the user named in the suite. Output is kept | A failing script is a failed test, not a crash. The rest still run unless the suite says stop |
| 6. Delete | The resource group is deleted and vmlab checks it is gone | If the delete fails, it says so first, in the report, and `sweep` will find the group by its expiry tag |
| 6b. Tell you | Each milestone is stamped with the time it began. On a terminal the working step shows a spinner at its left and is rewritten with a tick and its duration when it ends; without a terminal there is a line at the start and one at the end. The summary ends with the total processing time. The same timings are kept in the record | A failed step says FAILED with its time |
| 7. Record | `runs/<id>/run.json` holds the exact config used, each step with its time, each test's result and output, and the cost estimate | A gap is listed with its reason, never left blank |

## Commands

See the table in the [README](../README.md). The command line is made from one list of actions in `cli/src/actions.ts`, and a test checks that the docs list the same commands.

## The config

Declarative, in files, checked against JSON Schemas before anything is made. `vmlab.yaml` holds the defaults; `vmlab.local.yaml` (git ignores it) holds yours. The parts of a test (machine **profiles**, **suites**, **sources** and **runs**) live in a config directory, and a project can keep its own next to its code. Every value can also be set on the command line or in an environment variable, and the command line wins. The record of a run shows each setting's final value and where it came from. The whole design, including how other people's code is fetched under a policy, is in [03-runs-sources-and-suites.md](03-runs-sources-and-suites.md).

## Providers

A provider is a small module that implements one interface: `plan`, `up`, `exec` (with named inputs), `reboot`, `down`, `sweep`. Nothing outside a provider names a cloud.

| Provider | Notes |
| --- | --- |
| `dry` | Makes nothing. Records what it would have done. All unit tests use it |
| `azure` | Uses the Azure CLI inside the container, with an argument list and no shell. One resource group per machine, tagged with its expiry; no public address, no open ports; commands go through Azure Run Command; the group is deleted at the end, and `vmlab sweep` finds any left behind. What has been run on real Azure is in [07](07-what-has-been-proven.md) |
| AWS, Google Cloud, Oracle | Not planned yet. The interface is meant to make them an adapter, not a rewrite |
| A local virtual machine (VirtualBox, UTM, VMware Fusion) | Decided against (D7) |

## Suites

A suite is a folder in a config directory, for example [`config/suites/windows-acl/`](../config/suites/windows-acl/suite.yaml): a `suite.yaml` that names the scripts, who each runs as (`admin`, `system`, or a named user), a time limit and the checks on the output, plus the scripts. See [03](03-runs-sources-and-suites.md).

## Safety, in one place

- A plan and a yes before anything is made.
- Machines have no public address and open no ports. Commands reach them through the cloud's own channel.
- The password is made fresh, handed to the cloud, and forgotten. It is never printed, logged or stored.
- Every object carries an expiry tag. `vmlab sweep` deletes what has expired.
- Sign-in tokens live in a Docker volume on your computer, made once with `just login`. They are not in the repo, the image or the run records.
- The budget line stops a plan that costs more than you said.
- Pay-as-you-go Azure has **no spending cap**. A budget alert in the Azure portal warns you; it does not stop spending. vmlab's own deleting is the main protection.

## Open

See [decisions.md](decisions.md).
