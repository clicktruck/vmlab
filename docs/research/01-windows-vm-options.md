# Running Windows for tests: what was found

**Checked 2026-11-23** by reading the pages named below. Prices, versions and images change monthly. Where a page did not say something, this file says "not stated". Not legal advice on licences.

## The machine this was written on

A Mac with an Apple chip (arm64). It can only run **Windows 11 for Arm** in a local virtual machine. Intel Windows does not run on it.

## What each way can and cannot do

| Way | Windows type | Licence | Docker Desktop inside? | Notes |
| --- | --- | --- | --- | --- |
| A cloud machine (Azure) | Intel (x64) | In the hourly price | Not checked | Matches GitHub's Windows. Commands can run through Azure's Run Command with no open ports |
| VirtualBox 7.2 on this Mac | Arm only | Evaluation (90 days) or your own key | No (see below) | Oracle lists a Windows 11 Arm guest on a macOS Arm host as supported. Automation (Packer, Vagrant) for this is not documented |
| VMware Fusion Pro | Arm only | Same | Not stated | Free for personal use since May 2024 (older news; not re-checked). The Packer plug-in needs Fusion Pro 13.6 or later; Windows Arm guests not stated |
| Parallels | Arm only | Same | **No** | Paid. Parallels says nested virtualization is not available for Windows on Apple chips |
| UTM | Arm only | Same | Not stated | A Packer plug-in exists; Windows not stated |
| A GitHub-hosted Windows runner | Intel (x64) | GitHub's | Not checked | The only Windows most pull requests see. A push and a wait for each try |

## Sources

