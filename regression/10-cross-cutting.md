# 10 — Cross-cutting

Checks that belong to no single screen: the officer hierarchy as a whole, audit, the remaining
small modules, and the traps that make manual execution here go wrong.

---

## The officer hierarchy, end to end

The single most productive area in this application for finding defects, and the least
self-evident. Scope is a prefix in `dbo.UserLocationMapping`:

| Role | Holds |
|---|---|
| REGION_ADMIN | `RegionId` |
| STATE_ADMIN | `RegionId` + `BusinessStateId` |
| DIVISION_ADMIN | all three |
| TERRITORY_ADMIN | all three — and a TSM also reviews |

| ID | Pri | Case | Expected |
|---|---|---|---|
| REG-XC-01 | P0 | Every list screen, read as each of the nine officers | Each sees only records inside their own prefix. Use the account table in [README](README.md#accounts) |
| REG-XC-02 | P0 | The Ahmedabad I / Ahmedabad II pair on a **non-OD** record | Division 1 sees it, division 2 does not. They differ only by division, so this isolates that level exactly |
| REG-XC-03 | P0 | The same pair on an **OD** record | Both see it — the division level is removed for OD |
| REG-XC-04 | P0 | Ahmedabad officers against a Kolkata record, and the reverse | Neither sees the other's. **KNOWN FAIL for OD — FP-OD-1.** Confirm for Fleet |
| REG-XC-05 | P0 | A region admin against a record in another region | Not visible |
| REG-XC-06 | P1 | An officer with no location mapping at all | Sees nothing, rather than everything. Users created through `usp_AddUser` are in this state |
| REG-XC-07 | P0 | Direct-URL access to a record outside an officer's scope | Refused, not merely absent from the list. A list that hides a record while its detail page opens is a leak |
| REG-XC-08 | P1 | The reviewer queue is scoped | A TSM sees applications from its own division. **KNOWN: OD applications appear cross-division and cross-state** |

---

## Audit

| ID | Pri | Case | Expected |
|---|---|---|---|
| REG-XC-09 | P0 | Every approval, rejection and status change is recorded with actor and timestamp | Present in the relevant log |
| REG-XC-10 | P0 | No audit screen offers edit or delete | No control |
| REG-XC-11 | P1 | Actions taken by a service account are attributed, not blank | Recorded |

---

## Remaining small modules

**Depth: structural.** The four checks from [module 08](08-retail-outlet.md) apply.

| ID | Pri | Screen | Route | Beyond a–d |
|---|---|---|---|---|
| REG-XC-12 | P1 | View Reward Rules | `Reward/IssuedRewardStructure` | Active rules render |
| REG-XC-13 | P1 | Create Reward Rules | `Reward/Rewardstructure` | Created, pending approval |
| REG-XC-14 | P0 | Rewards Approval | `Reward/RewardApproval` | Four-eyes; only then does the rule apply |
| REG-XC-15 | P0 | Redeem Reward Points | `Reward/RedeemCoins` | Points fall by exactly the amount redeemed; redeeming more than held is refused |
| REG-XC-16 | P1 | Manage Saving Ticket | `SavingTicket/ManageSavingTickets` | Issued and listed |
| REG-XC-17 | P1 | Manage Segment | `SavingTicket/ManageSegment` | Segment saved and applied |
| REG-XC-18 | P1 | Manage Fuel Voucher | `FuelVoucher/FuelVoucherDetails` | Issued vouchers listed |
| REG-XC-19 | P0 | Redeem Fuel Voucher | `FuelVoucher/RenderRedeemVoucherPage` | Redeemed once; a second redemption of the same voucher is refused |
| REG-XC-20 | P1 | SFL Claim Upload | `SFLClaim/Upload` | File accepted; a malformed one refused with a message |
| REG-XC-21 | P1 | Dashboard | `Dashboard/Index` | Tiles and figures render and agree with the underlying data |
| REG-XC-22 | P1 | Dashboard per role | Each role's dashboard shows only what its scope covers |

---

## Known traps

Every one of these has cost real time on this application. Read before executing anything, and
before raising a defect that looks like one of them.

### 1. Buttons that do nothing, and do not say why
A decision control with an unmet precondition sends no request, opens no dialog and writes no
message. Confirmed cases:

- **Reviewer "Reviewed"** — needs every document preview opened first.
- **Checker "Approve"** — needs both Verify fields re-entered until the buttons read "Verified".

Neither is disabled, and neither explains itself. **A button that appears broken here usually is
not.** Work through the preconditions before raising it.

### 2. Success messages that are not proof
"Customer data has been saved successfully" appears on forms that then refuse to submit. Confirm
every state change by reopening the record or reading the database. A screenshot of a green banner
is not evidence.

### 3. Hidden controls with the same name as visible ones
`#btnsubmit` exists hidden in an inactive pane while the real control is `#btnSubmitPreview`;
`#btnAdd` is hidden on the OD form while a different Submit is visible. If a control seems not to
respond, check you are using the one the page is actually offering.

### 4. The same URL renders two different pages
Reached directly, the Add Customer wizard and the checker screen come back **without** their
footer controls or re-entry fields. Reached by clicking through the list or queue, they render
fully. Never navigate to a working screen by pasting its URL.

### 5. Status changes arrive late
Review and approval decisions post, and the status moves a few seconds afterwards. Reading it
immediately shows the old value. Refresh before concluding that a decision did not take.

### 6. Dialogs live in the DOM permanently
A dialog being present means nothing; only a *shown* one is open. When automating, match
`.modal.show`.

### 7. Confirmation buttons are not called "Yes"
The reviewer's is "YES" with surrounding whitespace and sits beside a "NO". The checker's is
**"Yes, approve"** beside "Cancel". Taking the first button in the dialog takes the wrong one.

### 8. Enter does not submit searches
At least one grid needs its search **button** — `#btnVehicleApprovalSearch`. Pressing Enter looks
like a search that returned everything.

### 9. Grids render cells with no separator
A row reads `11000514939OD…` — the serial number runs straight into the reference. Read the cell,
not the row.

### 10. Grids show a window you cannot page past
View Onboarding lists only its ten newest; pagination does not advance and the date filter is a
datepicker that ignores typed input. If your record is not among the newest, search for it by key
or raise a fresh one.

### 11. "Loading…" is not a row
A grid mid-render looks like a grid with data. Wait for it to resolve before counting anything or
concluding a list is empty.

### 12. Required-field asterisks look like errors
The red `*` beside every mandatory label shares its styling with validation errors. A page "showing
errors" may just be showing asterisks.

### 13. Data that disagrees with itself
Some customers hold a division belonging to one state and a `CustomerStateId` naming another —
NAYAFP2020900082 has division 17 (state 4) with state 7. When checking scope, derive the region
from the division rather than the state, or you will see leaks that are really bad data.

### 14. One mobile, many users, one password
A mobile can carry up to 50 `Users` rows sharing a single password hash. Changing the password
changes it for all of them, and deactivating one row revokes nothing.

---

## Environment failures that look like defects

| Symptom | Actual cause | Do this |
|---|---|---|
| 404 or 502 across the whole app | A deploy in progress | Wait, retry, record the footer version |
| `ECONNRESET` on database queries | VPN dropped | Reconnect; the application is fine |
| "Invalid captcha" on a correct sign-in | Transient server-side | Retry once before raising |
| A record stored with unexpected values | The build changed under you | Check the record's created-on time against the deploy window. An OD application raised before 11:08 on 23 Sep carries division 0 by accident of timing, not by defect |
