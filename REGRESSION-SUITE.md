# FleetPlus Web — Regression Suite

**Audience:** the QA engineers who will run and extend this, and the release manager who
decides on it. It assumes familiarity with FleetPlus but not with this repository.

**Scope:** the web application at `webqa.fleetforc.com`. Mobile and the SAP/Office APIs appear
only where a web flow depends on them.

---

## 1. What the application is, measured

`dbo.MenuMaster` holds **116 active final-page screens** across 17 controllers. That is the
denominator for every coverage claim below.

| Module | Screens | Driven by the suite today |
|---|---:|---:|
| Reports | 26 | 0 |
| Retail Outlet | 23 | 0 |
| Customer Management | 18 | 10 |
| Vehicle | 17 | 7 |
| Financial | 8 | 3 |
| Terminals | 4 | 0 |
| Reward | 4 | 0 |
| User Management | 2 | 1 |
| Security | 2 | 0 |
| Saving Ticket | 2 | 0 |
| PG Recharge | 2 | 1 |
| Lead | 2 | 0 |
| Fuel Voucher | 2 | 1 |
| Transaction Detail | 1 | 0 |
| SFL Claim | 1 | 0 |
| Dashboard | 1 | 1 |
| Customer TDS | 1 | 0 |
| **Total** | **116** | **23 (20%)** |

"Driven" means some test navigates there. It says nothing about depth: `Vehicle/ManageVehicles`
is in that column and five defects were found behind it, while other entries are opened and
asserted to render.

**Reports and Retail Outlet together are 49 screens — 42% of the application — with no test at
all.** Any statement that "regression passed" today excludes them.

---

## 2. How this suite is organised

Three tiers, because a regression run has to be able to stop early and mean something.

| Tier | Purpose | Gate |
|---|---|---|
| **T0 — Gate** | Is the environment and the build usable at all? | Anything red here invalidates the rest. Stop. |
| **T1 — Core business flows** | The money paths: onboard a customer, get a vehicle transacting, control access | Red here blocks release. |
| **T2 — Breadth** | Every remaining screen opens, filters, exports and respects scope | Red here is triaged, not automatically blocking. |

Cross-cutting checks (hierarchy scope, role entitlement, audit) run inside T1 rather than as a
separate pass, because scope defects only show up against real records.

**Run order matters.** T1 creates the data T2 reads, and both depend on T0.

---

## 3. Tier 0 — Gate (must pass first)

| ID | Check | Automated |
|---|---|---|
| T0-01 | Login page renders, captcha field present, sign-up link points at `/Home/PersonalSelfEnrolment` | yes — `tests/auth/login.spec.ts` |
| T0-02 | Valid sign-in reaches a dashboard for each of: FP Admin, DSA, TSM, Customer Admin, Branch Admin | yes — `tests/auth`, `role-modules.spec.ts` |
| T0-03 | Invalid sign-in is refused **with a message** on the surface the app actually uses (`#failer-mess-text` / `#error-mess-text`, not inline text) | yes |
| T0-04 | Forgot Password and Unlock User issue an OTP and accept it | partial — modal covered, reset outcome not asserted |
| T0-05 | Forced first-login password change is enforced and completes | yes — `change-password.page.ts` |
| T0-06 | Read-only database login connects | yes — `tests/database/connection.spec.ts` |
| T0-07 | Dashboard renders sidebar and user menu; no console errors | partial |
| T0-08 | Role/menu entitlement: each role sees exactly the menu set `RoleMenuMappings` grants it | yes — `role-modules.spec.ts`, `role-scope.spec.ts` |

**T0 is the cheapest thing in this document and the most often skipped.** Two full days were
lost this month to failures that T0-02 and T0-06 would have attributed in seconds: an app
mid-redeploy returning 404s, and a dropped VPN reported as application defects.

---

## 4. Tier 1 — Core business flows

### 4.1 Customer onboarding — the four-eyes chain

The spine of the product. A DSA-raised application walks
`107 Consent Pending → 102 Pending for Review → 105 Pending for Approval → 101 Active`;
an FP-Admin-raised one skips 102.

