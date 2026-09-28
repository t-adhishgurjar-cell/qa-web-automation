# Suite structure — modules, sub-modules and cases

11 modules · **56 sub-modules** · 391 cases · 116 screens.

The sub-module case counts below sum to 394 rather than 391. Three cases are cross-referenced from
a second sub-module — REG-CO-24 in 02.1, REG-OD-12 in 03.1, REG-OD-27 in 03.5 — and are counted in
both places. 391 is the number of distinct cases.

Use this to split execution between testers, and to plan the automation phase — the last two
columns say what each sub-module is worth automating and what already exists.

**Columns**

| | |
|---|---|
| **Cases** | Cases the sub-module owns. Case ranges overlap slightly where a section cross-references another's case; the counts are of owned cases |
| **Depth** | `measured` — expected results come from observed behaviour · `partial` — some cases measured, some assumed · `structural` — the screen has never been exercised; opens / refuses / filters / exports only |
| **Automated** | What exists in this repository today |

---

## 00 — Gate · 12 cases
Run first. Anything red here voids the run rather than failing it.

| ID | Sub-module | Screens | Cases | Depth | Automated |
|---|---|---|---:|---|---|
| 00.1 | Environment, sign-in, entitlement, session | 3 | 12 | measured | partial — `auth/login.spec.ts`, `database/connection.spec.ts`, `role-modules.spec.ts`, `role-scope.spec.ts` |

---

## 01 — Authentication & self-enrolment · 35 cases

| ID | Sub-module | Screens | Cases | Depth | Automated |
|---|---|---|---:|---|---|
| 01.1 | Login — validation and refusals | 1 | 14 | measured | partial — `auth/login.spec.ts` covers the error surfaces; lockout and the multi-row-mobile cases are not |
| 01.2 | Change password | 1 | 6 | measured | partial — `change-password.page.ts` drives it; policy cases not asserted |
| 01.3 | OD self-enrolment | 1 | 14 | measured | **none** — the form is modelled by probes only |

**01.1 holds two cases worth automating first:** REG-AUTH-13 and -14, on a mobile carrying 29–50
user rows that share one password hash. Nothing visible determines which row a sign-in resolves
to, and for a mobile whose rows span divisions that is an access-control question.

---

## 02 — Customer onboarding · 55 cases

| ID | Sub-module | Screens | Cases | Depth | Automated |
|---|---|---|---:|---|---|
| 02.1 | The wizard — reaching it | 1 | 6 | measured | partial — `add-customer.page.ts` models the list-then-wizard entry, which is the trap |
| 02.2 | Basic information | 1 | 18 | measured | partial — `add-customer-onboarding.spec.ts`; the cascade defect FP-OD-3 is covered in 03 |
| 02.3 | Address, branch and meeting steps | 1 | 10 | measured | partial — same spec |
| 02.4 | Consent | 1 | 4 | measured | yes — `consent.page.ts`, `onboarding-e2e.spec.ts` |
| 02.5 | Review — the TSM stage | 1 | 6 | measured | yes — `review-customer.page.ts`. Reject and Send-for-Correction are not |
| 02.6 | Approve — the checker stage | 1 | 7 | measured | yes — `approve-customer.page.ts` |
| 02.7 | Branches | 2 | 5 | measured | yes — `add-branch.spec.ts`, `add-branch-parent-admin.spec.ts` |

**Automate REG-CO-49 first.** It asserts that onboarding still creates the customer's own
administrator. That rests on the admin being created before the customer row reaches a blocking
status — `usp_AddUser` refuses any user on a non-OD customer's mobile at 101 or 104 — and nothing
guards the ordering.

---

## 03 — OD enrolment & hierarchy · 31 cases
The live change. Highest automation coverage in the suite because it was built this week.

| ID | Sub-module | Screens | Cases | Depth | Automated |
|---|---|---|---:|---|---|
| 03.1 | The enrolment form | 1 | 7 | measured | yes — `od-enrolment.spec.ts` |
| 03.2 | The pin code | 1 | 4 | measured | yes — same |
| 03.3 | What gets stored | 1 | 6 | measured | yes — `od-enrolment-submit.spec.ts` |
| 03.4 | The hierarchy | 1 | 12 | measured | yes — `od-hierarchy-two-regions.spec.ts`, 9 officers × 2 regions. **KNOWN FAIL, FP-OD-1** |
| 03.5 | Self-enrolment — the second path | 1 | 5 | measured | **none** — probes only. **KNOWN FAIL, FP-OD-7** |

