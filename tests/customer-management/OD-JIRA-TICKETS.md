# OD module — defects found testing the enrolment change

Measured 22 September 2026 against `webqa.fleetforc.com`, FLEETPLUS Web Release 1.1.0.
Every ticket below is reproduced by a named test in this repo.

Change request under test: *"During enrolment of OD user type, Division along with
Pin code restriction basis division to be removed."* — the client's intent being to
remove the **division** level of the hierarchy from OD, leaving other customer types
untouched.

So there are two questions, and they are answered separately below.

**How the change is built.** Dev's mechanism is a dummy division per active business
state: fifteen `OD Default - <state>` rows in `dbo.DivisionMaster` (`DivisionId` 51–65,
`IsPlaceholder = 1`), one for each of the fifteen active states, assigned to an OD
enrolment according to the business state chosen on the form. The division stops being
a restriction without becoming null.

**A deploy window that invalidates earlier measurements.** The dummy rows were created
2026-09-22 16:11. The code that assigns them went live between **09:53 and 11:08 on
2026-09-23**. Every OD application raised before that window carries
`CustomerDivisionId = 0`; every one after carries its state's dummy. Measurements
taken on 22 September and early on 23 September therefore describe a half-deployed
build, and two findings below were written from them.

**1. Does the fix work?** Yes, on the current build. Division is not offered for an OD
enrolment, no pin code is judged against a division, and an OD application is stored
against the dummy division for its state — verified for HR_HP_PB (54) and UP_UK (57),
including when a real division had been chosen under Fleet first, which is correctly
discarded. Review routing works: 1000514956 has reached 101, Active. One question
remains open: see FP-OD-1.

**2. Are other customer types hampered?** Fleet, Non Fleet and Corporate all still
show the division as visible, enabled and required; it returns correctly when the
type is switched back from OD; non-OD applications are still scoped by all three
hierarchy levels; and all 104,740 Fleet customers still carry a division. The
exception is FP-OD-3, which does reach the Fleet path.

---

## FP-OD-1 — P1 — On View Onboarding, OD applications are not filtered by the officer's location

**Type:** Bug **Priority:** P1 **Confidence:** needs one more measurement — see Control
**Component:** Customer Management / OD

### Summary
On View Onboarding (`/Customer/CustomerOnboardingStatus`), OD applications appear
regardless of the viewing officer's region, state or division. Non-OD applications on
the same screen are filtered.

The division part is correct and is what the change asked for. The region and state
part is not: they were never part of the request, and an OD application is visible to
officers with no claim to either. Reproduced on the current build, with dummy
divisions correctly assigned — the territory admin for HR_HP_PB sees applications
carrying dummy division 57, `OD Default - UP_UK`, which belongs to a different state.
That dummy would have been enough to filter on.

### Steps to reproduce
1. Sign in as territory admin `9612200200` — mapped to region 2, business state 4
   (HR_HP_PB), division 17 (Gurgaon).
2. Open **Customer Management → View Onboarding** (`/Customer/CustomerOnboardingStatus`).
3. Read the reference numbers listed, and look each one up in
   `dbo.RawCustomerMaster` joined to `dbo.BusinessStateMaster`.

### Expected
OD applications in region 2, state 4 — any division, including none. That is the
change as requested: the division stops mattering, the region and state do not.

### Actual
Territory admin `9612200200`, scoped to region 2 / state 4 / division 17, sees 8 OD
applications of which **5 are outside its region or state**:

| Reference | Type | Region | State | Division | Verdict |
|---|---|---|---|---|---|
| 1000514867 | Fleet | 2 | 4 | 17 | in scope — control |
| 1000514858 | Fleet | 2 | 4 | 17 | in scope — control |
| 1000514849 | OD | 2 | **7** | 34 | wrong state |
| 1000514873 | OD | 2 | **7** | 15 | wrong state |
| 1000514956 | OD | 2 | **7** | 0 | wrong state |
| 1000514871 | OD | **4** | **11** | 1 | wrong region and state |
| 1000514939 | OD | **4** | **11** | 0 | wrong region and state |

Division admin `9073139002`, scoped to region 4 / state 11 / division 1, sees 10 OD
applications of which **7 are outside its region or state** — including references in
regions 1 and 2 and states 3, 4 and 7. Its only non-OD row, 1000514729, is its own
division 1.

In both cases the count of non-OD applications outside scope is **zero**.

### Evidence
`tests/customer-management/od-hierarchy-visibility.spec.ts`. Its scope predicate
ignores the division for OD and applies all three levels to everything else, so the
failure is specifically about region and state.

### Control — why this is not yet marked confirmed
The claim needs non-OD applications on the same screen, proving the screen filters
anybody at all. On the first measurement it had them, and they were all inside the
officer's own division:

  territory admin  Fleet 1000514867, 1000514858 — both state 4, division 17
  division admin   Fleet 1000514729 — state 11, division 1

