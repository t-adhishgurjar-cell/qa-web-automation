# OD module — defects found testing the enrolment change

Measured 22 September 2026 against `webqa.fleetforc.com`, FLEETPLUS Web Release 1.1.0.
Every ticket below is reproduced by a named test in this repo.

Change request under test: *"During enrolment of OD user type, Division along with
Pin code restriction basis division to be removed."* — the client's intent being to
remove the **division** level of the hierarchy from OD, leaving other customer types
untouched.

So there are two questions, and they are answered separately below.

**1. Does the fix work?** Largely yes. Division is not offered for an OD enrolment,
no pin code is judged against a division, an OD application is stored with no
division (`CustomerDivisionId = 0`) by design, and review routing does not need one —
reference 1000514956 carries division 0 and has reached status 105, Pending for
Approval. One thing went further than the request: see FP-OD-1.

**2. Are other customer types hampered?** Fleet, Non Fleet and Corporate all still
show the division as visible, enabled and required; it returns correctly when the
type is switched back from OD; non-OD applications are still scoped by all three
hierarchy levels; and all 104,740 Fleet customers still carry a division. The
exception is FP-OD-3, which does reach the Fleet path.

---

## FP-OD-1 — P1 — The division level was removed from OD, and region and state went with it

**Type:** Bug **Priority:** P1 — needs a ruling, see Notes **Component:** Customer Management / OD

### Summary
The change asked for the **division** level of the hierarchy to stop applying to OD.
It no longer does, correctly. But region and state have stopped applying as well, and
they were not part of the request — so an OD application is now visible to officers
who have no claim to the region or the state it was raised in.

This is measured with the division deliberately ignored for OD. The rows below are
outside the officer's **region or state**, not merely outside their division. Non-OD
applications on the same screen, for the same officers, still respect all three
levels, which is what rules out "the screen is simply unscoped".

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
failure is specifically about region and state. The non-OD control is asserted first,
before any claim about OD.

### Notes
Two things to weigh before fixing:

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

**Status:** Withdrawn. Not a defect.

This was filed on a misreading of the change request. A submitted OD application is
stored with `CustomerDivisionId = 0`, and with the client's intent being to remove
the division level from OD, that is the fix working rather than failing.

Two checks that would have caught the misreading, both now done and both reassuring:

- **Review routing does not need a division.** Reference 1000514956 carries
  `CustomerDivisionId = 0` and has reached status 105, Pending for Approval. The
  concern that a division-less application would sit unreviewable is answered by the
  product itself.
- **Other customer types still carry divisions.** All 104,740 Fleet customers and all
  135 existing OD customers in `dbo.CustomerMaster` have one; the OD figures are all
  pre-fix, the latest created 21 September.

`tests/customer-management/od-enrolment-submit.spec.ts` OD-20 still asserts the old
expectation and therefore still fails. **It needs rewriting to assert division 0 is
stored**, which is the real acceptance criterion — tracked below under "Still to do".

### Two things left over from it, neither a defect

- **Fifteen unused placeholder divisions.** `dbo.DivisionMaster` gained rows
  `OD Default - <business state>` (`DivisionId` 51–65, `IsPlaceholder = 1`) at
  2026-09-22 16:11:52, one per business state. Nothing writes or reads them: no
  application, no customer, no `TSMDivisionMapping` row, no `UserLocationMapping`
  row. If the implementation settled on storing 0 instead, these are dead rows and
  worth removing before they confuse someone; if they are meant to be used, the code
  does not use them. A question for dev either way.
- **No post-fix OD customer has been approved yet.** Every one of the 135 approved OD
  customers carries a real division, all created on or before 21 September. So no
  downstream screen has yet been shown an OD customer with no division, and anything
  that filters customers by division — vehicle approval, bulk mapping, reports,
  credit — has not been exercised against one. That is the untested risk this change
  actually carries, and it is the next thing to test.

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
- **Approve a post-fix OD customer** and check the screens that read
  `CustomerDivisionId`: Approved Customers, vehicle approval, bulk mapping and
  de-mapping, reports. Nothing downstream has yet seen an OD customer without a
  division.
- **The Leads path.** `/Lead/LeadList` → Add Leads carries `#llAddPinCode` and no
  division field, and `LeadMaster.DivisionId` is still derived from the pin code —
  lead 47 has pin code 160019, Chandigarh, and DivisionId 17, Gurgaon. If the division
  is to stop applying to OD, that derivation is a second place it still happens, and
  it is untested.
