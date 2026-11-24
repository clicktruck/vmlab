# Getting access: Azure and Windows 11

**In short:** to rent a Windows 11 machine on Azure you need an Azure subscription you can create machines in, quota for the machine size, and a Microsoft licence that allows Windows 11 in Azure. The licence is the step that surprises people. This page is a checklist, kept short and general. **Checked 2026-11-23**; Microsoft changes its plans and prices, so read the sources. Not legal advice.

## What you need

| You need | Why | How to check | Who can give it |
| --- | --- | --- | --- |
| An Azure subscription | Machines are made in a subscription | Azure portal, **Subscriptions**. State should be **Active** | You, by signing up (pay-as-you-go), or your organisation |
| A role that can create machines in it | Making a VM needs rights on the subscription | Subscription, **Access control (IAM)**, **My access**. **Owner** or **Contributor** works | The subscription's owner |
| A way to create the subscription, if you are the one making it | Under a Microsoft Customer Agreement, a **billing account owner** or **contributor** can create Azure subscriptions; a reader cannot | Microsoft 365 admin center, **Billing**, **Billing accounts**: its type and your role | The billing account owner |
| Quota for the machine size | A new subscription's limit is per size family, and can be **0** for newer families such as `Bsv2` and `DSv5`. Azure then refuses the machine | `az vm list-usage -l REGION`, once the compute service is registered. vmlab reads it first and says so | You: ask for an increase in the portal, **Quotas**, **My quotas**, **Compute** ([06](06-sizing-and-cost.md#quota-the-limit-that-decided-it)) |
| **A licence that allows Windows 11 in Azure** (Windows 11 only) | The Windows 11 licence is not in the hourly price. The *user* must hold an eligible subscription | See below | Microsoft, or a reseller |
| Windows Server 2025 | Its licence **is** in the hourly price. Nothing more is needed | | |

## The Windows 11 licence

Microsoft's licensing guide has a table with two columns that matter: **Azure infrastructure** (ordinary Azure virtual machines, which is what vmlab makes) and **Azure Virtual Desktop** (a Microsoft service for hosting desktops). What it shows (page undated; read 2026-11-23, [source](https://www.microsoft.com/licensing/guidance/Windows-11-Licensing-for-Virtual-Desktops)):

| Licence (per user) | Azure virtual machines | Azure Virtual Desktop |
| --- | --- | --- |
| Windows 10/11 Enterprise E3 or E5 | Yes | Yes |
| Microsoft 365 F3, E3, E5 or E7 | Yes | Yes |
| Windows VDA E3 or E5 (per user) | Yes | Yes |
| Windows 10/11 Education A3 or A5; Microsoft 365 A3 or A5 | Yes | Yes |
| **Microsoft 365 Business Premium** | **No (blank)** | Yes |
| Windows VDA per device; Windows Enterprise per device | No | No |
| **Microsoft 365 Business Standard** | **Not listed** | **Not listed** |

