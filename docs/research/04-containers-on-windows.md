# Running Linux containers on a Windows 11 PC

**Checked 2026-11-24.** Each claim links its source. **Stated** means the source says it; **not found** means we looked and found nothing. Not legal advice: licence terms are summarised, and a reader should read them in full before relying on them.

## The question

A tool that runs its work in Linux containers with `docker compose` needs a container engine on a Windows 11 PC. Which ones exist, what do they cost the people using them, and can they be installed and tested on a rented machine?

## The options

| Option | Licence and cost | `docker compose` | Needs WSL 2 or virtualization | Install with nobody at the keyboard | Latest seen |
| --- | --- | --- | --- | --- | --- |
| **Docker Desktop** | Free for personal use, education, non-commercial open source, and businesses under 250 employees **and** under $10M revenue. Larger businesses and **government entities** need a paid subscription ([Docker](https://docs.docker.com/subscription/desktop-license/)) | Yes | Yes (WSL 2 by default) | Yes: `install --quiet --accept-license`, and `--user` for one account with no administrator rights ([Docker](https://docs.docker.com/desktop/setup/install/windows-install/)) | 4.100.1, 2026-11-23 |
| **Podman Desktop** (Red Hat) | Apache-2.0, free | Yes: its Docker-compatibility mode answers on the standard Docker pipe, and it can install the Compose CLI ([Podman Desktop](https://podman-desktop.io/docs/migrating-from-docker/managing-docker-compatibility)) | Yes: WSL 2, or Hyper-V on Pro and Enterprise ([Podman Desktop](https://podman-desktop.io/docs/installation/windows-install)) | Yes: `winget install RedHat.Podman-Desktop`, or the installer's `/S` | 1.31.0, 2026-11-18 |
| **Rancher Desktop** (SUSE) | Apache-2.0, free | Yes: it ships the Docker CLI and Compose | Yes: WSL installed first ([Rancher Desktop](https://docs.rancherdesktop.io/getting-started/installation/)) | Partly: a winget package exists, but a silent install is not documented (not found) | 1.25.0, 2026-11-05 |
| **Docker Engine inside WSL 2**, without Docker Desktop | Apache-2.0, free ([Docker](https://docs.docker.com/engine/install/)) | Yes, as a plugin | Yes: WSL 2 with systemd | Only as Linux commands inside WSL. No Windows program, and `docker` runs inside WSL, not in Windows | Engine 29.10.0, 2026-11-16 |
| **OrbStack** | Free for personal, non-commercial use; $8 a user a month for business, commercial and non-profit use; free for education on request ([OrbStack](https://orbstack.dev/pricing)) | Yes | n/a | n/a | **macOS only** ([OrbStack FAQ](https://docs.orbstack.dev/faq)). Its founder said there are "no plans" for Windows in the near future ([issue #2467](https://github.com/orbstack/orbstack/issues/2467), 2026-05-15) |

## Two things to notice

- **Schools and "government entities".** Docker Desktop is free for "education", but its terms also say government entities need a paid subscription. A state school is often part of a government body. Which one applies to a given school is not something this page can settle: **Open**, and a question for the school or for Docker.
- **Virtual machines.** Docker says running Docker Desktop in an Azure virtual machine is supported for Docker Business customers, with nested virtualization on, and that it tested `D4s_v5` ([Docker](https://docs.docker.com/desktop/setup/vm-vdi/)). Every option above needs the same nested virtualization, because each runs a small Linux machine. On a `Standard_D2s_v6` Windows 11 machine made by vmlab, Windows reported virtualization passed through (Measured, run 16).

## What this means for vmlab

- OrbStack cannot be tested on Windows: there is no Windows version.
- Docker Desktop and Podman Desktop are the two worth testing. Both install with nobody at the keyboard, and both run `docker compose`. Podman Desktop has no licence limits.
- Rancher Desktop is a fair third, once its silent install is worked out.
