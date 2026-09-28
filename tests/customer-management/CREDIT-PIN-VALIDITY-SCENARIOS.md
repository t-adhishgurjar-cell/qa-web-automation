# Customer Credit PIN Validity — scenarios

**Source.** `test-data/FleetPlusMasterTestCases.xlsx`, sheet
`Customer Credit PIN Validity` — 15 cases, 9 marked Automate, 6 Manual.

**Screen.** `/Customer/CustomerCreditPinValidity` — a grid of one row per
branch, each carrying that branch's credit PIN, its expiry, a refresh control
and an expiry selector.

**The route is measured; the selectors are not.** Established from
`dbo.MenuMaster` on 25 September 2026 against `webqa.fleetforc.com`:

| MenuId | MenuName | Route |
|---|---|---|
| 40 | Manage Credit PIN | `/Customer/CustomerCreditPinValidity` |
| 70 | Credit Pin Logs | `/Customer/CreditPinChangeLog` |
| 24 | Manage Products and Transactions | `/Vehicle/EnableDisableProdTrans` |

All three hang off `ParentMenuId` 2, the Customer menu. Two things follow that
`COVERAGE.md` got wrong:

- **"Manage Credit PIN" and "Customer Credit PIN Validity" are one screen**, not
  two. MenuId 40 is named the first and serves the second. The coverage table
  lists them as separate rows worth 26 and 15 cases, which double-counts a
  screen that has exactly 15.
- **Manage Products and Transactions is served by the Vehicle controller**
  despite sitting under the Customer menu.

Selectors and the column set are still unknown — the probe's browser half has
not completed a run. Do not write assertions against this screen before that
output exists: this application keeps controls in the DOM while hiding them.

```
TOOLS=true ENV=qa npx playwright test --project=tools --grep "probe credit pin"
```

---

## Accounts

Both actors are roles on one mobile, `9200000000`, already in
`src/config/accounts.ts`:

| Workbook actor | Account | Expected to see |
|---|---|---|
| Customer Admin | `PARENT_ADMIN` (`CUSTOMER_ADMIN` card) | every branch |
| Branch Admin | `BRANCH_ADMIN` (`BRANCH_ADMIN` card) | its own branch only |

Both cannot be held open at once: signing in as one ends the other's session.
`sessionFor` in `src/fixtures/session.fixtures.ts` closes the held session for a
username before signing it in under a different role, so a spec needing both
must accept a login per role — which is the behaviour TC_009 and TC_012 test.

---

## The expiry selector — the core of the screen

Six of the 15 cases are the `Select Expiry` dropdown and its `Update` button.
The workbook states the option list exactly (TC_003):

```
Select Expiry | 24 Hrs | 48 Hrs | 15 Days | Calendar Month
```

| TC | Selection | Expected expiry |
|---|---|---|
| TC_004 | 24 Hrs | 24 hours from update time |
| TC_005 | 48 Hrs | 48 hours from update time |
| TC_006 | 15 Days | 15 days from update date |
| TC_007 | Calendar Month | end of the current calendar month |
| TC_008 | nothing selected | refused, with a message |

These are the strongest candidates to automate first: one screen, one control,
five outcomes, and each expected result is a date the test can compute rather
than a string to eyeball. Worth asserting in the database as well as the grid —
the grid shows a formatted date, and whether the stored expiry matches is the
part a customer's credit actually depends on.

Note TC_004's second clause, "Update button becomes active": the button is
apparently disabled until an expiry is chosen, which is also what makes TC_008
worth checking — a disabled button and a validation message are different
implementations of the same requirement, and the workbook does not say which.

---

## Grid, scope and filtering

| TC | Scenario | Automate? | Note |
|---|---|---|---|
| TC_001 | Branch Admin sees a PIN and expiry | Manual | Expected expiry is hard-coded as `20/05/2026 06:00 PM`; a fixed date will not hold, so assert the shape, not that value |
| TC_009 | Customer Admin sees all branches | Manual | Workbook says "All 3 branches shown" and then lists none. `PARENT_ADMIN` owns `NAYAFP1023400246`, which holds **seven** live branches per `add-branch-parent-admin.spec.ts` — so the count must be read from the database, not taken from the sheet |
| TC_012 | Branch Admin restricted to own branch | Manual | The scope assertion worth having; pairs with TC_009 |
| TC_010 | Search by Branch UID | Automate | |
| TC_011 | Reset clears the filter | Automate | |
| TC_013 | Branch with no PIN shows empty PIN and `-` expiry | Manual | Needs a branch that has never had a PIN; may not exist and may not be creatable read-only |
| TC_014 | Pagination | Automate | Needs more than 10 branches; the seven above are not enough |
| TC_015 | Export CSV/PDF | Automate | `customer-bank.spec.ts` has no export precedent; download handling is new here |

---

## Order of work

1. Run the probe. Confirm the route, the grid id, the column set, and whether
   `Update` starts disabled.
2. `src/pages/customer-management/credit-pin-validity.page.ts` from that output.
3. TC_003 to TC_008 — the expiry matrix, as `PARENT_ADMIN`.
4. TC_010 and TC_011 — search and reset.
5. TC_009 and TC_012 — the two-role scope pair, branch count read from the
   database.

TC_013, TC_014 and TC_015 are held back: two need test data that may not exist,
and the third needs download handling this suite has not done before.

---

## What this screen writes

Refreshing a PIN (TC_002) and setting an expiry (TC_004–TC_007) **change real
credit PINs on real branches**. A branch whose PIN is refreshed stops accepting
the old one, so anything else depending on that PIN — including POS credit
transactions — is affected. Treat these as state-changing, like the vehicle
suite, and keep them out of a broad run until that is understood.
