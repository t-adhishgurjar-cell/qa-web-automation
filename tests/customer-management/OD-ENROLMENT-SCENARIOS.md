# OD enrolment — Division and pin-code restriction

**Change request.** "During enrolment of OD user type, Division along with Pin code
restriction basis division to be removed."

**Screen.** Add Customer wizard, `/Customer/AddCustomer?new=1`, reached through
Customer Management → Add Customer. There is no separate OD module: the menu tables
carry no OD screen, and OD is customer type `1004` in `dbo.CustomerTypeMaster`
alongside Fleet (1001), Non Fleet (1002) and Corporate (1006).

---

## What the change looks like in the application

Established by probe on 22 September 2026 against `webqa.fleetforc.com`, read-only.

`dbo.DivisionMaster` gained a column `IsPlaceholder` and **fifteen rows** named
`OD Default - <business state>`, `DivisionId` 51–65, `DMId` `ODDEF-1`…`ODDEF-15`,
all `IsPlaceholder = 1`, all created `2026-09-22 16:11:52` — twenty minutes before
the first probe ran. Exactly one per business state, and there are exactly fifteen
business states on the form. So the implementation is not "delete the field": it is
"give every state a division that stands for no division", and point OD at it.

On the form, with a clean load and OD chosen first:

| Control | Fleet / Non Fleet / Corporate | OD |
|---|---|---|
| `#CustDivisionID` | visible, enabled, required | **hidden and disabled**, value `0` |
| `#CustStateID` | maker's own state, changeable | maker's own state, changeable |
| address pin code | resolves any pin code | resolves any pin code |

`POST /Common/GetLocationByPincode` is sent `pincode=<value>` and nothing else — no
division, no state — and returns city, district and state for anything valid. No
page script mentions a pin code and a division together, no stored procedure
mentions both, and `dbo.PincodeMaster` has no division column. **There is no
pin-code-basis-division rule left anywhere the probes can reach**, which is what the
change request asked for; the tests below pin that down so a regression is visible.

---

## Scenarios

### A — Division removed for OD (no writes)

| # | Scenario | Expected | Result |
|---|---|---|---|
| OD-01 | Clean form, choose OD | `#CustDivisionID` not visible; value `0`; nothing to choose | **pass** |
| OD-02 | Clean form, choose Fleet / Non Fleet / Corporate | division visible, enabled, required — the change must not reach other types | **pass** (all three) |
| OD-03 | Fleet → OD | division hides **and its value is cleared**, so no stale division is posted | **FAIL** — keeps `17` (FP-OD-4) |
| OD-04 | OD → Fleet | division returns, enabled, and a choice is required again | **pass** |
| OD-05 | OD, then change business state | division list reloads for the new state | **FAIL** — stale list (FP-OD-3) |
| OD-06 | OD under each of the 15 business states | every state selectable; division stays hidden throughout | **pass** |

### B — Pin code no longer restricted by division (no writes)

| # | Scenario | Expected | Result |
|---|---|---|---|
| OD-10 | OD, address pin code in another state (`201304` UP against an HR maker) | resolves, fills state/city/district, no complaint | **pass** |
| OD-11 | OD, address pin code in another region (`560001` KA) | same | **pass** |
| OD-12 | OD, branch-location pin code in another state | accepted | n/a — OD has no branch step |
| OD-13 | OD, pin code that resolves to nothing (`999999`) | **still refused** — the change removes a division rule, not pin-code validation | **pass** |
| OD-14 | Non-OD type, cross-state pin code | recorded, not asserted: the CR names OD only, so this establishes whether other types were changed too | not run |

### C — What is stored, and who can review it (applications created)

| # | Scenario | Expected | Result |
|---|---|---|---|
| OD-20 | Submit a complete OD application with a cross-state pin code | accepted; confirmation names the reference | submit **passes**; stored division **FAILS** (FP-OD-2) |
| OD-21 | The stored division for that application | the `OD Default - <state>` placeholder for the chosen state, `IsPlaceholder = 1` — not the maker's own division, not null | **FAIL** — stored as `0` |
| OD-22 | Exactly one placeholder division per business state | 15 states, 15 placeholders, no duplicates | **pass** |
| OD-23 | A reviewer exists for the placeholder division | **at risk — see below** | **none exists** |

---

## The risk this change carries