| ID | Check | Automated |
|---|---|---|
| T1-CO-01 | Raise a Fleet application through all four wizard steps; reference number generated and returned in the confirmation | yes — `add-customer-onboarding.spec.ts` |
| T1-CO-02 | Customer consent via the SMS token moves 107 → 102 | yes — `onboarding-e2e.spec.ts` |
| T1-CO-03 | A **same-division** TSM reviews it: 102 → 105 | yes — `review-customer.page.ts` |
| T1-CO-04 | A checker who is **not** the maker approves it: 105 → 101, `CustomerMaster` row and admin user created | yes — `approve-customer.page.ts` |
| T1-CO-05 | Reject and Send-for-Correction each land the application in the right state | **no** — reject path unreachable in earlier testing, never asserted |
| T1-CO-06 | An FP-Admin-raised application skips 102 | partial |
| T1-CO-07 | Onboarding still creates the customer's own administrator | **no — write this first.** It depends on the customer row not yet being at a blocking status when the admin is created, and `usp_AddUser` now refuses any user on a non-OD customer's mobile. Ordering holds today (52 Fleet admins since 3 Sep) and nothing guards it |
| T1-CO-08 | Duplicate PAN is refused with a message naming the PAN | **no** — currently reports "validate the PAN before submission" (FP-OD-5) |
| T1-CO-09 | Add Branch, and Approve Customer Branch | yes — `add-branch.spec.ts`, `add-branch-parent-admin.spec.ts` |
| T1-CO-10 | Customer bank account: add, then approve | yes — `customer-bank.spec.ts` |
| T1-CO-11 | Activate / Deactivate customer, and the effect on its users and vehicles | partial — `customer-status.spec.ts` |
| T1-CO-12 | Customer Edit Approval (`ApproveCustomerProfileEdit`) | **no** |
| T1-CO-13 | Customer Audit Logs record the above | **no** |

### 4.2 OD enrolment and hierarchy — currently the live change

| ID | Check | Automated |
|---|---|---|
| T1-OD-01 | OD enrolment offers no division control; other customer types still require one | yes — `od-enrolment.spec.ts` |
| T1-OD-02 | No pin code is judged against a division; an unresolvable pin code is still refused | yes |
| T1-OD-03 | A submitted OD application stores the `OD Default - <state>` dummy division | yes — `od-enrolment-submit.spec.ts` |
| T1-OD-04 | **Division level removed:** every division-scoped officer in a state sees that state's OD, whatever their own division | yes — `od-hierarchy-two-regions.spec.ts` |
| T1-OD-05 | **Region and state intact:** an OD application is invisible to officers outside its region or state | yes — **failing, 9 of 9 officers. FP-OD-1** |
| T1-OD-06 | Self-enrolment stores the dummy division too | yes — **failing. FP-OD-7**, pin code still derives a real division |
| T1-OD-07 | Legacy OD customers on real divisions remain visible across divisions | yes — `probe-od-legacy-division-visibility.spec.ts`, passing; keep it, it guards against a fix that keys off `IsPlaceholder` |
| T1-OD-08 | An OD customer can be reviewed and approved on a dummy division | yes |

### 4.3 Vehicle lifecycle

| ID | Check | Automated |
|---|---|---|
| T1-VE-01 | Add a registered vehicle manually; Vahan verification path and its failure path | yes — `add-vehicle.page.ts` |
| T1-VE-02 | Vehicle Approval queue: only entitled admins approve, and only the matched row | yes — `manage-vehicle.spec.ts`, APPROVAL-SCOPE-SCENARIOS.md |
| T1-VE-03 | Bulk upload: accepted, rejected-on-branch and rejected-for-other-reasons are distinguished | yes |
| T1-VE-04 | Bulk mapping / de-mapping across divisions, with the customer boundary holding | yes |
| T1-VE-05 | Vehicle cannot be added to an inactive customer | yes — defect recorded |
| T1-VE-06 | Set vehicle limit, prepaid limit, and default limits update | partial |
| T1-VE-07 | Block / unblock, and transfer between customers | partial |
| T1-VE-08 | De-map then re-add the same registration | **no** |
| T1-VE-09 | Vehicle RO mapping, Generic Vehicle Approval, Manage Pending Vehicle | **no** |
| T1-VE-10 | Vehicle Lifecycle screen reflects the above transitions | **no** |
| T1-VE-11 | Products and transactions enable/disable per vehicle | **no** |

