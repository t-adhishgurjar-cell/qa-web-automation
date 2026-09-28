# 03 — OD enrolment and the officer hierarchy

**The change under test.** *"During enrolment of OD user type, Division along with Pin code
restriction basis division to be removed."*

Read as: remove the **division** level of the officer hierarchy from OD, leave region and state
intact, and apply it to **both** enrolment paths — Add Customer and self-enrolment.

**How it is built.** `dbo.DivisionMaster` carries one dummy division per active business state —
fifteen rows named `OD Default - <state>`, `DivisionId` 51–65, `IsPlaceholder = 1`. An OD
enrolment is assigned the one belonging to the state chosen on the form. The dummies are
**storage only**: visibility decides from the customer's *type*, not from whether the division is
a placeholder. Confirmed by dev and measured.

**Deploy note.** The dummy rows were created 22 Sep 16:11; the code that assigns them went live
between 09:53 and 11:08 on 23 Sep. Any OD application raised before that window carries
`CustomerDivisionId = 0`. Those records are artefacts of a half-deployed build — do not read one
as a defect.

---

## The enrolment form

| ID | Pri | Case | Expected |
|---|---|---|---|
| REG-OD-01 | P0 | Freshly loaded form, select OD | No division control on screen |
| REG-OD-02 | P0 | Select Fleet on a fresh form | Division visible, enabled, mandatory |
| REG-OD-03 | P0 | Same for Non Fleet, and for Corporate | Division visible, enabled, mandatory. The change must not reach other types |
| REG-OD-04 | P1 | Select OD, then switch back to Fleet | The division returns, enabled. A maker who mis-picked OD must not need to reload |
| REG-OD-05 | P2 | Select Fleet, pick a division, switch to OD | The division hides. **Known:** the hidden control keeps its value (FP-OD-4, P3) — harmless today because the stored division is the dummy, but confirm the stored value in REG-OD-12 |
| REG-OD-06 | P1 | Select OD, walk every business state | All 15 selectable; the division never reappears |

---

## The pin code

| ID | Pri | Case | Expected |
|---|---|---|---|
| REG-OD-07 | P0 | OD, address pin code in the maker's own state (`122001` for an HR maker) | Resolves; state, city, district fill; no complaint |
| REG-OD-08 | P0 | OD, pin code in a **different state** (`201304`, UP) | Accepted — this is the restriction being removed |
| REG-OD-09 | P0 | OD, pin code in a **different region** (`560001`, Karnataka) | Accepted |
| REG-OD-10 | P0 | OD, pin code that resolves to nothing (`999999`) | **Still refused.** The change removes a division rule, not pin-code validation. A build that accepts any six digits passes every case above and is worse than the restriction it replaced |

**Waiting** The lookup fires on the field's blur handler, so it starts *after* the page looks
settled. Wait for the state field to fill; do not read it immediately.

---

## What gets stored

### REG-OD-11 — An OD application carries its state's dummy division
**Priority** P0 · **Depth** measured

**Steps** Raise an OD application with business state HR_HP_PB. Submit. Read the record.

**Expected** `CustomerDivisionId = 54`, `OD Default - HR_HP_PB`, `IsPlaceholder = 1`.
Per state: GJ_I → 61, WB_NE → 53, UP_UK → 57, HR_HP_PB → 54.

**Not** the maker's own division, and not 0. If you see 0, check the created-on date against the
deploy window above before raising anything.

**Evidence** Reference, `CustomerStateId`, `CustomerDivisionId`, `DivisionName`, `IsPlaceholder`.

---

### REG-OD-12 — A division chosen under Fleet does not follow the form into OD
**Priority** P0 · **Depth** measured

**Steps** Select Fleet, choose the maker's own division explicitly, switch to OD, complete and
submit.

**Expected** Stored against the state's dummy — **not** the division chosen under Fleet. This is
the case that proves the hidden control in REG-OD-05 is harmless.

---

| ID | Pri | Case | Expected |
|---|---|---|---|
| REG-OD-13 | P1 | A dummy division exists and is active for every active business state | 15 states, 15 placeholders, one each, no duplicates |
| REG-OD-14 | P1 | An OD application can be reviewed and approved on a dummy division | Reaches 101 Active. Review routing does not need a real division |
| REG-OD-15 | P1 | The approved OD customer's user can sign in | Reaches `/CustomerDashboard/Index` |

---

## The hierarchy — the heart of this change

Screen: **View Onboarding**, `/Customer/CustomerOnboardingStatus`. That is the officers' screen.
The Add Customer list shows an admin nothing at all, and Review Onboarding is correctly refused
to region, state and division admins since they are not reviewers.

**Method.** Raise **two** OD applications differing only in business state — one in GJ_I
(region 4, West) and one in WB_NE (region 1, East) — then read the screen as each officer. The two
applications are each other's control: the same officer is measured on both in one sitting, so
"the screen shows everything to everybody" cannot be confused with "there was nothing to filter".

**Do not rely on older records.** That screen lists only its ten newest applications; pagination
does not advance and its date filter is a datepicker. Raise your own so they are the newest.

### REG-OD-16 — Set up the pair
**Priority** P0 · **Depth** measured

Raise one OD in **GJ_I** (pin `380001`) and one in **WB_NE** (pin `700001` does not resolve — use
another WB_NE pin code). Confirm before going further: GJ_I carries dummy 61, WB_NE carries 53.
If either carries something else, stop — the visibility cases below would mean something different.

---