Division has never been decoration on this form: it decides which TSM sees the
application. Measured today:

- `dbo.TSMDivisionMapping` — **no TSM is mapped to any placeholder division**.
- `dbo.UserLocationMapping` — **no officer's location mapping points at one**.
- No customer and no in-flight application uses one yet, so nothing has hit this.
- The last ten OD applications all carried **real** divisions (Noida, Hyderabad,
  Ahmedabad I/II, Kolkata, Baroda, Dehradun) and all reached status 101, Active.

If an OD application raised after this change is divisioned to a placeholder, and
review is still division-scoped, it lands in a queue no reviewer is mapped to and
sits at 102, Pending for Review, indefinitely. This suite has already lost a day to
exactly that failure mode on Hyderabad-vs-Gurgaon, and it is invisible from the
maker's side — the form reports success.

OD-20 and OD-23 exist to find out which of two things is true: OD skips
division-scoped review, or OD applications have just become unreviewable.

---

## Not covered yet

- **Approval of an OD application** end to end (raise → review → approve). Needs a
  reviewer who can see a placeholder division, which is the open question above.
- **Server-side enforcement.** The division control is hidden, not absent, and its
  options still include real divisions. Whether the server would accept a tampered
  `CustDivisionID` on an OD application is untested — it needs a crafted post, not a
  UI action.
- **Editing an existing OD customer** raised before the change, whose division is a
  real one. Whether that form now hides a populated division is unknown.


---

## Results, 22 September 2026

**17 tests: 10 pass, 7 fail.** Every failure is a distinct defect, filed in
[OD-JIRA-TICKETS.md](OD-JIRA-TICKETS.md).

**The change request itself is implemented and works.** Division is not offered for an
OD enrolment, the other three customer types keep it unchanged, and no pin code is
judged against a division any more — a pin code in another state, and one in another
region, both resolve and are accepted, while an unresolvable pin code is still refused.

What testing around it found:

| Ticket | Priority | Defect |
|---|---|---|
| FP-OD-1 | **P0** | OD applications are visible to every officer in the country; non-OD applications on the same screen are correctly scoped |
| FP-OD-2 | **P1** | A submitted OD application is stored with `CustomerDivisionId = 0`; the fifteen new `OD Default` placeholder divisions are unused |
| FP-OD-3 | **P1** | Changing the customer type or the business state does not reload the dependent dropdown, so a Fleet sub-type survives into OD and blocks submit with a misleading message |
| FP-OD-4 | P2 | The hidden division keeps its value under OD (`17`), though it does not reach the database |
| FP-OD-5 | P2 | A duplicate PAN is reported as "validate the PAN before submission" |

### The hierarchy question, answered

Asked: can a state admin, division admin or territory admin see a created OD customer?

**Yes — and so can every other one, anywhere in the country.** Measured on View
Onboarding (`/Customer/CustomerOnboardingStatus`), which is the officers' screen; the
Add Customer list shows them nothing at all, and Review Onboarding is refused to
region, state and division admins since they are not reviewers.

| Officer | Scope | Sees the OD application raised in GJ_I? | Sees non-OD outside scope? |
|---|---|---|---|
| Region admin `9072986100` | region 4 | yes | — |
| State admin `9073068501` | region 4, state 11 | yes | — |
| Division admin `9073139002` | region 4, state 11, division 1 | yes | **no** — correctly scoped |
| Territory admin `9612200200` | region 2, state 4, division 17 | **yes** — another region entirely | **no** — correctly scoped |

The last two rows are the finding. Both officers see only their own division's Fleet
applications and every OD application in the system.

### Still not covered

- **Approving an OD application end to end.** All five raised sit at 107, Consent
  Pending; consent is a customer action driven from `dbo.UserSMSLog`, and the review
  stage after it needs a reviewer who can see division 0 — which is FP-OD-2.
- **Server-side enforcement of the hidden division.** Whether a crafted post carrying
  `CustDivisionID=17` on an OD application would be honoured is untested; it needs a
  request, not a UI action.
- **Editing an OD customer raised before this change**, whose division is a real one.

### Test data created

Five OD applications in QA, all at status 107: 1000514927, 1000514928 (drafts, 103),
1000514929, 1000514930 (HR_HP_PB) and 1000514939 (GJ_I). Tagged `AUTO<timestamp>`.