### 4.4 User management and access control

| ID | Check | Automated |
|---|---|---|
| T1-UM-01 | UserType × CustomerType matrix — 117 cells, spec verdict and code verdict | yes — `matrix-add-user.spec.ts` and siblings |
| T1-UM-02 | Officer creation via the Office API writes `Users`, `UserProfiles`, `UserLocationMapping`, `UserRoleMappings` with correct scope | yes — `create-officers.spec.ts` |
| T1-UM-03 | A user created through `usp_AddUser` has **no** location mapping — assert it, so a future change that starts writing one is noticed | **no** |
| T1-UM-04 | `CUSTOMER_PARENT_USER` / `CUSTOMER_CHILD_USER` caps: the refusal names the cap, and is distinguishable from a mobile-conflict refusal | **no — add.** Caps landed 22 Sep at 2 each; 16 parent and 8 branch codes already at limit |
| T1-UM-05 | A disabled user of a blocking type still blocks its mobile | **no** |
| T1-UM-06 | One mobile means one password: a change on any row changes all, and disabling one row revokes nothing | **no** — security-relevant |
| T1-UM-07 | Manage Roles and Manage Mobile Roles | **no** |
| T1-UM-08 | View Purchase OTP log | **no** |

### 4.5 Financial and wallet

| ID | Check | Automated |
|---|---|---|
| T1-FI-01 | Add customer bank account, then approve | yes |
| T1-FI-02 | Wallet recharge by PG, and the recharge status screen | partial |
| T1-FI-03 | Wallet transfer between customer and vehicle, balances reconcile | partial |
| T1-FI-04 | RO bank account: add and approve (dealer path) | **no** |
| T1-FI-05 | Suspense / unclaimed transactions | **no** |
| T1-FI-06 | Credit PIN: set validity, and the change log records it | partial |

### 4.6 Retail Outlet — 23 screens, nothing automated

The largest untested module. Listed at flow level because no measurement exists to write
detail from; whoever automates it should probe first, as was done for customer and vehicle.

| ID | Check | Automated |
|---|---|---|
| T1-RO-01 | RO profile: view, update, and contact approval | **no** |
| T1-RO-02 | RO credit: accounts, purchase, statement, settlements | **no** |
| T1-RO-03 | EDFS: add mapping, approve, view approved accounts | **no** |
| T1-RO-04 | Offline transactions: review → approval → tracker | **no** |
| T1-RO-05 | Manage RO users, services, PIN, default limits | **no** |
| T1-RO-06 | Terminals: add, bulk upload, approval, status summary | **no** |
| T1-RO-07 | RO Locator (`ViewLiveRo`) | **no** |

---

## 5. Tier 2 — Breadth

For every screen not covered above, four checks. They are shallow by design: the point is that
a release cannot silently break a screen nobody looks at.

| ID | Check applied to each screen |
|---|---|
| T2-01 | Opens for an entitled role — HTTP 200, no "Unauthorized Access" body, grid or form renders |
| T2-02 | Refused to a role `RoleMenuMappings` does not grant it |
| T2-03 | Filters and search return a filtered result, not the unfiltered grid |
| T2-04 | Export (Excel / PDF) produces a file whose row count matches the grid |

**Reports (26 screens)** additionally need T2-05: the report's figures reconcile against the
same numbers read from the database. Without that a report suite proves only that a page
renders — and a wrong number renders exactly as well as a right one.

---

## 6. Traps that have already cost time

Anyone automating against this application should read these first. Every one was found the
expensive way.