It no longer has them. View Onboarding lists only its ten most recent applications —
pagination does not advance it and its date filter is a datepicker that ignores a
programmatic fill — and this suite's own OD applications now occupy all ten. So the
test currently stops at "the control is empty" rather than reporting the leak, which
is the correct behaviour and is why the finding is not marked confirmed.

To close this: raise one Fleet application from the same DSA, which lands in division
17 / state 4 and will be among the ten most recent. It should then be visible to the
territory admin and **not** to the Ahmedabad division admin. That single row restores a
deterministic control, in both directions, and settles the ticket either way.

A contrast worth recording, measured on Approved Customers
(`/Customer/ManageCustomers`) where the control cannot run dry — 104,740 Fleet
customers against 135 OD: **no OD customer leaks there.** For the Ahmedabad division
admin, 2 OD customers were listed and both were within region and state. So whatever
exempts OD appears specific to the in-flight applications screen, not to customers in
general.

### Notes
Three things to weigh before fixing:

- **The dummy division makes the fix available.** Because each dummy belongs to one
  business state, filtering on it would give exactly the intended behaviour: the
  division stops restricting, the state still does. The data to do it is already
  there and unused by this screen.


- **It predates the change.** The leaked set includes OD applications raised on 16 and
  21 September carrying real divisions, so the behaviour keys on customer type rather
  than on the `CustomerDivisionId = 0` this change produces. It was not introduced
  here; it was uncovered by testing here.
- **It may be intended.** If "no mapping restrictions for OD" was meant to mean the
  whole location hierarchy and not just the division level, this is correct behaviour
  and the ticket should be closed as such. That is a question for the BA, not for QA
  to decide — which is why this is filed at P1 with the evidence rather than as a
  blocker. What it is *not* is a match for the change request as written.

---

## FP-OD-2 — WITHDRAWN — "A submitted OD application is stored with no division"

**Status:** Withdrawn. Not a defect. The environment was mid-deploy when it was filed.

Filed after every OD application raised on 22 September and early on 23 September was
stored with `CustomerDivisionId = 0`, while fifteen `OD Default - <state>` rows sat
unused in `dbo.DivisionMaster`. That looked like dev's mechanism having been created
but never wired in.

It was wired in later. Re-measured at 12:36 on 23 September, the same maker
(`9611200199`) and the same business state (HR_HP_PB) that had produced 0 at 09:53
produced **54, `OD Default - HR_HP_PB`, `IsPlaceholder = 1`**. UP_UK produces 57. So
the assignment code went live between 09:53 and 11:08 that morning, and the zeros are
artefacts of a half-deployed build rather than a defect.

This was withdrawn once before for the wrong reason — on a reading that "remove the
division from OD" meant leave it null — and OD-20 was rewritten to assert 0, which
passed. Both the original ticket and that withdrawal were wrong. The requirement is
the dummy division, and OD-20 now asserts it, naming the deploy window in its failure
message so the next person does not read one zero as the feature being broken.

### What is now verified

- An OD application carries the dummy division for the business state chosen on the
  form: 54 for HR_HP_PB, 57 for UP_UK.
- A division chosen under Fleet before switching to OD is discarded: reference
  1000514982 was raised after selecting Gurgaon (17) and stored 54.
- A dummy division exists and is active for all fifteen active business states.
- Review and approval work without a real division: 1000514956 is at 101, Active, as
  customer NAYAFP3023400261 with division 57.

### One leftover, not a defect

No database code references `IsPlaceholder` or the `OD Default` rows — the assignment
is in application code, so there is nothing in SQL to read when tracing this. Worth
knowing for the next person who goes looking for it, as I did.

## FP-OD-3 — P1 — Changing the customer type does not reload its dependent dropdowns

**Type:** Bug **Priority:** P1 **Component:** Customer Management / Add Customer

**This is the one finding that reaches other customer types**, and so belongs to the
second half of the brief rather than the first. Whether it predates the change is not
established — the cascade is not OD-specific and there is no earlier build to compare
against.

### Summary
Customer sub-type and division are children of the customer type and the business
state, and neither list reloads when its parent changes. An application built by
choosing Fleet first and switching to OD keeps Fleet's sub-type — an invalid value
for OD — and is refused at submit with a message about a field that visibly holds a
value.

### Steps to reproduce
1. Add Customer as DSA `9611200199`.
2. Customer type **Fleet**; sub-type **Aggregator**.
3. Change customer type to **OD**.
4. Read the sub-type dropdown.
5. Fill the rest of the OD form and Submit.

### Expected
On step 3 the sub-type list reloads to OD's own (`5016: OD (Owner Driver)`) and the
invalid Fleet selection is cleared.

### Actual
The list still offers Fleet's five sub-types and `5000 Aggregator` is still selected.
Submit is refused with the inline message **"Select Customer Sub Type"** next to a
dropdown reading "Aggregator". Measured:

