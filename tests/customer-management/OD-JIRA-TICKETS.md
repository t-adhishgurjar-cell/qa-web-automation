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

**Type:** Bug **Priority:** P1 **Component:** Customer Management / OD
**This is the one functional defect of the set.** With the dummy divisions confirmed as storage
only, visibility special-cases OD by customer type — and that exemption drops region and state
along with the division. The fix belongs there, in the visibility rule, not in the data.
**Reproduction:** `tests/customer-management/od-hierarchy-two-regions.spec.ts` — 6 of 6
officers fail, symmetrically

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
1. As a DSA, raise one OD application with business state **GJ_I** and another with
   **WB_NE**. Confirm each stored against its state's dummy division — 61 and 53.
2. Sign in as the Ahmedabad Region Admin `9072986100` (region 4, West).
3. Open **Customer Management → View Onboarding** (`/Customer/CustomerOnboardingStatus`).
4. Both references are listed. The WB_NE one is in region 1, East.
5. Repeat for the other five officers in the table below.

### Expected
An officer sees the OD applications in their own region and state, whatever division
those carry. That is the change as requested: the division stops mattering, the region
and state do not.

### Actual
Every officer sees every OD application, including those from another region and zone.
See the table below.

### Evidence
`tests/customer-management/od-hierarchy-visibility.spec.ts`. Its scope predicate
ignores the division for OD and applies all three levels to everything else, so the
failure is specifically about region and state.

### The demonstration — two OD applications, two regions, six officers

Two OD applications were raised by the same DSA, differing only in business state, and
each was confirmed stored against the dummy division for its state before any
visibility was judged:

| Reference | Place | Business state | Region | Division stored |
|---|---|---|---|---|
| 1000514990 | Ahmedabad | 11 (GJ_I) | 4 — West | 61, `OD Default - GJ_I` |
| 1000514991 | Kolkata | 3 (WB_NE) | 1 — East | 53, `OD Default - WB_NE` |

Each officer should see the application from their own region and not the other's. The
second half is the control, and it needs no third customer type: the two applications
are each other's control, and the same officer is measured on both in the same run.

| Officer | Scope | Own region's OD | Other region's OD |
|---|---|---|---|
| Ahmedabad Region Admin `9072986100` | region 4 (West) | visible | **visible** — should not be |
| Ahmedabad State Admin `9073068501` | region 4, state 11 | visible | **visible** — should not be |
| Ahmedabad I Division Admin `9073139002` | region 4, state 11, division 1 | visible | **visible** — should not be |
| Ahmedabad II Division Admin `9063600900` | region 4, state 11, division 2 | visible | **visible** — should not be |
| Kolkata Region Admin `9073209903` | region 1 (East) | visible | **visible** — should not be |
| Kolkata State Admin `9073275904` | region 1, state 3 | visible | **visible** — should not be |
| Kolkata Division Admin `9073340105` | region 1, state 3, division 26 | visible | **visible** — should not be |

**Every officer sees both.** Seven officers, three scope levels, two regions, and not one
variation between them — which is what "no location filter is applied to OD" looks like.
Note also that the division admins do correctly see their own region's OD application
even though it carries the state's dummy division rather than their own: the division
level has stopped restricting OD, exactly as asked. The two Ahmedabad admins make that
precise — division 1 and division 2, same state and zone, and the application's dummy is
61, neither of theirs. Both see it.

The dummy division makes the remaining fix cheap. Each dummy belongs to one business
state — 61 is GJ_I, 53 is WB_NE — so filtering on it gives precisely the intended
behaviour: the division stops restricting, the state still does.

### What the same screen does with other customer types
Measured on an earlier run, before this suite's OD applications filled the grid's ten
rows: the Gurgaon territory admin's non-OD rows were Fleet 1000514867 and 1000514858,
both in its own state 4 and division 17; the Ahmedabad division admin's was Fleet
1000514729, its own state 11 and division 1. None outside scope. So the screen does
filter other customer types and OD is escaping that filter — though note this control
comes from a different run than the table above, because View Onboarding lists only its
ten most recent applications.

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

## FP-OD-6 — WITHDRAWN — "An OD application cannot be reviewed"

**Status:** Withdrawn. Not a defect. My automation, and I filed it too early.

Filed because "Reviewed" appeared inert: with both acknowledgements ticked and remarks
filled, the click sent no request, opened no dialog and left the application at 102.

It does work. The control is gated on the uploaded documents having been **previewed**
first — open the PAN and bank previews and the same click raises the YES/NO
confirmation, `SubmitReviewerDecision` returns `{"success":true}`, and the application
moves 102 to 105. Proven on references 1000514991 (WB_NE) and 1000514992 (GJ_I).

Two smaller mistakes of mine were folded into that conclusion, both now fixed in
`ReviewCustomerPage`:

- `inlineErrors()` reported the form's required-field asterisks as complaints, so the
  outcome read "the page refused without a dialog: text-danger: *" — a message about a
  refusal that never happened. Bare asterisks are now filtered.
- The confirmation is answered by a control whose text is "YES" with surrounding
  whitespace, and on the checker screen "Yes, approve". Matchers anchored as `/^yes$/`
  miss both. `previewDocuments()` was added and the matching made whitespace-tolerant.

**What is a fair criticism of the application**, and is why this took a day: the gate is
completely silent. No disabled control, no tooltip, no validation message, nothing in
the DOM to distinguish "you have not opened the documents yet" from "this button is
broken". The checker screen has the same pattern with its two Verify buttons, which is
already documented in `ApproveCustomerPage`. Worth raising as a usability point rather
than a defect: a reviewer who has not opened the documents should be told so.