| Trap | What it looks like | What to do |
|---|---|---|
| **Silent gates** | A decision button sends no request, opens no dialog, writes no message. Reviewer "Reviewed" needs each document previewed; checker Approve needs both Verify buttons reading "Verified" | Preview documents and satisfy re-entry checks before clicking; never read an absent error as success |
| **Hidden controls shadowing visible ones** | `#btnsubmit` exists hidden in an inactive pane; `#btnAdd` is hidden on the OD form while a different Submit is visible | Always `:visible`. Prefer the control the page actually offers over the one you expected |
| **Dialogs parked in the DOM** | `.modal` is always present; only `.modal.show` is open | Match `.modal.show`; wait for it, do not sample |
| **Confirmations that are questions** | "YES" carries whitespace; the checker's is "Yes, approve" | Match text whitespace-tolerantly and as a prefix; never take the first button in the dialog |
| **Same URL, two pages** | Reached directly, the Add Customer wizard and the checker screen render without their footer or re-entry fields | Navigate by clicking through the queue or list, not by URL |
| **Asynchronous status** | A decision posts and the status moves seconds later | Poll the status; never read it immediately after the click |
| **Required-field asterisks** | `.text-danger` containing `*` reads as a validation error | Filter bare asterisks out of any error scrape |
| **Grids that concatenate cells** | A row reads `11000514939OD...` — serial runs into reference | Read cell by cell; never `\b`-anchor a match against row text |
| **Windowed grids** | View Onboarding shows only its ten newest; pagination does not advance and the date filter is a datepicker | Raise your own fixtures so they are the newest, or search by key |
| **Success messages that lie** | "Customer data has been saved successfully" on a form that will refuse at submit | Confirm against the database, never against the banner |
| **`networkidle` beats the request** | Lookups fire on blur, after `networkidle` is already true | Wait for the field to fill, not for the network to settle |
| **Duplicate user rows per mobile** | One mobile carries up to 50 `Users` rows, one password between them | Never assume one row per mobile |
| **Records that disagree with themselves** | A customer with division 17 (state 4) and `CustomerStateId` 7 | Derive region from the division, or accept that scope predicates will see false leaks |

---

## 7. Release gate

| Condition | Blocks release? |
|---|---|
| Any T0 red | Yes — the run is void, not failed |
| Any T1 red without an accepted defect reference | Yes |
| T1 red with an accepted, prioritised defect | Release manager's call |
| T2 red | Triage; blocks only if it is a customer-facing screen |
| Coverage below the previous run | No, but it must be stated in the sign-off |

Sign-off artefacts: `npm run signoff:report` builds the traceability matrix and the visual
evidence report. Both should be attached to the release record.

---

## 8. What this suite does not cover, stated plainly

- **Reports figures.** 26 screens, no reconciliation. A report can render perfectly and be
  wrong; nothing here would notice.
- **Retail Outlet.** 23 screens, nothing.
- **Mobile app** and the transaction path through terminals. A vehicle that is approved,
  limited and mapped is never actually made to buy fuel in this suite.
- **Concurrency.** Two checkers approving the same application; two makers editing one
  customer. Never attempted.
- **Non-functional.** No load, no security scanning, no accessibility. The one security-adjacent
  finding here — a shared password across every user row on a mobile — was noticed while doing
  something else.
- **Browsers other than Chromium** in practice. Firefox, WebKit and the two mobile projects are
  configured and are not part of any routine run.

---

## 9. How to run it

```bash
npm run verify                 # lint, typecheck, data checks — before anything
ENV=qa npx playwright test --project=database        # T0-06 first; it attributes VPN failures
ENV=qa npx playwright test --project=auth           # rest of T0
npm run regression:api                              # api-matrix,           45 tests
npm run regression:ui                               # user-management 59 + customer-management 128
ENV=qa npx playwright test --project=vehicle        # vehicle
npm run signoff:report                              # traceability + visual evidence
```

`npm run regression` chains the api, ui and sign-off steps. It does **not** include the vehicle
project — add it, or run it separately.

Two warnings about the current state of the suite itself:

- **`tests/customer/onboarding.spec.ts` is template scaffold** tagged `@regression`. It targets
  `/customers/onboarding` with an "Acme Corporation" fixture and asserts nothing about
  FleetPlus. `npm run test:regression` runs it and it passes. Delete it.
- **The last refactor is not fully verified.** Commit `f7a7dc8` replaced 82 fixed sleeps across
  13 page objects; the DB-free suites ran 67 of 68 with one environmental login failure, and
  the vehicle project has not been run since. Treat the first full run as a baseline, not a
  regression.
