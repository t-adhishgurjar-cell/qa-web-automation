# FleetPlus Web — Manual Regression Suite

**Audience:** QA engineers executing this by hand, and whoever later automates it.

**Application under test:** FleetPlus Web, `https://webqa.fleetforc.com`, release 1.1.0.

---

## How this suite is organised

One file per module. Execute in this order — earlier modules create the data later ones read.

| # | Module | Screens | Cases | File |
|---|---|---:|---:|---|
| 00 | Gate — run first, stop if red | — | 12 | [00-gate.md](00-gate.md) |
| 01 | Authentication & session | 3 | 35 | [01-authentication.md](01-authentication.md) |
| 02 | Customer onboarding | 6 | 55 | [02-customer-onboarding.md](02-customer-onboarding.md) |
| 03 | OD enrolment & hierarchy | 3 | 31 | [03-od-enrolment.md](03-od-enrolment.md) |
| 04 | Customer management | 12 | 50 | [04-customer-management.md](04-customer-management.md) |
| 05 | Vehicle | 17 | 52 | [05-vehicle.md](05-vehicle.md) |
| 06 | Users, roles & access | 6 | 40 | [06-users-access.md](06-users-access.md) |
| 07 | Financial & wallet | 10 | 30 | [07-financial.md](07-financial.md) |
| 08 | Retail outlet & terminals | 27 | 34 | [08-retail-outlet.md](08-retail-outlet.md) |
| 09 | Reports | 26 | 32 | [09-reports.md](09-reports.md) |
| 10 | Cross-cutting | — | 22 | [10-cross-cutting.md](10-cross-cutting.md) |
| | **Total** | **116** | **391** | |

**116 active screens** exist in `dbo.MenuMaster`. This suite covers all of them: in depth where
behaviour has been measured, structurally where it has not — and each case says which it is.

**[SUITE-STRUCTURE.md](SUITE-STRUCTURE.md)** breaks the eleven modules into **56 sub-modules**,
each with its screen count, case range, depth and what is already automated. Use it to split
execution between testers and to plan the automation phase.

---

## Case format

```
### REG-VEH-014 — Vehicle Approval: approve a queued vehicle
Priority   P1
Screen     Vehicle Approval — /Vehicle/VehicleApproval
Depth      measured          (or: structural — see Depth below)
Pre        A vehicle at status 411 for a customer in the tester's division
Steps      1. …
Expected   …
Evidence   What to capture for the release record
```

**Priority**

| | Meaning |
|---|---|
| **P0** | Release cannot ship. Money, access control, or data integrity |
| **P1** | Core business flow. Ships only with an accepted defect reference |
| **P2** | Secondary flow or presentation. Triaged |

**Depth**

| | Meaning |
|---|---|
| **measured** | Derived from observed application behaviour. Expected results are what the app was seen to do, or what it should do where that differs — the difference is stated |
| **structural** | The screen has never been exercised. The case checks it opens, refuses the unentitled, filters and exports. Deliberately shallow; do not read it as business validation |

Of the 116 screens, **23 are measured** and **93 are structural**. Reports (26) and Retail
Outlet (23) are entirely structural — 42% of the application. Executing this suite green does
not mean those modules work; it means they render and scope correctly.

---

## Environment and test data

### QA conveniences — do not assume these in UAT or production
- **OTP is always `123456`** for login, consent, mobile verification and password reset.
- **Captcha accepts any value**, including empty. `/Home/ValidateCaptchaCode` returned
  `{"valid":true}` for `123456`, `ZZZZ`, `0000` and `""`.
- **SMS is not delivered.** Messages are written to `dbo.UserSMSLog` with status
  "Skipped — mobile not in whitelist". The row still carries the OTP, the temporary password and
  the consent link — that is how a tester gets them.
- **Consent links point at UAT.** The SMS contains
  `https://fleetplusuatweb.nayaraenergy.com/consent/consent?token=…`. The token is
  host-agnostic: replace the host with the environment under test.

### Accounts

