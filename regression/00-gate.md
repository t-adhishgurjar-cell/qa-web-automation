# 00 — Gate

**Run this first. If anything here fails, stop.** A failure in this file means the environment
or the build is not testable, and every result after it will be attributed to the wrong cause.
Two working days were lost this month to exactly that: an application mid-redeploy returning
404s, and a dropped VPN, both initially written up as application defects.

12 cases. Expect 10 minutes.

---

### REG-GATE-01 — The application is reachable and is the build you think it is
**Priority** P0 · **Depth** measured

**Steps**
1. Open `https://webqa.fleetforc.com/`.
2. Read the version in the page footer.

**Expected** The login page renders. The footer reads `FLEETPLUS Web Release Version - <n>`.

**Fail action** A 404 or 502 usually means a deploy is in progress — wait and retry before
raising anything. Record the version: a defect against an unknown build cannot be actioned.

**Evidence** Footer version, recorded at the top of the run sheet.

---

### REG-GATE-02 — Each role can sign in and lands on its own dashboard
**Priority** P0 · **Depth** measured

**Pre** Accounts from [README](README.md#accounts).

**Steps** For each of FP Admin, DSA, TSM, Ahmedabad Division Admin, Parent Admin, OD customer:
1. Sign in with username, password, any captcha value, OTP `123456`.
2. Note the landing URL.

**Expected** Every one reaches a dashboard. Landing differs by category and that is correct:
Nayara staff reach `/NayaraDashboard/Index`, a customer reaches `/CustomerDashboard/Index`.

**Fail action** One role failing is an account problem; all roles failing is the environment.
Check REG-GATE-03 before assuming either.

**Evidence** The landing URL per role.

---

### REG-GATE-03 — A wrong password is refused, with a message
**Priority** P0 · **Depth** measured

**Steps** Sign in with a valid username and a deliberately wrong password.

**Expected** Refused, and a modal appears carrying the reason. The message lives in a Bootstrap
dialog (`#failer-mess-popup` / `#error-mess-popup`), **not** inline on the form.

**Note** Use a throwaway account. Repeated failures lock a real one, and an account locked
mid-regression costs the rest of the run.

---

### REG-GATE-04 — Captcha is bypassed in QA, and you have confirmed it
**Priority** P1 · **Depth** measured

**Steps** Sign in three times with captcha values `123456`, `ZZZZ` and empty.

**Expected** All three are accepted in QA. **In UAT or production this case must fail** — if it
passes there, raise it as P0.

---

### REG-GATE-05 — Forced first-login password change
**Priority** P0 · **Depth** measured

**Pre** An account that has never signed in. Its temporary password is in `dbo.UserSMSLog`.

**Steps**
1. Sign in with the temporary password.
2. Observe the redirect. Set a new password and submit.

**Expected** Lands on `/Home/ChangePassword` and cannot navigate away until the password is
changed. After changing, a fresh sign-in with the new password reaches the dashboard.

**Trap** "Reset" (`#btnResetChangePwd`) clears the form; it does not submit. Submit is
`#btnSubmitChangePwd`.

---

### REG-GATE-06 — Forgot Password issues a working password
**Priority** P1 · **Depth** measured

**Steps**
1. On the login page open **Forgot Password**, enter a registered mobile, generate OTP.
2. Enter `123456` and submit.
3. Read `dbo.UserSMSLog` for that mobile.

**Expected** Two rows: the OTP, then "your temporary FLEETPLUS account password is …". Signing in
with it lands on the forced change screen.

**Note** This is the only route to a password for an account that has never signed in — which
covers every TERRITORY_ADMIN in GJ_I.

---

### REG-GATE-07 — Unlock User
**Priority** P2 · **Depth** measured

**Steps** Lock an account with repeated wrong passwords, then use **Unlock User** with OTP.

**Expected** The account unlocks and signs in. A non-locked account is refused with a message
rather than silently accepted.

---

### REG-GATE-08 — Menu entitlement matches the role mapping
**Priority** P0 · **Depth** measured

**Steps** For each role in REG-GATE-02, list the sidebar menu items and compare against
`RoleMenuMappings` joined to `MenuMaster` for that role.

**Expected** Exactly the granted set — nothing missing, nothing extra. An extra item is the more
serious direction: it is an access-control defect.

**Evidence** The menu list per role, alongside the query result.

---

### REG-GATE-09 — A screen the role is not granted is refused
**Priority** P0 · **Depth** measured

**Steps** As Ahmedabad Division Admin, navigate directly to `/Customer/CustomerOnboardingReviewer`.

**Expected** Refused. Note that the refusal is served on the same URL with an "Unauthorized
Access" body rather than a redirect or a 403 — so check the body, not the status code.

---

### REG-GATE-10 — Database access, if the run includes database checks
**Priority** P0 · **Depth** measured

**Steps** Run `SELECT 1`, then `SELECT COUNT(*) FROM dbo.MenuMaster`.

**Expected** Both return. `ECONNRESET` means the VPN is down, not that the application is broken
— reconnect before continuing. The login is read-only by design; it cannot see stored procedure
bodies and cannot execute anything.

---

### REG-GATE-11 — Session handling
**Priority** P1 · **Depth** measured

**Steps**
1. Sign in as one account in two browsers.
2. Sign in as the same account in a second tab of one browser.

**Expected** The app raises its own dialogs for both — an active-session prompt
(`#profile-active-session-ok-btn`) and a single-tab takeover
(`#nayara-single-tab-takeover`). Both should be acknowledgeable and leave a usable session.

---

### REG-GATE-12 — Logout
**Priority** P1 · **Depth** measured

**Steps** Sign out, then press Back, then navigate directly to a granted screen.

**Expected** Both return to the login page. A cached authenticated page rendering after logout
is a P0.
