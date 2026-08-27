# Customer Management — Automation Coverage

Source of truth for test cases: `test-data/FleetPlusMasterTestCases.xlsx`.
Scope: the 20 screens under **Customer Management** in the FleetPlus navigation.

## Screen → route → workbook sheet

| Screen | Route | Sheet | TCs |
|---|---|---|---|
| Add Customer | `/Customer/ManageCustomerOnboarding` → `/Customer/AddCustomer?new=1` | Customer Onboarding | 45 |
| View Onboarding | `/Customer/CustomerOnboardingStatus` | Customer Onboarding (shared) | — |
| Review Onboarding | `/Customer/CustomerOnboardingReviewer` | Customer Onboarding (shared) | — |
| Leads Management | `/Lead/LeadList` | — | 0 |
| Approved Customers | `/Customer/ManageCustomers` | — | 0 |
| Add Customer Bank Account | `/Financial/AddBankDetails` | — | 0 |
| Transaction Details | `/TransactionDetail/WalletFundTransactions` | Transaction Details | 9 |
| Activate / Deactivate Customer | — | Manage Customer Status | 57 |
| Manage Credit PIN | — | Manage Customer Credit Mapping | 26 |
| Manage Products and Transactions | — | Manage Products & Transactions | 28 |
| Customer Credit PIN validity | — | Customer Credit PIN Validity | 15 |
| Credit PIN logs | — | Credit PIN Logs | 28 |

Routes are confirmed only for the screens reachable by the DSA and TSM accounts
we hold; the rest need an account with the matching menu entitlement.

## Role visibility

Menu entitlements differ sharply, so a spec must use an account that can see the
screen it tests:

- **DSA** (`9611200199`) — Add Customer, View Onboarding, Review Onboarding, Leads Management
- **TSM** (`9612200200`) — the above minus Leads, plus Approved Customers, Add Customer
  Bank Account, Transaction Details, and the Vehicle/RO/Reports screens

## Automated so far

`add-customer.spec.ts` — 5 tests, all passing:

| Test | Workbook TC |
|---|---|
| wizard opens with the onboarding form | TC002 |
| user information is auto-populated from the session | TC002 |
| reference number generated, application date locked | TC003 |
| related party YES reveals RO code, NO hides it | TC004 |
| opening the wizard from the onboarding list | TC002 |

## Deliberately not automated yet

**Submitting an application.** Creating a customer has real downstream effects in
QA — it consumes a reference number and enters the reviewer queue — so the
happy-path submission needs a cleanup story (or a disposable environment) before
it runs on a schedule. The tests above assert the form's contract instead: what
the app generates, what it locks, and what it reveals conditionally.

Blocked on test data or fixtures:

- **TC005 / TC007** — PAN, GST, bank proof and address proof uploads need
  fixture files committed to the repo.
- **TC006** — customer mobile OTP verification. `TEST_OTP` covers login; whether
  the same fixed OTP applies to customer verification is unconfirmed.
- **TC009–TC012** — address pin-code auto-fill and branch locations. Reachable
  only after Basic Information is saved, which creates the application.

## Notes for whoever extends this

- The wizard is one long page of ~158 fields, not separate routed steps. Sections:
  maker details, application, business, customer, segmentation, bank, address,
  branch locations (repeating `uiBO*`), meeting details (`Attendant0..9`).
- Radio inputs are `.visually-hidden`; clicking the input does nothing. Click the
  `label[for=...]` instead — `setRelatedParty()` shows the pattern.
- **`storageState` does not work against FleetPlus.** The saved cookies carry no
  auth token, and replaying `.AspNetCore.Session` into a fresh context returns
  "Session Expired, Please login again!". Specs must log in themselves, and must
  wait for the dashboard before navigating or the next `goto` aborts.