### Still unstable, and not yet a finding
The review and approval stages do not pass reliably through these page objects. Measured
today: 1000514991 (WB_NE) completed to 101; 1000514992 and 1000514990 (both GJ_I) reach
105 and then accept the approval confirmation without submitting anything; 1000514979
(HR_HP_PB) would not advance past 102 on an attempt that had worked minutes earlier for
another reference.

Two of two GJ_I applications failing to approve looked state-specific and was nearly
written up as such. It is not being filed, because a third case then failed at a
different stage in a different state — which points at my own automation being flaky
rather than at the product, and a defect report built on that would send someone
chasing the wrong thing. Isolating it needs the approval decision watched at the
network level across several states, which is a piece of work in its own right.


---

## FP-OD-7 — P3 — OD self-enrolment stores a real division instead of the dummy

**Type:** Bug **Priority:** P3 — data consistency; no visibility impact, see Resolved below
**Component:** Customer Management / OD self-enrolment

### Summary
The requirement covers both enrolment paths. Only Add Customer implements it.

The public self-enrolment form at `/Home/PersonalSelfEnrolment` shows no division control —
so it looks compliant — but it carries a **hidden `#odDivision`**, and that field is still
populated from the pin code. The customer is therefore given a real division decided by its
address, which is both halves of what the change removes: the division, and the pin-code
restriction based on it.

### Steps to reproduce
1. Open `/Home/PersonalSelfEnrolment`. No sign-in is needed; the form is public.
2. Enter a pin code in the **Pin Code** field and tab out.
3. Read the hidden input `#odDivision`.

### Expected
Either empty, or the `OD Default - <state>` dummy for the resolved state — the same answer
Add Customer gives.

### Actual
A real division, derived from the pin code:

| Pin code | Resolves to | `#odDivision` becomes |
|---|---|---|
| 380001 | AHMEDABAD, GUJARAT | **Ahmedabad II** — real division 2 |
| 201304 | GAUTAM BUDDHA NAGAR, UTTAR PRADESH | **Noida** — real division 34 |

And it reaches the database. The one OD customer raised this way is live:
**NAYAFP3023400262**, business state 7, `CustomerDivisionId` **34, Noida,
`IsPlaceholder = 0`** — raised 23 September at 12:32 by `7000000187`, a user whose own type
is OD with no location mapping, which is what a customer enrolling itself looks like.

Two minutes later, an Add Customer OD application in the same business state took dummy 57.
Same state, same build, minutes apart, two different answers.

### The split, counted
Every OD application raised since the dummy assignment went live at 11:08 on 23 September:

| Path | Applications | Division stored |
|---|---|---|
| via Add Customer | **15 of 15** | dummy `OD Default - <state>` |
| self-onboarded | **1 of 1** | **real division** |

### Why it matters
A real division means the division hierarchy still applies to that customer. Pin code 380001
yields Ahmedabad II — division 2 — so the Ahmedabad II division admin would see such a
customer and the Ahmedabad I admin would not. That is exactly the restriction the change
removes for Add Customer OD, still in force for self-enrolled OD.

It is also the more exposed path of the two: the form is public and unauthenticated, and OD
is Owner Driver — the segment most likely to enrol itself rather than be entered by a DSA.

### Resolved: the dummy divisions are storage only, and this has no visibility impact
Confirmed by dev, then measured. Visibility decides from the customer's **type**, not from
whether its division is a placeholder — so a real division on an OD customer does not restrict
who can see it.

The measurement, on two OD customers that predate the change and carry real divisions in the
same business state:

| Customer | State | Division stored | Ahmedabad I admin (div 1) | Ahmedabad II admin (div 2) |
|---|---|---|---|---|
| NAYAFP3040500001 | 11 | 1, Ahmedabad I, real | visible | **visible** |
| NAYAFP3043400009 | 11 | 2, Ahmedabad II, real | **visible** | visible |

Each admin sees the other division's OD customer, so the division is not consulted for OD
whatever it holds.

That drops this ticket to P3. What remains is a consistency defect rather than a functional
one: one enrolment path follows the storage convention and the other does not, so anything
that later keys off `IsPlaceholder` — a report, a migration, a future scoping rule — will
treat self-enrolled OD customers differently from the rest without anyone intending it. The
pin-code derivation behind it is also still live on that path, which is the half of the change
request that was about the pin code.

**And the good news this rules out:** the 135 OD customers created before the change, every one
on a real division, need no backfill. They already behave as the change intends.

`tools/probe-od-legacy-division-visibility.spec.ts` is the measurement, and is worth keeping as
a regression check — it would catch a later fix that made visibility depend on the placeholder
after all, which would strand those 135 silently.

### Evidence
`tools/probe-self-enrolment-division.spec.ts` reads the hidden field as the pin code changes,
without submitting anything. `tools/probe-od-self-vs-addcustomer.spec.ts` counts the split by
maker type.

### Note on the third pin code
`700001` resolved to nothing at all — blank state, city and division — so it is not in the pin
code data this form consults. Unrelated to this ticket, but it means a Kolkata self-enrolment
cannot complete the address step with that pin code.

---

## Still to do

- **Rewrite OD-20** to assert `CustomerDivisionId = 0` — the real acceptance criterion
  for this change. It currently asserts the placeholder division and fails for that
  reason, not because the application is wrong.
- **FP-OD-6 first** — until "Reviewed" works, no OD customer can be created, and every
  downstream check below is blocked behind it.
- **Test the view-documents hypothesis** for FP-OD-6.
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
