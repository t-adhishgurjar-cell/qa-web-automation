# 09 — Reports

**26 screens, none exercised. Depth: structural** — with one addition that matters more than
everything else in this file.

## Why a report suite needs a fifth check

A report that renders perfectly and shows the wrong number is indistinguishable, on screen, from a
correct one. The four structural checks — opens, refuses, filters, exports — prove a page works.
They say nothing about whether it is right.

So every report case below carries **check e: reconcile**. Take the same figure from the database
and compare. Without it, this module can pass in full while every number in it is wrong.

| | |
|---|---|
| **a** | Opens for an entitled role |
| **b** | Refused to a role not granted it — check the body, not the status |
| **c** | Date range and other filters narrow the result; a range with no data gives an empty state, not a blank grid |
| **d** | Excel and PDF export; row counts match the grid |
| **e** | **Reconcile** at least one figure against the database |

---

## Transactions and wallet

| ID | Pri | Report | Route | Reconcile against |
|---|---|---|---|---|
| REG-RPT-01 | P0 | Transactions History | `Reports/TransactionsHistory` | Transaction rows for the same period and customer |
| REG-RPT-02 | P0 | Transaction Passbook | `Reports/TransactionPassbook` | Opening plus movements equals closing |
| REG-RPT-03 | P0 | NEFT Report | `Reports/NeftReport` | Actual NEFT transfers |
| REG-RPT-04 | P0 | SAP Entry - PG | `Reports/SapEntryPgReport` | PG recharge transactions |
| REG-RPT-05 | P1 | Suspense Report | `Reports/SuspenseReport` | The Suspense Transactions screen — same totals |
| REG-RPT-06 | P1 | Bank Details | `Reports/BankDetailsReport` | `CustomerMaster` bank rows |
| REG-RPT-07 | P1 | Pending Bank Account Status | `Reports/PendingBankAccountStatus` | Both bank approval queues |

---

## Customer and user

| ID | Pri | Report | Route | Reconcile against |
|---|---|---|---|---|
| REG-RPT-08 | P1 | ReKyc Report | `Reports/ReKycReport` | Customers due re-KYC |
| REG-RPT-09 | P1 | OCR Status | `Reports/OcrStatusReport` | Document OCR states |
| REG-RPT-10 | P1 | OCR Approved | `Reports/OcrApprovedReport` | Approved subset of the above |
| REG-RPT-11 | P1 | User Mobile Details | `Reports/UserMobileDetails` | `Users.MobileNumber`. **Note:** one mobile can carry up to 50 user rows — check how the report presents that |
| REG-RPT-12 | P1 | Device Details Report | `Reports/DeviceDetailsReport` | `UserDevices` |

---

## Vehicle

| ID | Pri | Report | Route | Reconcile against |
|---|---|---|---|---|
| REG-RPT-13 | P0 | Vehicle Onboarding Report | `Reports/VehicleOnboardingReport` | Vehicles added in the period, by status |
| REG-RPT-14 | P0 | Vehicle Lifecycle Report | `Reports/VehicleLifecycleReport` | The transitions on the Vehicle Lifecycle screen |
| REG-RPT-15 | P1 | Vehicle Purchase - Prepaid Limit | `Reports/VehicleWiseLimitReport` | Limits set and consumed |

---

## Retail outlet and dealer

| ID | Pri | Report | Route | Reconcile against |
|---|---|---|---|---|
| REG-RPT-16 | P1 | RO Details Report | `Reports/RoDetailsReport` | `ROMaster` |
| REG-RPT-17 | P0 | RO Customer Credit Report | `Reports/RoCustomerCredit` | RO Credit Accounts balances |
| REG-RPT-18 | P0 | RO Recovery Report | `Reports/RORecoveryReport` | Settlements |
| REG-RPT-19 | P0 | Dealer Recovery Report | `Reports/DealerRecoveryReport` | Dealer settlements |
| REG-RPT-20 | P0 | Dealer Recovery Calculation | `Reports/DealerRecoveryCalculationReport` | Monthly recovery with fund utilisation and points — recompute one month by hand |
| REG-RPT-21 | P1 | Terminals First Transactions | `Reports/TerminalsFirstTransactionsReport` | First transaction per terminal |

---

## Loyalty, vouchers and savings

| ID | Pri | Report | Route | Reconcile against |
|---|---|---|---|---|
| REG-RPT-22 | P1 | Loyalty Report | `Reports/LoyaltyReport` | Points earned and redeemed |
| REG-RPT-23 | P0 | Loyalty Calculation Report | `Reports/LoyaltyCalculationRewardsReport` | Recompute one customer's points by hand |
| REG-RPT-24 | P1 | Fuel Voucher Report | `Reports/FuelVoucherReport` | Vouchers issued and redeemed |
| REG-RPT-25 | P1 | Saving Ticket Issuance | `Reports/SavingTicketIssuanceReport` | Tickets issued |
| REG-RPT-26 | P1 | Savings Voucher Redemption | `Reports/SavingTicketReport` | Redemptions |

---

## Cross-report checks

| ID | Pri | Case | Expected |
|---|---|---|---|
| REG-RPT-27 | P0 | Officer scope on every report | An officer's report covers only their hierarchy. Check on at least one report per area — a report is the easiest place for a scope leak to go unnoticed, and the OD work found exactly that on a screen nobody thought was scoped |
| REG-RPT-28 | P1 | A date range with no data | Empty state, not a blank grid or a permanent "Loading…" |
| REG-RPT-29 | P1 | A very wide date range | Completes or refuses with a message; no timeout |
| REG-RPT-30 | P1 | Reports that overlap agree with each other | Suspense Report against the Suspense screen; Dealer Recovery against its Calculation |
| REG-RPT-31 | P2 | Exported file contents, not just the row count | Columns, headers and totals match what was on screen |
| REG-RPT-32 | P2 | Figures are formatted and rounded consistently | Currency, dates and decimals presented the same way across reports |
