# 01 — Authentication, session and self-enrolment

Screens: Login (`/Home/Login`), Change Password (`/Home/ChangePassword`), OD Self-Enrolment
(`/Home/PersonalSelfEnrolment`).

The gate file already covers the happy paths. This file is the negative space around them, plus
the public self-enrolment form — which is the only unauthenticated screen that writes data.

---

## Login — validation and refusals

| ID | Pri | Case | Expected |
|---|---|---|---|
| REG-AUTH-01 | P1 | Submit with username empty | Refused, message names the username field |
| REG-AUTH-02 | P1 | Submit with password empty | Refused, message names the password field |
| REG-AUTH-03 | P1 | Username that exists in no table | Refused. Must not reveal whether the user exists |
| REG-AUTH-04 | P2 | Username with leading/trailing spaces | Trimmed and accepted, or refused with a message — not a server error |
| REG-AUTH-05 | P2 | Username in a different case | Behaves the same as the exact case |
| REG-AUTH-06 | P1 | Mobile shorter/longer than 10 digits | Refused before submission |
| REG-AUTH-07 | P1 | Wrong OTP at the OTP step | Refused, and the OTP field is not cleared of context — the user can retry |
| REG-AUTH-08 | P1 | Expired OTP (wait past validity) | Refused with a message saying it expired, not a generic failure |
| REG-AUTH-09 | P2 | Resend OTP | Issues a new one; the previous one stops working |
| REG-AUTH-10 | P0 | Account lockout after repeated wrong passwords | Locked, with a message saying so. Confirm in `dbo.UserAuthStatus` |
| REG-AUTH-11 | P0 | A disabled user (`IsActive = 0`) cannot sign in | Refused |
| REG-AUTH-12 | P2 | SQL and script payloads in the username | Refused or sanitised; no error page, no reflected script |

---

### REG-AUTH-13 — A mobile carrying several user rows signs in as one of them
**Priority** P0 · **Depth** measured

**Pre** A mobile with more than one `Users` row. `9111181007` has 29, all TERRITORY_ADMIN;
`7486836430` has 30. Measured: every row on a mobile shares one password hash.

**Steps**
1. Sign in with that mobile.
2. Note which role and scope the session gets.
3. Sign out and repeat twice.

**Expected** Sign-in succeeds and resolves to the **same** row every time, with a stated rule for
which one.

**Why this matters** Nothing visible determines which row wins. If the resolution is
non-deterministic, the same credentials grant different scope on different days — and for a
mobile whose rows span divisions, that is an access-control defect. Record the resolved scope
each time.

---

### REG-AUTH-14 — Changing the password changes it for every row on that mobile
**Priority** P0 · **Depth** measured

**Pre** A multi-row mobile, as above.

**Steps**
1. Change the password through the UI.
2. Sign in again.
3. Confirm the hash on every `Users` row for that mobile.

**Expected — and this is the question** All rows share the new hash, because the password is
inherited from the row with `IsParentUser = 1`. Consequences to record: deactivating one row does
not revoke the credential, and a password change intended for one user reaches all of them.

**Evidence** `SELECT COUNT(DISTINCT PasswordHash) FROM dbo.Users WHERE MobileNumber = …` before
and after. Measured on the ten busiest mobiles: 38–50 rows, one distinct hash each.

---

## Change password

| ID | Pri | Case | Expected |
|---|---|---|---|
| REG-AUTH-15 | P1 | New password below the policy minimum | Refused, message states the policy |
| REG-AUTH-16 | P1 | New and confirm do not match | Refused |
| REG-AUTH-17 | P1 | Old password wrong | Refused |
| REG-AUTH-18 | P1 | New password same as old | Refused, or accepted per policy — record which |
| REG-AUTH-19 | P2 | "Reset" button | Clears the form only. It does **not** submit — `#btnResetChangePwd` |
| REG-AUTH-20 | P1 | After changing, the old password no longer works | Refused |

---

## OD self-enrolment — `/Home/PersonalSelfEnrolment`

The only unauthenticated screen that creates a customer. Reachable without signing in; linked
from the login page as Sign Up.

### REG-AUTH-21 — The form is reachable without a session and renders its fields
**Priority** P1 · **Depth** measured

**Expected** HTTP 200 without signing in. 23 visible fields: full name, mobile, email, date of
birth, referral code, language, related-party radios, PAN and its upload, pin code, city, state,
address, lat/long, address proof type/number/upload, and four bank fields with a proof upload.
**No division control** — correct, per the OD change.

---

### REG-AUTH-22 — Mobile OTP verification gates the enrolment
**Priority** P1 · **Depth** measured

**Steps** Enter a fresh mobile, press Generate OTP, read `dbo.UserSMSLog`, enter it.

**Expected** Verified. Submitting without verifying is refused.

---

### REG-AUTH-23 — A mobile already registered is refused
**Priority** P0 · **Depth** measured

**Steps** Enter a mobile belonging to an existing **Fleet** customer and complete the form.

**Expected** Refused — `usp_AddUser` blocks any new user whose mobile belongs to a non-OD
customer at status 101 or 104. The message should say the mobile is registered.

**Then repeat with a mobile belonging to an existing OD customer.** Expected: **allowed** — OD is
excluded from that check. One customer type behaving differently from the other three is the
designed behaviour here, and worth confirming rather than assuming.

---

### REG-AUTH-24 — KNOWN FAIL (FP-OD-7) — the pin code still decides a division
**Priority** P3 · **Depth** measured

**Steps**
1. Enter pin code `380001` in the Pin Code field and tab out.
2. Inspect the hidden input `#odDivision`.
3. Repeat with `201304`.

**Expected** Empty, or the `OD Default - <state>` dummy for the resolved state — matching what
Add Customer stores.

**Actual** A real division, derived from the pin code: `380001` → "Ahmedabad II" (division 2),
`201304` → "Noida" (division 34). The live customer NAYAFP3023400262 carries real division 34 as
a result, where every Add Customer OD carries the dummy.

**Note** No visibility impact — the dummy divisions are storage only and visibility keys off
customer type. This is a consistency defect: one enrolment path follows the storage convention
and the other does not.

---

### REG-AUTH-25 — An unresolvable pin code
**Priority** P1 · **Depth** measured

**Steps** Enter `999999`, then `700001`.

**Expected** Neither resolves. State, city and district stay empty and the form cannot be
completed. **`700001` — central Kolkata — resolves to nothing**, which means a Kolkata
self-enrolment cannot complete its address. Confirm whether that is still true and raise it if so.

---

| ID | Pri | Case | Expected |
|---|---|---|---|
| REG-AUTH-26 | P1 | Submit with each mandatory field missing in turn | Each refusal names the field |
| REG-AUTH-27 | P1 | PAN in the wrong shape | Refused before submission |
| REG-AUTH-28 | P0 | PAN already held by another customer | Refused, message names the duplicate — see REG-CO-18, currently misleading |
| REG-AUTH-29 | P1 | Date of birth in the future, and age under 18 | Refused |
| REG-AUTH-30 | P2 | Upload a file of the wrong type, then one over the size limit | Each refused with a message |
| REG-AUTH-31 | P1 | IFSC that does not exist | Refused |
| REG-AUTH-32 | P1 | Complete a valid enrolment end to end | Application created; confirm in `RawCustomerMaster` with the expected status and division |
| REG-AUTH-33 | P2 | Referral code: valid, then invalid | Valid accepted and recorded; invalid refused |
| REG-AUTH-34 | P2 | Back to Login | Returns to the login page without submitting |