### REG-OD-17 to REG-OD-25 — The matrix
**Priority** P0 · **Depth** measured

For each officer: open View Onboarding and record whether each of the two applications is listed.

| ID | Officer | Username | Scope | GJ_I app | WB_NE app |
|---|---|---|---|---|---|
| REG-OD-17 | Ahmedabad Region Admin | 9072986100 | region 4 | **visible** | not visible |
| REG-OD-18 | Ahmedabad State Admin | 9073068501 | region 4, state 11 | **visible** | not visible |
| REG-OD-19 | Ahmedabad I Division Admin | 9073139002 | + division 1 | **visible** | not visible |
| REG-OD-20 | Ahmedabad II Division Admin | 9063600900 | + division 2 | **visible** | not visible |
| REG-OD-21 | Ahmedabad I Territory Admin | 9111181007 | + division 1 | **visible** | not visible |
| REG-OD-22 | Ahmedabad II Territory Admin | 7486836430 | + division 2 | **visible** | not visible |
| REG-OD-23 | Kolkata Region Admin | 9073209903 | region 1 | not visible | **visible** |
| REG-OD-24 | Kolkata State Admin | 9073275904 | region 1, state 3 | not visible | **visible** |
| REG-OD-25 | Kolkata Division Admin | 9073340105 | + division 26 | not visible | **visible** |

**The four Ahmedabad division-scoped rows are the change working.** The GJ_I application carries
dummy division 61 — neither division 1 nor 2 — and all four must still see it. Divisions 1 and 2
differ in nothing but the division, so if they ever disagree, the division is still being matched.

**The "not visible" column is the requirement that region and state stay intact.**

### CURRENT RESULT — KNOWN FAIL (FP-OD-1)
**All nine officers see both applications.** Nine officers, four levels, two regions, no variation.
Measured 24 Sep against applications raised by the same session.

Confirm it still fails and record it; do not re-raise. The fix belongs in the visibility rule, not
the data: the OD exemption is correct about the division and too wide by two levels. The dummy
division carries its own state — 61 is GJ_I, 53 is WB_NE — so a rule consulting it would give the
right answer.

**Why the territory admin rows matter most.** `TERRITORY_ADMIN` has `HierarchyType = 'Division'`,
so a TSM is division-scoped — and a TSM reviews. This is the level where wrong scope stops being a
reporting curiosity and becomes work landing in the wrong queue.

---

### REG-OD-26 — Non-OD applications on the same screen are still scoped
**Priority** P0 · **Depth** measured

**Steps** Raise a **Fleet** application in GJ_I division 1. Read View Onboarding as the Ahmedabad
I division admin (division 1), then as the Ahmedabad II division admin (division 2).

**Expected** Division 1 sees it; **division 2 does not.** Same state, same zone, differing only by
division — so this isolates the division level exactly.

**Why it belongs here** It is the control for the whole matrix. If Fleet leaks too, the screen is
simply unscoped and nothing above tells you anything about OD.

---

### REG-OD-27 — Legacy OD customers remain visible across divisions
**Priority** P1 · **Depth** measured

**Pre** Two OD customers that predate the change, carrying **real** divisions in the same state:
NAYAFP3040500001 (division 1) and NAYAFP3043400009 (division 2), both GJ_I.

**Steps** On Approved Customers (`/Customer/ManageCustomers`), search each as the Ahmedabad I
admin, then as the Ahmedabad II admin.

**Expected** Each admin sees **both**. Visibility keys off the customer type, not the placeholder,
so the 135 OD customers created before the change need no migration.

**Keep this case.** It would catch a "fix" that made visibility depend on `IsPlaceholder`, which
would silently strand those 135 — invisible from the maker's side.

---

## Self-enrolment — the second path

### REG-OD-28 — KNOWN FAIL (FP-OD-7) — the change is not applied here
**Priority** P3 · **Depth** measured

**Steps**
1. Open `/Home/PersonalSelfEnrolment` — no sign-in needed.
2. Enter pin code `380001`, tab out, inspect hidden input `#odDivision`.
3. Complete a full self-enrolment and read the stored division.

**Expected** The dummy for the resolved state, matching Add Customer.

**Actual** A real division derived from the pin code: `380001` → "Ahmedabad II" (2), `201304` →
"Noida" (34). The live customer NAYAFP3023400262 carries real division 34.

Measured split since the assignment went live: **Add Customer 15 of 15 dummy; self-enrolment 1 of
1 real.**

**No visibility impact** — the dummies are storage only. It is a consistency defect: anything that
later keys off `IsPlaceholder` will treat self-enrolled OD customers differently from the rest.
The pin-code derivation behind it is the half of the change request that was about the pin code,
and it is still running.

---

| ID | Pri | Case | Expected |
|---|---|---|---|
| REG-OD-29 | P1 | A self-enrolled OD customer is visible to every division admin in its state | Follows from REG-OD-27 — but untested: it needs a division admin in that state whose division is not the derived one |
| REG-OD-30 | P1 | An OD customer's mobile does not block a new user, where a Fleet one does | OD is excluded from `usp_AddUser`'s CustomerMaster check; Fleet, Non Fleet and Corporate are not |
| REG-OD-31 | P2 | The Leads path (`/Lead/LeadList` → Add Leads) | `LeadMaster.DivisionId` is still derived from the pin code — lead 47 has pin 160019, Chandigarh, and division 17, Gurgaon. Untested. If the division is to stop applying to OD, this is a third place it still happens |