A second Microsoft page, the Azure deployment page, has a shorter list that *does* name Business Premium, and it does not separate the two columns ([source](https://learn.microsoft.com/en-us/azure/virtual-machines/windows/windows-desktop-multitenant-hosting-deployment), updated 2025-07-02). The two pages disagree. The table is the more specific one, so **do not assume Business Premium covers ordinary Azure VMs**. Neither page says the licence and the Azure subscription must be in the same Microsoft Entra tenant. The binding text is the [Product Terms](https://www.microsoft.com/licensing/terms/en-US/productoffering/windowsdesktopoperatingsystem/MCA).

**Steps**

1. **Find your plan.** Microsoft 365 admin center, **Billing**, **Your products**. Then **Users**, **Active users**, your name, **Licenses and apps**: the licence assigned to *you* is what counts.
2. **Compare it with the table.** A plan that is not in the Azure-virtual-machines column does not cover vmlab's machines.
3. **If it is not covered, the routes found are:**
   - A Microsoft 365 plan from the "Yes" rows (E3, E5, F3, E7), or a **Windows 11 Enterprise E3/E5** or **Windows VDA E3/E5** licence for your user. Microsoft's licensing page says the Windows E3 and E5 licences are per user and sold through commercial licensing channels, including partners. Whether one can be added to a Business plan was not confirmed.
   - Run the machine as an **Azure Virtual Desktop** host instead, if you hold a licence from the right-hand column (Business Premium is ticked there). Whether a throwaway test machine can qualify that way: not checked, and vmlab does not do it yet.
   - An Azure Dev/Test offer, which needs a Visual Studio subscription. A plain pay-as-you-go account does not get it.
   - Windows 365 Cloud PC, or the evaluation image in Azure: not yet checked.
4. **Ask before you buy.** Put the question below to Microsoft or a reseller, and keep the reply and its date.
5. **Tell vmlab, once.** In `vmlab.local.yaml`, set `attestations.windows_client_licence.holds_eligible_licence: true` and write a `note` saying who confirmed it and when. vmlab cannot check your licence. It records what you set, and it then adds the `Windows_Client` licence type to the request that creates the machine (that is Azure's `--license-type` flag, which the Azure CLI describes as enabling Multi-tenant Hosting Rights).

**Reported, not matching the table.** A Microsoft Support answer given by phone (reported 2026-11-23) said that **Business Premium** is what entitles a user to run Windows 11 VMs in Azure. That was a spoken answer, and the guide's table above leaves Business Premium blank for Azure virtual machines. Treat it as unconfirmed until it is in writing: ask for an email or a case number, and keep it with the date. vmlab has a place for the reference: `attestations.windows_client_licence.reference` in `vmlab.local.yaml`. It is only recorded, never checked, and the plan and the run record show it (or "none yet").

**There is no switch to flip.** The entitlement is the licence assigned to your user, plus Azure's licence type setting (`Windows_Client`) on the machine. Azure does not appear to verify the licence when you deploy: you confirm it yourself, and Microsoft can audit. That is why a written answer matters. (The "confirm" step in the Azure portal was reported in secondary sources and was not checked on a current Microsoft page.)

**A question to send Microsoft or a reseller:**

> I hold *[plan]* for one user. I want to run Windows 11 Enterprise virtual machines on ordinary Azure virtual machines (images from the `MicrosoftWindowsDesktop` publisher, with the `Windows_Client` licence type) to test software on Windows 11. I am the only user. Microsoft's licensing guide shows my plan as *[ticked / blank / not listed]* for Azure infrastructure. What is the cheapest licence I can add or move to that covers this? Does my Azure subscription need to be in the same Microsoft Entra tenant as my licence? Is testing treated differently? What happens to my current yearly subscription if I switch?

## Signing in

1. Run `az login` (or, if it stops with an error about multi-factor authentication, `az login --tenant YOUR-TENANT.onmicrosoft.com`). The browser opens; sign in with the account that owns the subscription.
2. The terminal lists your subscriptions. The one you want should say **Enabled**, and its tenant should be the one you expect.
3. `az account list --refresh` asks Azure again, in case the CLI remembers an old state (a subscription that was cancelled shows as **Warned**).
4. A brand-new subscription has the compute, network and storage services **NotRegistered**. That is normal. vmlab registers them the first time, which needs the **Owner** or **Contributor** role on the subscription. Your VM size limits cannot be read until the compute service is registered.

## Billing

A Microsoft 365 plan (for example Business Premium, paid yearly or monthly) and an Azure pay-as-you-go subscription can use **the same sign-in and the same organisation**, and still be **two separate bills**. That is the arrangement vmlab is built for and has been run with: the Windows licence is on the Microsoft 365 plan, and the machines are paid for by the Azure subscription. They are not combined into one invoice. Create the Azure subscription while signed in with the organisation's admin account, so it lands in the same tenant as the licence. Under a Microsoft Customer Agreement the order is billing account, billing profile, invoice section, subscription ([source](https://learn.microsoft.com/en-us/azure/billing/billing-mca-overview)); read your own in **Billing accounts**.

Pay-as-you-go Azure has **no spending cap**. Set a budget alert (**Cost Management**, **Budgets**) as a warning, and let vmlab's deleting be the protection.

## Do not do this

- The Microsoft 365 admin center page **Pay-as-you-go services** connects a few Microsoft 365 add-ons to a subscription for billing. It is not where machines are made, and completing it starts billing for those add-ons.

## Still to confirm

- Whether a Business plan plus a Windows Enterprise E3 add-on is possible, and what a plan switch does to a yearly term. Microsoft's article on switching plans was not found.
- Whether a licence and a subscription in different tenants matter.