- VirtualBox 7.2 supports a Windows 11 Arm guest on Apple Silicon Macs, Intel guests do not run on Arm hosts, guest additions and shared folders exist: Oracle, [VirtualBox 7.2 release notes](https://docs.oracle.com/en/virtualization/virtualbox/7.2/relnotes/relnotes-rn-features.html) and the user guide's table of guests on Arm64 hosts, <https://docs.oracle.com/en/virtualization/virtualbox/7.2/user/Introduction.html>. The newest version is unclear: the download page says 7.2.22, the change log stops at 7.2.6 (2026-01-20).
- Windows 11 Enterprise evaluation, 90 days, no key needed: the evaluate page lists "x64 ISO and Arm64 ISO" for version 26H2, but the download page showed no Arm64 link. After expiry the desktop turns black and the PC shuts down every hour. Rearm: not stated. <https://www.microsoft.com/en-us/evalcenter/evaluate-windows-11-enterprise>
- Windows Server 2025 evaluation: x64 only (ISO and VHD), 180 days, activate over the internet within 10 days. <https://www.microsoft.com/en-us/evalcenter/evaluate-windows-server-2025>
- No nested virtualization for Windows on Apple chips (so no Docker Desktop or WSL 2 inside): Parallels, <https://kb.parallels.com/en/129497>. Only Parallels was checked; the others are not stated.
- Packer 1.16.2 (2026-10-22) is under the Business Source License 1.1: <https://github.com/hashicorp/packer/releases>, <https://github.com/hashicorp/packer/blob/main/LICENSE>. Vagrant is MIT; its newest stable version was not confirmed. Packer VirtualBox plug-in v1.1.6 (2026-11-02): Apple Silicon and Windows Arm guests not stated, <https://github.com/hashicorp/packer-plugin-virtualbox>.
- A UTM plug-in for Packer exists (MPL-2.0); Windows not stated: <https://github.com/naveenrajm7/packer-plugin-utm>. Parallels' Windows 11 Arm Packer examples exist, you supply the ISO: <https://github.com/Parallels/packer-examples/blob/main/windows/README.md>.
- Azure free account: $200 credit for 30 days, a card and a phone number, sign in with a Microsoft or GitHub account, one per customer: <https://azure.microsoft.com/en-us/pricing/purchase-options/azure-account>. A Microsoft 365 subscription includes a free Entra tenant, which is not an Azure subscription: <https://learn.microsoft.com/en-us/microsoft-365/enterprise/subscriptions-licenses-accounts-and-tenants-for-microsoft-cloud-offerings>.
- Azure Run Command runs a script on a Windows VM without an open port; Windows Server 2025 is supported: <https://learn.microsoft.com/azure/virtual-machines/windows/run-command>. Managed Run Command can run as a named user (`--run-as-user`); the exact flags were read from the Azure CLI 2.92.0 help on 2026-11-23.
- Price, from Azure's own public price list (<https://prices.azure.com/api/retail/prices>, read 2026-11-23, East US 2, prices effective 2025-10-01): Standard_B2s costs $0.0496 an hour with Windows and $0.0416 without; Standard_B2ms costs $0.0912 with Windows and $0.0832 without. The difference is the Windows licence. Whether a machine with the `Windows_Client` licence type is billed at the lower rate was not checked. Spot prices were skipped. Which sizes allow nested virtualization: not checked.

## Windows 11 on Azure (checked 2026-11-23)

- **The images exist.** `az vm image list-skus -l eastus2 -p MicrosoftWindowsDesktop -f windows-11` listed 24H2, 25H2 and 26H2 SKUs in Pro, Enterprise and multi-session (`avd`) forms. The 25H2 Enterprise image is generation 2 with no purchase plan.
- **The licence is not in the hourly price.** Microsoft's page says users "must" hold an eligible subscription licence to use Windows 11 images in Azure for any production workload. It names Microsoft 365 E3, E5, A3, A5, F3, **Business Premium** and Student Use Benefit, Windows Enterprise E3 and E5, Windows VDA E3 and E5, and Windows Education A3 and A5: <https://learn.microsoft.com/en-us/azure/virtual-machines/windows/windows-desktop-multitenant-hosting-deployment> (page dated 2025-05-22, updated 2025-07-02).
- **Another Microsoft guide, more specific, says Business Premium is not enough for ordinary Azure VMs.** Its table has a column for Azure infrastructure and one for Azure Virtual Desktop. Ticked for **both**: Windows 10/11 Enterprise E3/E5, Microsoft 365 F3/E3/E5/E7, Windows VDA E3/E5 per user, Microsoft 365 and Windows Education A3/A5. Business Premium: **blank for Azure infrastructure, ticked for Azure Virtual Desktop**. Per-device rows: blank. Business Standard: not listed. The Student Use Benefit row contradicts the guide's own summary table. Read 2026-11-23: <https://www.microsoft.com/licensing/guidance/Windows-11-Licensing-for-Virtual-Desktops> (no date shown). Business Standard is not named on either page.
- **Which images.** The first page lists Windows 11 Enterprise and Enterprise multi-session. Pro is not stated as allowed.
- **How it is switched on.** `licenseType: Windows_Client` in a template, `-LicenseType "Windows_Client"` in PowerShell. The Azure CLI 2.92.0 help for `az vm create --license-type` says to use `Windows_Client` for Multi-tenant Hosting Rights.
- **Test and trial use.** The page says "Student & Free Trial accounts are enabled to deploy Windows 11 images for development or testing" and links a dev/test page that was not read. A pay-as-you-go account is not a free trial.
- **Cost.** Not stated on either page.
- **What this means for vmlab.** It cannot know whether a person's licence qualifies. The Windows 11 profile therefore refuses to run until the person sets `eligible_licence: true`, and the run record keeps what they set. Not legal advice: confirm with Microsoft or your licensing admin.

## Windows 11 elsewhere: is there an easier cloud? (checked 2026-11-23)

Short answer: no cloud found rents Windows 11 on demand with the licence included. The limit comes from Microsoft's licence terms, not from Azure alone. Not checked: smaller hosting companies.

| Where | Windows 11? | What the sources say |
| --- | --- | --- |
| Azure | Yes, with an eligible licence | The most open of the big clouds (the multitenant hosting right above) |
| AWS EC2 | Only with your own licence on dedicated hardware | AWS says Microsoft requires bring-your-own-licence and hardware dedicated to one customer. A Windows 11 bring-your-own-licence option also exists for WorkSpaces. <https://aws.amazon.com/windows/faq/>, <https://docs.aws.amazon.com/prescriptive-guidance/latest/optimize-costs-microsoft-workloads/byol-ded-hosts.html>, <https://aws.amazon.com/about-aws/whats-new/2023/03/aws-windows-11-licenses-workspaces> |
| Google Cloud | Only with your own licence on sole-tenant (dedicated) nodes | Google: BYOL "Windows Server or Desktop OS" must run on dedicated hardware, and you handle activation and compliance. <https://docs.cloud.google.com/compute/docs/instances/windows/ms-licensing-faq> |
| Microsoft Dev Box | Windows 11 Enterprise, per user | Each user needs a Windows 11 Enterprise licence plus Intune and Entra ID P1; one Azure page says new sign-ups stopped on 2025-11-01 as Dev Box moves to Windows 365. <https://azure.microsoft.com/en-ca/pricing/details/dev-box/> |
| Azure Dev/Test offers | Windows client images | Tied to Visual Studio subscriptions: you pay the Linux rate for VMs. Not available with a plain pay-as-you-go account. <https://azure.microsoft.com/en-us/pricing/offers/ms-azr-0023p/> |
| GitHub-hosted runner | `windows-11-arm` (Arm) | Windows 11 for Arm only. The 2025 notice said it was for public repos; current docs list it for private repos too (a conflict, not resolved). <https://docs.github.com/en/actions/reference/runners/github-hosted-runners>, <https://github.blog/changelog/2025-04-14-windows-arm64-hosted-runners-now-available-in-public-preview/> |
| Microsoft's free Windows 11 development environment | Windows 11 Enterprise evaluation, 90 days, no key | A downloadable virtual machine for Hyper-V and VirtualBox (x64). The newest release found was 2407, from 2024; whether it still exists was not confirmed. <https://developer.microsoft.com/downloads/virtual-machines> |

## What GitHub's own Windows runner is

GitHub's `windows-latest` and `windows-2025` labels are **Windows Server 2025** (Visual Studio 2026 from June 2026): <https://docs.github.com/en/actions/reference/runners/github-hosted-runners>. On Azure, the Windows Server 2025 image seen on 2026-11-23 had build 26100, and the Windows 11 25H2 image had build 26200 (read from `az vm image show`). The two share Windows' core, but whether a given behaviour is identical on both was not tested.

## Docker Desktop inside a rented Windows 11 (checked 2026-11-23, thin)

Docker Desktop on Windows needs nested virtualization. Microsoft's 2017 announcement named the Dv3 and Ev3 sizes: <https://azure.microsoft.com/en-us/blog/nested-virtualization-in-azure/>. A 2022 Microsoft Q&A answer lists Dv3, Ds_v3, Dv4, Dsv4, Ddv4, Ddsv4, E_v3, Es_v3, Ev4, Esv4, Edv4, Edsv4, Fsv2 and M-series, only for sizes with hyper-threading on Intel: <https://learn.microsoft.com/en-us/answers/questions/813416/how-do-i-know-what-size-azure-vm-supports-nested-v>. Both are dated. Not found: the B-series, and the newer Dv5 and Ev5. Whether Docker Desktop is supported on a rented Windows 11 Enterprise VM was not checked.

## Container engines on Windows 11: Docker Desktop, OrbStack and others (checked 2026-11-23)

- **OrbStack is macOS only.** No Windows build was found. Its Homebrew entry lists macOS 14 or later: <https://formulae.brew.sh/cask/orbstack>; its own site and docs were not fully read: <https://docs.orbstack.dev/faq>. So it can run vmlab on a Mac but cannot be tested on, or installed in, a Windows 11 machine.
- **Docker Desktop on Windows** uses WSL 2 or Hyper-V, so it needs nested virtualization when the Windows machine is itself a virtual machine. Docker's own page says Docker Desktop in a VM is supported only for Docker Business customers on VMware ESXi or Azure VMs (so Azure is a tested hypervisor, but support is for a paid plan), and points to Docker Offload where nested virtualization is not available: <https://docs.docker.com/desktop/setup/vm-vdi/>. Editions: Docker lists Home, Pro, Enterprise and Education 21H2 or later; Windows containers (as opposed to Linux ones) need Pro or Enterprise. The minimum build differs between Docker pages: <https://docs.docker.com/desktop/setup/install/windows-install/>. Docker's licence terms for business use were not read.
- **The alternatives found all need the same thing.** Rancher Desktop (WSL 2 on Windows, per a community note) and Docker Engine run by hand in WSL 2 both need nested virtualization in a VM. Podman Desktop was not checked.
- **A Windows 365 Cloud PC:** one individual reported Docker Desktop and WSL 2 working on one, unofficially: <https://microservices.io/post/development/2022/05/01/my-new-windows-pc.html>.
- **Azure sizes:** Microsoft supports Hyper-V in an Azure VM if the size supports nested virtualization. The sizes are on Microsoft's list; the dated one found is above.
- **Azure's Windows 11 images are Pro and Enterprise.** No Home or Education image was listed, though schools commonly run Education and Home editions. Whether an edition difference changes any behaviour a test cares about was not checked.

## Not checked

Whether a GitHub-hosted runner can be entered interactively (for example with a tmate action); whether Windows 11 can be rented on Azure with a Microsoft 365 licence; the rearm count of the Windows 11 evaluation; Azure spot prices.