```
Fleet, fresh form     0:--Select Sub Type-- | 5000:Aggregator | 5004:... | 5003:... | 5002:...
OD, fresh form        0:--Select Sub Type-- | 5016:OD (Owner Driver)
after Fleet -> OD     0:--Select Sub Type-- | 5000:Aggregator | 5004:... | 5003:... | 5002:...  (5000 selected)
```

The same fault affects the division list against the business state: with the state
changed from HR_HP_PB to AP_TG, the division list still offers Gurgaon, Ludhiana,
Solan and `OD Default - HR_HP_PB`. Under Fleet that lets a maker submit an
application whose division belongs to a different state than the one on the form.

### Evidence
`tests/customer-management/od-enrolment.spec.ts` — OD-05 and OD-05b;
`tests/customer-management/od-enrolment-submit.spec.ts` — OD-21.
`tools/probe-od-subtype-cascade.spec.ts` prints the three lists above.

---

## FP-OD-4 — P3 — The hidden division keeps its value under OD

**Type:** Bug **Priority:** P3 — cosmetic, given the division is now ignored for OD
**Component:** Customer Management / OD

### Summary
`#CustDivisionID` is hidden for OD rather than cleared. Choose Fleet, pick a
division, switch to OD: the control is hidden and disabled but still holds that
division (`value="17"`, Gurgaon).

### Steps, expected, actual
As FP-OD-3 steps 1–3, then read `#CustDivisionID`. Expected `0`; actual `17`.

The value does not reach the database: the application is stored with division 0,
which is the intended outcome. So this is untidiness rather than data corruption, and
it drops to P3 under the corrected reading of the change. Still worth clearing — a
hidden control holding a live value is one serialisation change away from putting a
division back on an OD customer that nobody on the form chose.

### Evidence
`tests/customer-management/od-enrolment.spec.ts` — OD-03.

---

## FP-OD-5 — P2 — "Validate the PAN" is shown when the real problem is a duplicate PAN

**Type:** Bug **Priority:** P2 **Component:** Customer Management / Add Customer

### Summary
Submitting with a PAN already held by another customer is refused with
**"Please validate the PAN number before submission. Tab out of the PAN field after
entering it, fix any errors shown, then try again."** The PAN *has* been tabbed out;
`/Customer/ValidatePanNumber` answered `{"status":1,"isValid":0}` and the field
showed "PAN already exists". The modal describes a user error that did not happen and
does not mention the duplicate.

### Steps to reproduce
1. Add Customer, customer type OD.
2. Enter PAN `ABCPA1234F` (already held in QA) and tab out — the inline error reads
   "PAN already exists".
3. Complete the form and Submit.

### Expected
A message naming the duplicate PAN.

### Actual
The "validate the PAN before submission" modal, which sends the user back to a field
they have already completed correctly.

### Evidence
`tools/probe-od-pan.spec.ts` prints the API responses for a taken and a free PAN.

---

## Also observed, not filed

- **Eighteen fields hidden for OD are still marked `data-val-required`**, including
  `CustDivisionID`, `SaveCustomerModel_BusinessName` and `CustomerBusinessType`.
  Nothing currently blocks on them, but a client-side validation pass over required
  fields would refuse the form on controls the maker cannot see.
- **OD is a single-step form** — no Address, Branch or Meeting step — while
  `#btnTab1Next`, `#btnShowOfficialDetails`, `#btnShowMeetingDetails` and `#btnAdd`
  all remain in the DOM, hidden. The visible Submit carries no id and the class
  `js-kyc-partial-save`.
- **The Add Customer list shows an admin nothing at all.** Region, state and division
  admins see zero rows on `/Customer/ManageCustomerOnboarding`; View Onboarding is
  their screen. Review Onboarding is refused to all three (correctly — they are not
  reviewers).


---

## Still to do

- **Rewrite OD-20** to assert `CustomerDivisionId = 0` — the real acceptance criterion
  for this change. It currently asserts the placeholder division and fails for that
  reason, not because the application is wrong.
- **Raise one Fleet application** to restore the deterministic control on View
  Onboarding, and settle FP-OD-1.
- **Approve a post-fix OD customer** — one carrying a dummy division — and check the
  screens that read `CustomerDivisionId`: vehicle approval, bulk mapping and
  de-mapping, reports, credit. Only one such customer exists so far
  (NAYAFP3023400261, division 57), raised by another maker.
- **Some customer records disagree with themselves** about location:
  NAYAFP2020900082 carries division 17 (Gurgaon, state 4) with `CustomerStateId` 7,
  and NAYAFP1811754902 carries division 1 (Ahmedabad I, state 11) with
  `CustomerStateId` 1. Pre-existing, unrelated to OD, and it will mislead any scope
  test that derives the region from the state rather than from the division — as mine
  briefly did.
- **The Leads path.** `/Lead/LeadList` → Add Leads carries `#llAddPinCode` and no
  division field, and `LeadMaster.DivisionId` is still derived from the pin code —
  lead 47 has pin code 160019, Chandigarh, and DivisionId 17, Gurgaon. If the division
  is to stop applying to OD, that derivation is a second place it still happens, and
  it is untested.