---

## 04 — Customer management · 48 cases

| ID | Sub-module | Screens | Cases | Depth | Automated |
|---|---|---|---:|---|---|
| 04.1 | Approved Customers | 1 | 6 | partial | probe only — scope measured, grid behaviour not |
| 04.2 | Customer Profile & View Information | 3 | 6 | structural | **none** |
| 04.3 | Activate / Deactivate | 1 | 8 | partial | partial — `customer-status.spec.ts` |
| 04.4 | Manage Credit PIN & change log | 2 | 4 | partial | partial — opens, via `role-modules.spec.ts` |
| 04.5 | Customer Audit Logs | 1 | 3 | structural | **none** |
| 04.6 | Virtual account, TDS, RO credit | 4 | 6 | structural | **none** |
| 04.7 | Manage Customer Users | 1 | 7 | measured | **none** — the 22 Sep caps are unasserted anywhere |
| 04.8 | Leads | 2 | 8 | structural | **none** — but `LeadMaster.DivisionId` is measured as pin-code-derived |

**04.7 is the gap that matters.** The caps landed on 22 September at 2 each, 16 parent and 8
branch codes are already at the limit, and a cap refusal is indistinguishable from a
mobile-conflict refusal unless the wording is read. Nothing in the suite separates them.

---

## 05 — Vehicle · 52 cases

| ID | Sub-module | Screens | Cases | Depth | Automated |
|---|---|---|---:|---|---|
| 05.1 | Add Vehicles | 1 | 11 | measured | partial — `add-vehicle.page.ts` |
| 05.2 | Bulk upload | 1 | 7 | measured | partial — accepted / rejected-on-branch / rejected-other are separated |
| 05.3 | Vehicle Approval | 1 | 9 | measured | yes — `manage-vehicle.spec.ts`, `APPROVAL-SCOPE-SCENARIOS.md` (34 scenarios) |
| 05.4 | Manage, view and map | 4 | 11 | measured | partial — bulk de-map covered; de-map/re-add and case-whitespace not |
| 05.5 | Limits | 4 | 6 | partial | **none** |
| 05.6 | Block, authenticate, lifecycle | 6 | 8 | partial | **none** |

---

## 06 — Users, roles & access · 40 cases

| ID | Sub-module | Screens | Cases | Depth | Automated |
|---|---|---|---:|---|---|
| 06.1 | Manage Users | 1 | 17 | measured | partial — `matrix-add-user.spec.ts` covers the conflict rules |
| 06.2 | Officer creation via the Office API | — | 6 | measured | yes — `create-officers.spec.ts`, verified against the database |
| 06.3 | Officers who have never signed in | — | 3 | measured | yes — `set-officer-passwords.spec.ts`, both SMS wordings |
| 06.4 | Roles and entitlement | 2 | 7 | partial | partial — `role-modules.spec.ts`, `role-scope.spec.ts` |
| 06.5 | UserType × CustomerType matrix | 1 | 5 | measured | yes — 117 cells, `matrix-*.spec.ts`. 20 cells disagree with the workbook |
| 06.6 | View Purchase OTP | 1 | 2 | structural | **none** |

**REG-UA-04 and -05 are the honest-negative cases:** a user created through `usp_AddUser` has
**no** location mapping, so it sees nothing on a scoped screen. Asserting the absence is what makes
a future change that starts writing one visible.

---

## 07 — Financial & wallet · 30 cases

| ID | Sub-module | Screens | Cases | Depth | Automated |
|---|---|---|---:|---|---|
| 07.1 | Bank accounts — four-eyes | 4 | 9 | partial | partial — `customer-bank.spec.ts` covers the customer side; the dealer side not |
| 07.2 | Wallet recharge | 2 | 7 | partial | **none** |
| 07.3 | Wallet transfer and balances | 3 | 7 | partial | **none** |
| 07.4 | Suspense and reconciliation | 2 | 7 | structural | **none** |

**07.2 REG-FI-12 and -16** — an abandoned gateway flow, and the same recharge submitted twice —
are the two cases in this suite where a defect would cost money directly. Neither is automated and
neither has been executed.

