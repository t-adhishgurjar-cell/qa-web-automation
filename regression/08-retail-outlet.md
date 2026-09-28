# 08 — Retail outlet and terminals

**27 screens — 23 Retail Outlet, 4 Terminals — and not one of them has ever been exercised here.**

**Depth: structural throughout.** Every case below checks that a screen opens for an entitled
role, is refused to one that is not entitled, filters, and exports. None of it is business
validation, because no measurement of these screens exists to write business validation from.

**Before automating this module, probe it.** Customer Management and Vehicle both cost days of
false findings until their screens were read rather than assumed — hidden controls, silent gates,
grids that need a search button because Enter is not wired. Expect the same here and budget for a
discovery pass first.

The four checks applied to every screen:

| | |
|---|---|
| **a** | Opens for an entitled role — HTTP 200, no "Unauthorized Access" in the body, the grid or form renders |
| **b** | Refused to a role `RoleMenuMappings` does not grant it — check the **body**, not the status code; refusals are served on the same URL |
| **c** | Filters and search narrow the result rather than returning the unfiltered grid |
| **d** | Export produces a file whose row count matches the grid |

---

## RO profile and contacts

| ID | Pri | Screen | Route | Beyond a–d |
|---|---|---|---|---|
| REG-RO-01 | P1 | Manage Retail Outlet | `RetailOutlet/Profile` | Outlet details match `ROMaster` |
| REG-RO-02 | P1 | RO Profile | `RetailOutlet/ROProfileUpdate` | An edit goes to approval, not straight through |
| REG-RO-03 | P1 | Update RO Contact | `RetailOutlet/UpdateROContact` | Change pends |
| REG-RO-04 | P0 | Approve RO Contact | `RetailOutlet/ROContactApprovals` | Four-eyes: the updater cannot approve |
| REG-RO-05 | P1 | RO Locator | `RetailOutlet/ViewLiveRo` | Outlets plot; only active ones |
| REG-RO-06 | P1 | Manage RO Services | `RetailOutlet/ManageROServices` | Enable and disable both take effect |
| REG-RO-07 | P0 | Manage RO PIN | `RetailOutlet/ROPin` | PIN set; the old one stops working |
| REG-RO-08 | P1 | Retail Outlet Default Limits | `RetailOutlet/RODefaultLimitMaster` | Applies to new outlets, not retrospectively |

---

## RO users

| ID | Pri | Screen | Route | Beyond a–d |
|---|---|---|---|---|
| REG-RO-09 | P0 | Manage RO Users | `RetailOutlet/ManageROUsers` | Creating an `OTHER_RO` user calls `usp_ValidateMobileForROUser` first, so a mobile already tied to an RO user is refused |
| REG-RO-10 | P0 | — | — | A mobile belonging to an **active** outlet blocks any new user of any type. Arm 2 of the conflict check in [module 06](06-users-access.md) |
| REG-RO-11 | P1 | — | — | An RO user signs in and sees only its own outlet |

---

## RO credit

| ID | Pri | Screen | Route | Beyond a–d |
|---|---|---|---|---|
| REG-RO-12 | P0 | RO Credit Accounts | `RetailOutlet/RoCreditAccounts` | Balances match the database |
| REG-RO-13 | P0 | RO Credit Purchase | `RetailOutlet/RoCreditPurchase` | Purchase reduces available credit by exactly the amount |
| REG-RO-14 | P0 | RO Credit Transactions | `RetailOutlet/RoCreditStatement` | Every purchase and settlement appears |
| REG-RO-15 | P0 | RO Settlements Transactions | `RetailOutlet/RoCreditSettlements` | A settlement restores credit |
| REG-RO-16 | P1 | Manage RO Credit | `RetailOutlet/CustomerBranchMapping` | A customer branch is mapped to an outlet's credit |
| REG-RO-17 | P1 | Manage Settlements | `RetailOutlet/EdfsSettlement` | Settlement raised |
| REG-RO-18 | P1 | RO Settlement Details | `RetailOutlet/EdfsSettlementDetails` | Detail agrees with the summary |
| REG-RO-19 | P0 | — | — | Credit purchase beyond the limit is refused; nothing moves |

---

## EDFS

| ID | Pri | Screen | Route | Beyond a–d |
|---|---|---|---|---|
| REG-RO-20 | P1 | Add EDFS | `RetailOutlet/ROEDFSMapping` | Mapping created, pending approval |
| REG-RO-21 | P0 | Approve | `RetailOutlet/RoEdfsApprovals` | Four-eyes; only then is it usable |
| REG-RO-22 | P1 | View | `RetailOutlet/ViewApprovedEdfsAccounts` | Approved accounts listed |

---

## Offline transactions

The three screens form a chain; test them in order.

| ID | Pri | Screen | Route | Beyond a–d |
|---|---|---|---|---|
| REG-RO-23 | P1 | Offline Transaction Review | `RetailOutlet/OfflineTransactionReview` | A pending offline transaction is listed |
| REG-RO-24 | P0 | Offline Transaction Approval | `RetailOutlet/OfflineTransactionApproval` | Approval posts the transaction and moves the balance |
| REG-RO-25 | P1 | Offline Transaction Details | `RetailOutlet/OfflineTransactionTracker` | The approved transaction appears with its outcome |
| REG-RO-26 | P0 | — | — | Rejecting one moves no balance |
| REG-RO-27 | P0 | — | — | Approving the same one twice posts it once |

---

## Transactions and terminals

| ID | Pri | Screen | Route | Beyond a–d |
|---|---|---|---|---|
| REG-RO-28 | P1 | Transaction Details | `RetailOutlet/ROTransactionsDetails` | Figures match the database |
| REG-RO-29 | P1 | Manage RO Terminals | `Terminals/AddTerminal` | Terminal added against an outlet |
| REG-RO-30 | P1 | Bulk Upload Terminals | `Terminals/BulkUploadTerminals` | Accepted and rejected rows distinguished, as with vehicle bulk upload |
| REG-RO-31 | P0 | RO Terminals Approval | `Terminals/RoTerminalsApproval` | Four-eyes; only approved terminals transact |
| REG-RO-32 | P1 | RO Terminal Status Summary | `Terminals/TerminalStatusSummary` | Counts agree with the terminal list |
| REG-RO-33 | P1 | Terminals First Transactions report | `Reports/TerminalsFirstTransactionsReport` | Agrees with the transaction data |

---

## Scope

| ID | Pri | Case | Expected |
|---|---|---|---|
| REG-RO-34 | P0 | An officer sees only the outlets within their hierarchy | Confirm which levels apply. `ROMaster` carries its own division code, and the OD work showed that a screen's scoping cannot be assumed from the data alone |
