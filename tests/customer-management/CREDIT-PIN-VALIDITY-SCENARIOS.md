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

---

## What the screen actually renders

Measured 28 September 2026 against `webqa.fleetforc.com`, as both roles on
`9200000000`. Re-read with:

```
TOOLS=true ENV=qa npx playwright test --project=tools --grep "probe credit pin"
```

The grid is `#tblCustomerPin`, seven columns:

```
SNO. | Branch Name | Branch UID | Credit PIN | Refresh PIN | Expiry of PIN | Action
```

Page-level controls, all with stable ids:

| Control | Selector | Customer Admin | Branch Admin |
|---|---|---|---|
| Branch UID filter | `#txtBranchUid` | visible | **in the DOM, hidden** |
| Search | `#btnSearch` | visible | **in the DOM, hidden** |
| Reset | `#btnReset` | visible | **in the DOM, hidden** |
| Rows per page | `#dt-length-0` | visible | visible |
| Quick filter | `#custSearchFilter` | visible | visible |
| Export Excel / PDF | `#btnExportExcel`, `#btnExportPdf` | visible | visible |

The filter trio being present-but-hidden for a Branch Admin is the trap this
application is known for: `toBeAttached()` would pass for a control the role
cannot use. Assert visibility, not presence.

**Row controls carry no ids at all.** Each row holds, in order: an
`input[type=password]` with the PIN, an unlabelled reveal button, a
`Refresh PIN` button, an `input[type=date]`, an `input[type=time]`, an `Update`
button, and an `input[type=hidden]` holding the combined value as
`2026-09-16T14:31:00`. They must be reached by row, scoped from the Branch UID
cell — never by index across the page.

### The workbook's expiry dropdown does not exist

TC_003 states the expiry is a dropdown offering
`Select Expiry / 24 Hrs / 15 Days / Calendar Month`. **There is no such
control.** The only `select` on the page is `#dt-length-0`, DataTables' rows-per-page.
Expiry is set as an explicit date and time per row.

That invalidates TC_003 as written and changes TC_004 to TC_007 from "choose a
preset" to "type a date and a time". The requirement behind them still holds and
is still worth testing — 24 hours out, 48 hours out, 15 days out, end of month —
but as computed dates entered into the two inputs. TC_008, updating with nothing
selected, becomes "clear the date and press Update".

Either the screen was rebuilt after the workbook was written or the workbook
describes a different build. Worth confirming with whoever owns the sheet before
the rewritten cases are signed off.

### Scope, measured

As **Customer Admin**: ten rows on page one with pagination showing at least two
pages, so more than ten branches exist — TC_014's precondition is met, and
TC_009's "All 3 branches shown" is wrong for this account.

As **Branch Admin**: exactly one row, its own branch `NAYAFP2023400247`
("testing"). TC_012 holds as written.

### Manage Products & Transactions is not reachable

`/Vehicle/EnableDisableProdTrans` returns `HTTP 200` with the title
**"Unauthorized Access"** for both the Customer Admin and the Branch Admin —
note it is a 200, so a test asserting on status code would pass while the user
sees a refusal. The workbook writes all 29 of its cases for a Customer Admin, so
either a different role is needed or the entitlement changed. Blocked until an
account that can open it is identified.

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

## The expiry cases, rewritten against the real control

Six of the 15 cases are the expiry and its `Update` button. Restated as the date
and time inputs the screen actually has:

| TC | Was | Becomes |
|---|---|---|
| TC_003 | dropdown offers four presets | no dropdown exists; assert the date and time inputs are offered per row |
| TC_004 | select 24 Hrs | enter now + 24 hours, Update, expect that value stored |
| TC_005 | select 48 Hrs | enter now + 48 hours |
| TC_006 | select 15 Days | enter today + 15 days |
| TC_007 | select Calendar Month | enter the last day of the current month |
| TC_008 | Update with nothing selected | clear the date, Update, expect a refusal |

Each expected value is computable, which is what makes these worth automating
first. Assert both the grid and the database: the grid shows a formatted date,
and the stored expiry is what a branch's credit actually depends on.

The hidden `input` alongside each pair holds the combined
`YYYY-MM-DDTHH:mm:00`, so it is the honest thing to assert against — it is what
the form posts, and it avoids depending on the display format of two separate
inputs.

---

## Grid, scope and filtering

| TC | Scenario | Automate? | Note |
|---|---|---|---|
| TC_001 | Branch Admin sees a PIN and expiry | Manual | Expected expiry is hard-coded as `20/05/2026 06:00 PM`; assert the shape, not that value |
| TC_009 | Customer Admin sees all branches | Manual | "All 3 branches shown" is wrong — measured at more than ten, across two pages. Read the count from the database |
| TC_012 | Branch Admin restricted to own branch | Manual | Measured true: exactly one row, `NAYAFP2023400247` |
| TC_010 | Search by Branch UID | Automate | Customer Admin only; the filter is hidden for a Branch Admin |
| TC_011 | Reset clears the filter | Automate | Same |
| TC_013 | Branch with no PIN shows empty PIN and `-` expiry | Manual | Every measured row already has a PIN; needs a branch that has never had one |
| TC_014 | Pagination | Automate | Precondition met — more than ten branches exist |
| TC_015 | Export CSV/PDF | Automate | No export precedent in this suite; download handling is new here |

Worth adding, not in the workbook: **a Branch Admin must not be offered the
Branch UID filter.** The controls exist in the DOM and are merely hidden, which
is exactly the kind of scope boundary that regresses silently.

---

## Order of work

1. ~~Run the probe.~~ Done — see above.
2. `src/pages/customer-management/credit-pin-validity.page.ts`, rows scoped by
   Branch UID rather than by index.
3. The read-only cases first, because they change nothing: the column set, the
   two-role scope pair (TC_009, TC_012), and the hidden-filter boundary.
4. TC_010 and TC_011 — search and reset, as `PARENT_ADMIN`.
5. TC_004 to TC_008 — the expiry matrix. **These write.** See below.

TC_013 and TC_015 stay held back: one needs a branch with no PIN, which no
measured row is, and the other needs download handling this suite has not done
before. TC_014 is now unblocked.

---

## What this screen writes

Refreshing a PIN (TC_002) and setting an expiry (TC_004–TC_007) **change real
credit PINs on real branches**. A branch whose PIN is refreshed stops accepting
the old one, so anything else depending on that PIN — including POS credit
transactions — is affected. Treat these as state-changing, like the vehicle
suite, and keep them out of a broad run until that is understood.