---

## 08 — Retail outlet & terminals · 34 cases
**27 screens, nothing automated, nothing measured.** Probe before automating.

| ID | Sub-module | Screens | Cases | Depth | Automated |
|---|---|---|---:|---|---|
| 08.1 | RO profile and contacts | 8 | 8 | structural | **none** |
| 08.2 | RO users | 1 | 3 | structural | **none** |
| 08.3 | RO credit | 7 | 8 | structural | **none** |
| 08.4 | EDFS | 3 | 3 | structural | **none** |
| 08.5 | Offline transactions | 3 | 5 | structural | **none** |
| 08.6 | Transactions and terminals | 5 | 6 | structural | **none** |
| 08.7 | Scope | — | 1 | structural | **none** |

---

## 09 — Reports · 32 cases
**26 screens, nothing automated.** Every case carries the reconcile check.

| ID | Sub-module | Screens | Cases | Depth | Automated |
|---|---|---|---:|---|---|
| 09.1 | Transactions and wallet | 7 | 7 | structural | **none** |
| 09.2 | Customer and user | 5 | 5 | structural | **none** |
| 09.3 | Vehicle | 3 | 3 | structural | **none** |
| 09.4 | Retail outlet and dealer | 6 | 6 | structural | **none** |
| 09.5 | Loyalty, vouchers and savings | 5 | 5 | structural | **none** |
| 09.6 | Cross-report checks | — | 6 | structural | **none** |

---

## 10 — Cross-cutting · 22 cases

| ID | Sub-module | Screens | Cases | Depth | Automated |
|---|---|---|---:|---|---|
| 10.1 | The officer hierarchy, end to end | — | 8 | measured | partial — `role-scope.spec.ts`, `od-hierarchy-two-regions.spec.ts` |
| 10.2 | Audit | 1 | 3 | structural | **none** |
| 10.3 | Remaining small modules | 11 | 11 | structural | **none** |

---

## Where the suite stands, by sub-module

| Depth | Sub-modules | Cases | Share |
|---|---:|---:|---:|
| measured | 26 | 220 | 56% |
| partial | 9 | 62 | 16% |
| structural | 21 | 112 | 28% |
| | **56** | **394** | |

| Automation | Sub-modules | Cases |
|---|---:|---:|
| yes | 10 | 66 |
| partial | 13 | 130 |
| none | 33 | 198 |

**Half the cases have no automation at all, and 28% are structural** — written against screens
nobody has opened. Both are the honest state rather than a target; they are here so a sprint can be
planned against numbers instead of an impression.

Note that "measured" is the largest share by case count while "structural" covers the most
**screens** — 49 of the 116, because Reports and Retail Outlet are wide and shallow. Coverage
counted by case flatters the suite; counted by screen it does not. Both are in this file
deliberately.

---

## Suggested execution split

Four testers, one pass, roughly balanced by effort rather than case count — the measured modules
are slower per case because they involve multi-stage flows and database confirmation.

| Tester | Modules | Cases | Notes |
|---|---|---:|---|
| A | 00, 02, 03 | 98 | The onboarding and OD chains. Needs DSA, TSM, checker and the nine officer accounts |
| B | 01, 04, 06 | 123 | Auth, customer management, users. Needs database access for the matrix cases |
| C | 05, 07 | 82 | Vehicle and money. Needs the de-registered registrations file |
| D | 08, 09, 10 | 88 | The structural sweep. Fastest per case; also the best place to start the probe pass |

**Tester A must finish module 02 before C starts 05** — vehicles need an approved customer with an
approved branch.

---

## Automation order, if that is the next phase

1. **04.7** — the hierarchy caps. Live since 22 September, retroactive on existing customers, and
   nothing distinguishes a cap refusal from a conflict refusal.
2. **REG-CO-49** — onboarding still creates its own administrator. Rests on unguarded ordering.
3. **03.5** — self-enrolment. A public, unauthenticated write path with one known defect and no
   automation at all.
4. **07.2 and 07.3** — the money paths. Double-submit and abandoned-gateway first.
5. **08 and 09** — but **probe first**. Both modules are structural because nobody has opened those
   49 screens; automating against assumptions is how the customer and vehicle suites acquired their
   false findings.
