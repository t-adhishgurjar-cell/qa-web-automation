# OD module — defects found testing the enrolment change

Measured 22 September 2026 against `webqa.fleetforc.com`, FLEETPLUS Web Release 1.1.0.
Every ticket below is reproduced by a named test in this repo.

Change request under test: *"During enrolment of OD user type, Division along with
Pin code restriction basis division to be removed."*

**The change itself works.** Division is not offered for OD, other customer types keep
it, and no pin code is judged against a division any more (10 of 17 tests pass on
that). What follows is what testing around it turned up.

---

## FP-OD-1 — P0 — An OD application is visible to every officer in the country

**Type:** Bug **Priority:** P0 — Blocker **Component:** Customer Management / OD

### Summary
OD applications ignore officer hierarchy scoping. Every region admin, state admin,
division admin and territory admin sees every OD application on View Onboarding,
regardless of the region, state or division it was raised in. Non-OD applications on
the same screen, for the same officers, are correctly scoped — which is what makes
this specific to OD rather than a screen with no scoping at all.

### Steps to reproduce
1. Sign in as territory admin `9612200200` — mapped to region 2, business state 4
   (HR_HP_PB), division 17 (Gurgaon).
2. Open **Customer Management → View Onboarding** (`/Customer/CustomerOnboardingStatus`).
3. Read the reference numbers listed, and look each one up in
   `dbo.RawCustomerMaster` joined to `dbo.BusinessStateMaster`.

### Expected
Only applications in region 2 / state 4 / division 17.

### Actual
Both officers tested see OD applications from across the country, while every
non-OD application they see is inside their own scope.

Territory admin `9612200200` (region 2, state 4, division 17):

| Reference | Type | Region | State | Division | In scope? |
|---|---|---|---|---|---|
| 1000514867 | Fleet | 2 | 4 | 17 | yes — control |
| 1000514858 | Fleet | 2 | 4 | 17 | yes — control |
| 1000514939 | OD | 4 | 11 | 0 | **no** |
| 1000514873 | OD | 2 | 7 | 15 | **no** |
| 1000514846 | OD | 1 | 3 | 26 | **no** |
| 1000514849 | OD | 2 | 7 | 34 | **no** |

Division admin `9073139002` (region 4, state 11, division 1) sees the same OD rows
plus `1000514845` (region 4, state 12, division 5) and `1000514848` (division 2),
while the only non-OD row it sees, `1000514729`, is its own division 1.

### Evidence
`tests/customer-management/od-hierarchy-visibility.spec.ts` — both cases fail on the
OD assertion and pass the non-OD control assertion that precedes it.

### Notes
Not introduced by this change request. The leaked OD applications include ones raised
on 16 and 21 September with real divisions, so the leak is keyed on customer type,
not on the `CustomerDivisionId = 0` that this change produces (FP-OD-2). It is raised
at P0 because the OD module is what is under test and this is a cross-region data
exposure that the equivalent Fleet path does not have.

---

## FP-OD-2 — P1 — A submitted OD application is stored with no division at all

**Type:** Bug **Priority:** P1 **Component:** Customer Management / OD

### Summary
`dbo.DivisionMaster` gained fifteen rows named `OD Default - <business state>`
(`DivisionId` 51–65, `DMId` `ODDEF-1`…`ODDEF-15`, `IsPlaceholder = 1`), created
2026-09-22 16:11:52 — evidently so that an OD enrolment has a division to carry now
that the maker is not asked for one. Nothing uses them. OD applications are stored
with `CustomerDivisionId = 0`, which matches no row in `DivisionMaster`.

### Steps to reproduce
1. Sign in as DSA `9611200199` (Gurgaon, HR_HP_PB).
2. Customer Management → Add Customer → Add Customer.
3. Customer type **OD**, sub-type `OD (Owner Driver)`, business state `HR_HP_PB`.
4. Fill the address, customer, PAN and mobile-OTP fields; Save As Draft; Submit.
5. `SELECT CustomerDivisionId FROM dbo.RawCustomerMaster WHERE ReferenceNo = <ref>`.

### Expected
`DivisionId 54`, `OD Default - HR_HP_PB` — the placeholder for that business state.

### Actual
`CustomerDivisionId = 0`. Reproduced on references 1000514927, 1000514928,
1000514929, 1000514930 and 1000514939. The region and state are stored correctly.

### Why it matters
No TSM is mapped to any placeholder division (`dbo.TSMDivisionMapping` has no row
for one) and no officer's `UserLocationMapping` points at one — so even if the
placeholder were written, review routing would need attention. With division 0 there
is nothing to route on at all. Division has always decided which TSM reviews an
application.

### Evidence
`tests/customer-management/od-enrolment-submit.spec.ts` — OD-20.

---

## FP-OD-3 — P1 — Changing the customer type does not reload its dependent dropdowns

**Type:** Bug **Priority:** P1 **Component:** Customer Management / Add Customer

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

## FP-OD-4 — P2 — The hidden division keeps its value under OD

**Type:** Bug **Priority:** P2 **Component:** Customer Management / OD

### Summary
`#CustDivisionID` is hidden for OD rather than cleared. Choose Fleet, pick a
division, switch to OD: the control is hidden and disabled but still holds that
division (`value="17"`, Gurgaon).

### Steps, expected, actual
As FP-OD-3 steps 1–3, then read `#CustDivisionID`. Expected `0`; actual `17`.

The value does not reach the database — the application is stored with division 0
(FP-OD-2) — so this is untidiness rather than data corruption today. It is worth
fixing because it is one serialisation change away from silently enrolling an OD
customer into a division nobody on the form could see.

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
