# Sizing and cost

**In short:** the cheapest size that suits both Windows 11 and Windows Server 2025 is `Standard_B2s_v2` (2 CPUs, 8 GB), about 9 cents an hour, but a new subscription has **no quota** for it until you ask. `Standard_D2s_v6` (about 19 cents an hour with Windows) works straight away. A test run uses a machine for 15 to 25 minutes, so one machine costs a few cents. **Prices checked 2026-11-23** from Azure's own price list, for East US and East US 2; they change, and vmlab reads the live price when it makes a plan.

## What a new subscription can use

A new Azure subscription often cannot use every size, and the answer differs by region. For one newly made pay-as-you-go subscription on 2026-11-23 (read with `az vm list-skus`):

| Size | East US | East US 2 |
| --- | --- | --- |
| `Standard_B2s`, `Standard_B2ms` | **Not offered** | **Not offered** |
| `Standard_B2s_v2` | **Open, no restrictions** | Offered, 3 of 4 availability zones restricted |
| `Standard_D2s_v5`, `Standard_D2ds_v5`, `Standard_D2s_v6`, `Standard_D2as_v6` | Open | Offered, zones restricted |
| `Standard_B2as_v2`, `Standard_D2as_v5` | Open | Not offered |

vmlab's default region is therefore **East US**. The other regions read the same day, for the same subscription (all seven small sizes, "open" meaning no restriction at all):

| Region | Result |
| --- | --- |
| East US | All seven open |
| West US 3 | All seven open |
| Central US | All seven open |
| South Central US | `Standard_B2s_v2` and `Standard_B2as_v2` open; the D-series zone-restricted |
| East US 2 | Zones restricted for most; `Standard_B2as_v2` and `Standard_D2as_v5` not offered |
| West US 2 | Zones restricted for all seven |

Whether a size is *offered* is separate from whether the subscription has the **quota** to use it (below).

Two things to know when reading this kind of list:

- Azure's size search matches any name that *contains* the text. Asking for `Standard_B2s` also returns `Standard_B2s_v2`, which is a different size. vmlab matches the exact name.
- A restriction on **some availability zones** does not stop a machine that is not pinned to a zone. A restriction on the **whole region** does. vmlab allows the first (and says so) and refuses the second before it makes anything. Whether a zone-restricted size can really be made was **not proven**, which is why a fully open region is the default.

## Options, ranked

Prices are per hour in East US 2 (East US was the same for the sizes compared, except that `Standard_B2s_v2` is listed at $0.0924 for both), pay-as-you-go, from `https://prices.azure.com/api/retail/prices`. The Windows column is for a machine whose licence is in the hourly price (Windows Server). A Windows 11 machine made with the `Windows_Client` licence type is expected to be billed at the lower, no-Windows rate; that was **not verified**.

| Rank | Size | CPUs, memory | With Windows | Without | Notes |
| --- | --- | --- | --- | --- | --- |
| 1 | `Standard_B2s_v2` | 2, 8 GB | $0.0924 | $0.0832 | Cheapest open size. Enough for both systems. About 4 cents for a 25-minute machine |
| 2 | `Standard_D2as_v6` | 2, 8 GB | $0.183 | $0.0908 | A faster family, for when the first is too slow |
| 3 | `Standard_D2s_v5` | 2, 8 GB | $0.188 | $0.096 | Intel D-series, the kind of family Microsoft has listed for running a machine inside a machine (Docker Desktop). **Not verified** for this size |

## Other ways to pay for compute

| Way | Price seen | Fit for vmlab |
| --- | --- | --- |
| **Pay-as-you-go** (what vmlab uses) | The table above | Simple, no commitment, no eviction. A forgotten machine costs money, so vmlab always deletes |
| **Spot** (spare capacity, can be taken back at any time) | `Standard_B2s_v2` $0.0749; `Standard_D2s_v5` $0.0275; `Standard_D2as_v6` $0.0168 | Much cheaper on the D-series, almost no saving on the B-series. A machine can be evicted mid-run, which fails a test for a reason that is not the code's. **Not tried.** The listed Spot "Windows" rates equal the Linux ones, which looks odd, so treat them with care |
| **Dev/Test pricing** | Windows machines billed at the Linux rate (`Standard_D2s_v5` $0.096) | Needs a Visual Studio subscription and a Dev/Test subscription. Not available on a plain pay-as-you-go one |
| **Reserved instances and savings plans** | `Standard_B2s_v2`, one year, Linux: $831 up front | Not a fit: vmlab's machines live for minutes |
| **Batch "low priority"** | $0.0166 | A different Azure service, not used |

**What a whole test costs.** One Windows 11 machine and one Windows Server 2025 machine, about 25 minutes each on `Standard_B2s_v2`, is roughly **$0.08 to $0.10** in all, under the budget line of $1.00 in `vmlab.yaml`. The plan shows an estimate, and the run record shows what was planned.

## Quota: the limit that decided it

A size can be *offered* and still be unusable, because a new subscription's **vCPU quota** is per size family, and for newer families it can be **0**. Read with `az vm list-usage` on 2026-11-23, East US, for one newly made pay-as-you-go subscription:

| Quota | Limit |
| --- | --- |
| Total regional vCPUs | 10 |
| Most older families (for example Dv3, DSv3, Dv4) and the newer `Dsv6` family | 10 each |
| `Bsv2` family (`Standard_B2s_v2`) | **0** |
| `DSv5` family (`Standard_D2s_v5`) | **0** |

Azure refused to make a machine whose family had 0, and the Azure CLI (2.93.0) **crashed while reporting the refusal**, printing "The content for this response was already consumed" instead of the quota message. So vmlab now reads the quota **first** and says plainly: the limit for that family, how much is in use, and how much the size needs.

**To ask for more quota** (free; your subscription needs the Owner or Contributor role): in the Azure portal, **Quotas**, **My quotas**, choose **Compute**, pick the subscription and the region, find the family (for example "Bsv2"), choose **Request adjustment**, enter the new limit (a few vCPUs is enough: each machine here uses 2) and submit. Small increases are often approved within minutes; others open a support request. How long it takes was not measured here.

**So the default is `Standard_D2s_v6`** (2 CPUs, 8 GB; East US: $0.193 an hour with Windows, $0.101 without), which has quota on a new subscription. If you ask for `Bsv2` quota, `Standard_B2s_v2` ($0.0924) is about half the price: change `size` in the two profiles.

## What was tried live

The log of every live run, with what each showed, is in [07-what-has-been-proven.md](07-what-has-been-proven.md). The two that shaped this page: run 1 found that `Standard_B2s` and `Standard_B2ms` are not offered to a new subscription, and run 2 found the quota of 0 described above.
