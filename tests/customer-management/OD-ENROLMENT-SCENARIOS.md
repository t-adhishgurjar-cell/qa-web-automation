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
| OD-20 | Submit a complete OD application; it must carry its state's dummy division | `OD Default - <state>`, `IsPlaceholder = 1` | **pass** — 54 for HR_HP_PB |
| OD-21 | A division chosen under Fleet must not follow the form into OD | stored with the dummy, not Gurgaon | **pass** — chose 17, stored 54 |
| OD-22 | Exactly one placeholder division per business state | 15 states, 15 placeholders, no duplicates | **pass** |
| OD-23 | An OD application can be reviewed and approved on a dummy division | it reaches Active | **pass** — 1000514956 is 101, customer NAYAFP3023400261, division 57 |

---

## The risk this change carries

Written first on a misreading — that an OD application storing no division was a
defect — and corrected here, because the correction matters more than the original
worry.

`CustomerDivisionId = 0` **is the change working.** The client asked for the division
level to stop applying to OD, and it has. The fear that a division-less application
would land in a queue no reviewer is mapped to is answered by the product: reference
1000514956 carries division 0 and has reached status 105, Pending for Approval.

What remains genuinely untested is one step further on. Every one of the 135 approved
OD customers in `dbo.CustomerMaster` carries a real division, the most recent created
21 September — all of them pre-fix. **No approved OD customer without a division has
existed yet.** So no downstream screen has been shown one, and every module that
filters customers by division — vehicle approval, bulk mapping and de-mapping,
reports, credit — is unexercised against this change. If any of them scopes by
division the way View Onboarding used to, a post-fix OD customer could disappear from
it, and nothing on screen would say so.

That is the real risk, and it needs an approved post-fix OD customer to test.

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

### Does the fix work? — mostly yes

| What the change asked for | Verdict |
|---|---|
| Division not offered during OD enrolment | **works** — hidden on a clean form, across all 15 business states |
| No pin code judged against a division | **works** — another state and another region both accepted; an unresolvable pin code still refused |
| An OD application carries the dummy division for its state | **works** — 54 for HR_HP_PB, 57 for UP_UK |
| OD still reviewable and approvable | **works** — 1000514956 is Active |
| Division level stops applying to OD visibility | **works** — a division admin is no longer excluded by division |
| Region and state still apply to OD visibility | **FAILS on View Onboarding** — FP-OD-1, demonstrated 6 officers / 2 regions |

### Are other customer types hampered? — one issue

| Check | Verdict |
|---|---|
| Division still visible, enabled and required for Fleet / Non Fleet / Corporate | **pass** |
| Division returns when the type is switched back from OD | **pass** |
| Non-OD applications still scoped by region, state **and** division | **pass** — zero out of scope, for both officers tested |
| All Fleet customers still carry a division | **pass** — 104,740 of 104,740 |
| Dependent dropdowns reload when their parent changes | **FAILS** — FP-OD-3, and it reaches the Fleet path |

### One result that is not stable

OD-21 raises an application by choosing Fleet and a division first, then switching to
OD. It failed twice with the submit refused — inline "Select Customer Sub Type" beside
a sub-type reading "Aggregator" — and passed on the third run, after a guard was added
that re-picks the sub-type when a cascade reload blanks it. So the **submit blockage
under Fleet → OD is intermittent**, depending on whether the reload lands before or
after the selection.

The underlying fault is not intermittent. OD-05 and OD-05b fail every run: the
division list never reloads when the business state changes, under OD or under Fleet.
Both symptoms are the same cause, and FP-OD-3 rests on the deterministic one.

### Defects

| Ticket | Priority | Defect |
|---|---|---|
| FP-OD-1 | **P1** | The removal took region and state with it: an OD application is visible to officers with no claim to its region or state. Non-OD rows on the same screen respect all three levels. Predates the change; may be intended — needs a BA ruling |
| FP-OD-2 | ~~P1~~ | **Withdrawn.** Division 0 is the fix working. Two leftovers: 15 unused `OD Default` placeholder divisions, and nothing downstream tested against a division-less OD customer |
| FP-OD-3 | **P1** | Changing the customer type or business state does not reload the dependent dropdown. Fleet's sub-type survives into OD and blocks submit with "Select Customer Sub Type" beside a filled dropdown. Also lets a Fleet application carry a division from another state |
| FP-OD-4 | P3 | The hidden division keeps its value under OD (`17`). Does not reach the database |
| FP-OD-5 | P2 | A duplicate PAN is reported as "validate the PAN before submission" |

### The two-region demonstration

Two OD applications, same maker, differing only in business state — Ahmedabad (GJ_I,
region 4, dummy division 61) and Kolkata (WB_NE, region 1, dummy division 53) — read by
the six officers who cover those two hierarchies. Each application is the other's
control, so nothing rests on how a different customer type is treated.

| Officer | Scope | Own region's OD | Other region's OD |
|---|---|---|---|
| Ahmedabad Region Admin | region 4, West | visible | **visible** |
| Ahmedabad State Admin | region 4, state 11 | visible | **visible** |
| Ahmedabad I Division Admin | region 4, state 11, division 1 | visible | **visible** |
| Kolkata Region Admin | region 1, East | visible | **visible** |
| Kolkata State Admin | region 1, state 3 | visible | **visible** |
| Kolkata Division Admin | region 1, state 3, division 26 | visible | **visible** |

Six officers, three scope levels, two regions, no variation at all. The division admins
correctly see their own region's OD application despite it carrying the state's dummy
division rather than theirs — the division level has stopped restricting, as asked. What
has also stopped is region and state.

Reproduction: `od-hierarchy-two-regions.spec.ts`, 6 of 6 failing symmetrically.

### The hierarchy question, answered

Asked: can a state admin, division admin or territory admin see a created OD customer?

**Yes — and so can officers in other regions and states.** Which is two findings in
one: the division level correctly stops excluding anyone, and the region and state
levels stop excluding anyone too, which was not asked for.

Measured on View Onboarding (`/Customer/CustomerOnboardingStatus`), the officers'
screen; the Add Customer list shows them nothing at all, and Review Onboarding is
refused to region, state and division admins since they are not reviewers.

| Officer | Scope | Sees the OD application raised in GJ_I? | Sees non-OD outside scope? |
|---|---|---|---|
| Region admin `9072986100` | region 4 | yes | — |
| State admin `9073068501` | region 4, state 11 | yes | — |
| Division admin `9073139002` | region 4, state 11, division 1 | yes | **no** — correctly scoped |
| Territory admin `9612200200` | region 2, state 4, division 17 | **yes** — another region entirely | **no** — correctly scoped |

Both officers see only their own division's Fleet applications, and OD applications
from across the country. Measured with the division ignored for OD, the territory
admin still sees 5 of 8 OD applications outside its region or state, and the division
admin 7 of 10 — while neither sees a single non-OD application outside scope.

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
