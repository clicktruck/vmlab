# Decisions

Each decision has a date and who made it. "The maintainer" is the person who owns this repo. Nothing is recorded here that the maintainer has not decided.

## Asked for (2026-11-23)

The tool must stand on its own as a new repo, be agnostic and highly configurable, serve as the way to test a project's Windows behaviour (the project that started it is private and is not named here), and follow best practice and a few working rules: plain words, one decision at a time, ask before anything outward-facing or destructive, never change the global toolchain, check facts and cite them, give complete commands.

## Decided

| ID | Decision | Detail | Date | Who |
| --- | --- | --- | --- | --- |
| D1 | The tool and its home | A new repo, `clicktruck/vmlab`. Nothing is created on GitHub without the maintainer's yes | 2026-11-23 | The maintainer |
| D2 | How it is built | Docker, `just` and a TypeScript command line, over shell scripts and over Terraform. Options offered: shell (leanest, fastest), TypeScript (typed config, real unit tests, a plug-in interface), Terraform or OpenTofu (state for machines that live minutes) | 2026-11-23 | The maintainer |
| D3 | First cloud | Azure first, on a pay-as-you-go subscription. An Azure subscription can share a sign-in and an organisation with a Microsoft 365 plan and still be a separate bill (a plan is paid yearly or monthly; Azure is paid as used). Pay-as-you-go has no spending cap: the protection is a budget alert, vmlab deleting what it makes, and `vmlab sweep` | 2026-11-23 | The maintainer |
| D4 | The licence of vmlab | MIT. `LICENSE` is in the repo | 2026-11-23 | The maintainer |
| D5 | Public or private | Public. So nothing private goes in: no private repo names, customers, tokens or subscription details in the docs, config or examples | 2026-11-23 | The maintainer |
| D6 | The first machine image | Windows 11 first, with Windows Server 2025 as the alternative, if it can be supported. Both are supported by design: each is a profile. Windows 11 on Azure needs an eligible Microsoft licence, so its profile refuses to run until the person sets `eligible_licence: true` ([03](03-runs-sources-and-suites.md#windows-11-and-the-licence)) | 2026-11-23 | The maintainer |
| D7 | A local virtual machine on the Mac | Not wanted. No local-VM provider | 2026-11-23 | The maintainer |
| D8 | Names | `vmlab.yaml` for the config and `vmlab` for the command, as proposed | 2026-11-23 | The maintainer |
| D9 | Windows 11 is required, and Server 2025 is supported too | Windows 11 is non-negotiable: many of the PCs that software has to work on run it, so it must be tested and verified on that system. Windows Server 2025 is supported as well, for coverage of the Microsoft operating systems. Both are first-class profiles. This replaces the 'if it can be supported' wording of D6. Which other Windows versions to cover is Open | 2026-11-23 | The maintainer |

## Asked for, design offered for review

The maintainer asked (2026-11-23) that suites be managed in a config directory, that testing be driven declaratively, and that vmlab have a pattern to fetch and test other sources as allowed or defined. The design is [03-runs-sources-and-suites.md](03-runs-sources-and-suites.md): profiles, suites, sources and runs as files in a config directory (layered, so a project can keep its own), and a deny-by-default policy on what may be fetched. It has since been built and is in use ([ROADMAP](../ROADMAP.md)).

## Open

| Question | Notes |
| --- | --- |
| Which Microsoft 365 licences qualify for Windows 11 on Azure | **Matters to anyone running the Windows 11 profile (D9).** Microsoft's licensing table ticks Business Premium for Azure Virtual Desktop but **not** for ordinary Azure virtual machines, and does not list Business Standard; the Azure deployment page names Business Premium without that split. Do not buy Business Premium on the strength of one page: ask Microsoft first. Routes that the table ticks for ordinary Azure VMs: Microsoft 365 E3/E5/F3/E7, Windows 11 Enterprise E3/E5, Windows VDA E3/E5 per user ([guide](04-azure-and-windows-11-access.md)) |
| Which container engines to cover on Windows 11 | Docker Desktop is the common one. OrbStack is macOS only, so it cannot be tested there. Docker Engine in WSL 2, Rancher Desktop and Podman Desktop all need the same nested virtualization. Not decided |
| Docker Desktop on the rented Windows 11 | A real Windows 11 PC that runs containers probably runs Docker Desktop, which needs nested virtualization. A dated community list names Azure sizes that allow it (Dv3, Dv4, Ev3, Ev4, Fsv2 and others) and does not name the B-series. Not checked against current Microsoft pages |
| Which other Windows versions to cover | Windows 10, Server 2022 and older are easy to add as profiles. Not decided |
| Where a project's own suites live | In that project's repo, named by path through `--config-dir`. vmlab ships only general suites and cannot name a private repo (D5) |
| More clouds | AWS, Google Cloud, Oracle. The provider interface is meant to allow it |