| Role | Username | Password | Scope |
|---|---|---|---|
| FP Admin | *see `.env.qa`* | — | everything |
| DSA | 9611200199 | Thinkpad@1 | region 2, HR_HP_PB, Gurgaon (div 17) |
| TSM / Territory Admin | 9612200200 | Thinkpad@1 | region 2, HR_HP_PB, Gurgaon (div 17) |
| BDA | 9616200104 | Thinkpad@1 | multi-division |
| Parent Admin (customer) | 9200000000 | *see `.env.qa`* | own customer, 13 branches |
| Ahmedabad Region Admin | 9072986100 | Nayara@1 | region 4 (West) |
| Ahmedabad State Admin | 9073068501 | Nayara@1 | region 4, GJ_I (11) |
| Ahmedabad I Division Admin | 9073139002 | Nayara@1 | + division 1 |
| Ahmedabad II Division Admin | 9063600900 | Nayara@1 | + division 2 |
| Ahmedabad I Territory Admin | 9111181007 | Nayara@1 | + division 1 |
| Ahmedabad II Territory Admin | 7486836430 | Nayara@1 | + division 2 |
| Kolkata Region Admin | 9073209903 | Nayara@1 | region 1 (East) |
| Kolkata State Admin | 9073275904 | Nayara@1 | region 1, WB_NE (3) |
| Kolkata Division Admin | 9073340105 | Nayara@1 | + division 26 |
| OD customer | 9149056894 | Nayara@1 | NAYAFP3013600031, WB_NE, dummy div 53 |

The Ahmedabad I and Ahmedabad II pairs differ **only** by division, same state and zone. Any
case that needs to isolate the division level of the hierarchy should use that pair.

### Data that must be minted fresh per run
- **Mobile numbers.** A number already registered is refused, and 44 mobiles are permanently
  blocked by disabled users. Use `9` + the last 9 digits of a timestamp.
- **PAN.** `ABCPA1234F` is spent — `/Customer/ValidatePanNumber` answers `isValid:0`, and the
  form then complains about validation rather than duplication. Shape: 5 letters, 4 digits, 1
  letter, 4th letter carrying the entity type (`P` individual, `C` company).
- **Vehicle registrations.** `test-data/deregistered-vehicles.json` holds 277, of which 230 are
  unused in FleetPlus.

### Reference data
- **Customer status:** 101 Active · 102 Pending for Review · 103 Draft · 104 Inactive ·
  105 Pending for Approval · 107 Consent Pending
- **Vehicle status:** 401 Active · 402 Admin Approved · 403 Blocked · 404 De-mapped · 405 Failed ·
  408 Vahan Verified · 409 Pending · 410 Vahan Failed · 411 Pending for Approval · 412 Duplicate
- **Customer types:** 1001 Fleet · 1002 Non Fleet · 1004 OD · 1006 Corporate
- **Officer hierarchy:** REGION_ADMIN holds a region · STATE_ADMIN a region and state ·
  DIVISION_ADMIN and TERRITORY_ADMIN all three. A TSM is division-scoped **and** reviews.
- **Onboarding chain:** DSA-raised `107 → 102 → 105 → 101`; FP-Admin-raised `107 → 105 → 101`.

---

## Executing this suite

1. Run **00-gate.md** first. If anything there fails, stop and fix the environment — results
   from a broken environment are worse than no results, because they get attributed to the build.
2. Record for each case: pass / fail / blocked / not-run, the tester, the date, and the build
   version from the page footer (`FLEETPLUS Web Release Version - 1.1.0`).
3. Capture evidence as each case's **Evidence** line asks. A screenshot of a success banner is
   not evidence — this application shows success banners for operations that did not happen.
   Where a case says to confirm in the database, do that.
4. Raise defects with: case ID, build version, role used, the exact record (reference number,
   customer ID, registration), what the screen said, and what the database held.

### Before trusting any result — read this
This application fails quietly in specific, repeatable ways. Twelve of them are listed in
[10-cross-cutting.md](10-cross-cutting.md#known-traps), and each has cost real time here. The
two that matter most for manual execution:

- **A button that appears to do nothing usually has an unmet precondition that is not shown.**
  The reviewer's "Reviewed" needs every document preview opened first; the checker's "Approve"
  needs both Verify fields re-entered until the buttons read "Verified". Neither tells you.
- **Success messages are not proof.** "Customer data has been saved successfully" appears on
  forms that then refuse to submit. Confirm state changes against the database or by reopening
  the record.

---

## Open defects this suite currently reproduces

| Ref | Priority | Case | Summary |
|---|---|---|---|
| FP-OD-1 | P1 | REG-OD-20…28 | OD applications visible to officers outside their region and state |
| FP-OD-3 | P1 | REG-CO-31 | Changing customer type does not reload sub-type or division |
| FP-OD-5 | P2 | REG-CO-18 | Duplicate PAN reported as "validate the PAN before submission" |
| FP-OD-7 | P3 | REG-OD-30 | Self-enrolment stores a real division, not the dummy |
| — | P1 | REG-UA-22 | Hierarchy user cap refusal indistinguishable from a mobile conflict |
| — | P2 | REG-VEH-31 | Vehicle not added for an inactive customer, with a misleading message |

Cases known to fail are marked **KNOWN FAIL** with the reference. Do not re-raise them; confirm
they still fail and record it.
