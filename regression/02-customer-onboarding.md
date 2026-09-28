# 02 — Customer onboarding

Screens: Add Customer (`/Customer/ManageCustomerOnboarding` → the wizard), View Onboarding
(`/Customer/CustomerOnboardingStatus`), Review Onboarding
(`/Customer/CustomerOnboardingReviewer`), Approve (`/Customer/ValidateNewCustomer`), Add Branch,
Approve Customer Branch.

The spine of the product, and a four-eyes flow: the maker cannot approve their own work.

```
DSA raises       107 Consent Pending → 102 Pending for Review → 105 Pending for Approval → 101 Active
FP Admin raises  107 Consent Pending → 105 Pending for Approval → 101 Active
```

The reviewer stage exists only for a maker who needs review. Testing this as an FP Admin skips
102 entirely and will not exercise the TSM.

---

## The wizard — reaching it

### REG-CO-01 — The wizard renders fully only when reached through the list
**Priority** P0 · **Depth** measured

**Steps**
1. Navigate directly to `/Customer/AddCustomer?new=1`. Note the footer controls.
2. Now go to Customer Management → Add Customer, and click Add Customer on the list screen.

**Expected** Reached directly, the server omits the footer — no Save As Draft, no Next, no Submit —
leaving a form that cannot be advanced. Reached through the list, the full wizard renders.

**Why this is first** Nothing about the URL hints at it and the degraded page looks complete. Any
tester who bookmarks the wizard URL will report unrelated defects all day. The checker screen
behaves the same way — see REG-CO-24.

---

| ID | Pri | Case | Expected |
|---|---|---|---|
| REG-CO-02 | P1 | Reference number on arrival | Generated, read-only, at least 6 digits |
| REG-CO-03 | P1 | Application date | Pre-filled with today, read-only |
| REG-CO-04 | P1 | Maker details block | Name, mobile, role, division, state, region all pre-filled from the session and read-only |
| REG-CO-05 | P2 | Maker details for a role with no division | Renders without error; blanks rather than a crash |

---

## Basic information

### REG-CO-06 — Customer type drives the form
**Priority** P0 · **Depth** measured

**Steps** Select each of Fleet, Non Fleet, Corporate, OD in turn on a **freshly loaded** form,
and record which fields are visible and required.

**Expected** Fleet, Non Fleet and Corporate render the full form including the division. OD
renders a reduced form — 29 visible fields against Fleet's 38, no division, no business name or
email, no business type, no GST declaration, no ID proof, no segment or buying pattern — and it
carries the address block, which for the other types is a separate step.

**Trap** Reload between selections. The division control is disabled under OD and nothing resets
it, so cycling types on one page reports whatever the previous type left behind.

---

### REG-CO-07 — KNOWN FAIL (FP-OD-3) — changing the type does not reload its dependent lists
**Priority** P1 · **Depth** measured

**Steps**
1. Select **Fleet**, then sub-type **Aggregator**.
2. Change the customer type to **OD**.
3. Read the sub-type dropdown and its options.
4. Complete the OD form and submit.

**Expected** The sub-type list reloads to OD's own — only `OD (Owner Driver)` — and the invalid
Fleet selection is cleared.

**Actual** The list still offers Fleet's five sub-types with "Aggregator" still selected. Submit
is refused with the inline "Select Customer Sub Type" **beside a dropdown that visibly holds a
value**. Measured:

```
Fleet, fresh form   --Select Sub Type-- | Aggregator | Fleet >10 KL | Fleet <10 KL | Nayara Freight
OD, fresh form      --Select Sub Type-- | OD (Owner Driver)
after Fleet → OD    --Select Sub Type-- | Aggregator | …  (Aggregator still selected)
```

**Same fault on division against business state** — change the state and the division list still
offers the previous state's divisions, so a Fleet application can carry a division from a state
it does not belong to. Test both.

---

| ID | Pri | Case | Expected |
|---|---|---|---|
| REG-CO-08 | P1 | Division list follows the selected business state | Reloads for the new state — **KNOWN FAIL, FP-OD-3** |
| REG-CO-09 | P1 | Division is mandatory for Fleet, Non Fleet, Corporate | Submit refused without it |
| REG-CO-10 | P2 | Related party YES reveals RO code, and the RO name resolves | Offices populate from the RO code |
| REG-CO-11 | P1 | Related party NO | RO fields hidden and not required |
| REG-CO-12 | P2 | Referral code, valid and invalid | Validated on blur |

---

### REG-CO-13 — PAN validation happens on blur, and the form depends on it
**Priority** P0 · **Depth** measured

**Steps**
1. Enter a PAN and **do not** leave the field. Try to submit.
2. Tab out, and watch for the inline result.
3. Submit.

**Expected** Submitting without tabbing out is refused with "Please validate the PAN number before
submission. Tab out of the PAN field after entering it." After tabbing out with a fresh PAN, the
field validates and submit proceeds.

**Note** The message is accurate only for the case it names. See REG-CO-18.

---

### REG-CO-14 — PAN must match the business type
**Priority** P1 · **Depth** measured

**Steps** Select a business type, then enter a PAN whose fourth character belongs to a different
entity type.

**Expected** "Invalid PAN Number". The two are only valid relative to each other — a PAN that was
correct a moment earlier becomes invalid when the business type changes, which is correct
behaviour and reads like a bug if you are not expecting it.

---

| ID | Pri | Case | Expected |
|---|---|---|---|
| REG-CO-15 | P1 | PAN upload missing | Refused at submit with "Upload PAN Card document." Note the file input is styled out of sight — the control is a Browse button |
| REG-CO-16 | P1 | GST registered YES then a GST number | Number validated against the PAN |
| REG-CO-17 | P1 | GST registered NO | A declaration document becomes required instead |
| REG-CO-18 | P2 | **KNOWN FAIL (FP-OD-5)** PAN already held by another customer | Should name the duplicate. Actual: "Please validate the PAN number before submission" — about a field the user completed correctly. The API answered `{"status":1,"isValid":0}` and the inline field said "PAN already exists" |

---

### REG-CO-19 — Customer mobile OTP verification
**Priority** P0 · **Depth** measured

**Steps** Enter a fresh mobile, Generate OTP, read `dbo.UserSMSLog`, enter it, Verify.

**Expected** The button relabels to "Verified". Submitting without verifying is refused.

---

| ID | Pri | Case | Expected |
|---|---|---|---|
| REG-CO-20 | P0 | A mobile belonging to an existing non-OD customer | Refused — `usp_AddUser`'s conflict check. Message should say the mobile is registered |
| REG-CO-21 | P1 | A mobile belonging to an existing **OD** customer | Allowed — OD is excluded from that check |
| REG-CO-22 | P1 | Bank details: name, holder, account, IFSC, proof | All mandatory; IFSC validated |
| REG-CO-23 | P1 | Save As Draft mid-way, then reopen from the list | Everything entered is still there; status 103 |

---

## Address, branch and meeting steps

| ID | Pri | Case | Expected |
|---|---|---|---|
| REG-CO-24 | P1 | Pin code drives state, city, district | All three fill from the lookup. Wait for them — the request fires on blur, so they arrive after the page looks settled |
| REG-CO-25 | P1 | Pin code in a different state from the business state | Accepted — no division-based restriction on the address |
| REG-CO-26 | P1 | Unresolvable pin code | State stays empty; the step cannot be completed |
| REG-CO-27 | P1 | Address proof type, number and upload | All mandatory |
| REG-CO-28 | P1 | Branch location: pin code, manager, and the same-as-parent checkboxes | Reuses the customer's contact details without a second OTP |
| REG-CO-29 | P1 | Branch location field is required and is not filled by the pin code lookup | Refused if left empty |
| REG-CO-30 | P2 | Add a second branch | Both persist |
| REG-CO-31 | P1 | Meeting details: date and in-person/remote | Mandatory before submit |
| REG-CO-32 | P2 | Meeting attendees, up to ten rows | All saved |

---

### REG-CO-33 — Submit, and what the confirmation proves
**Priority** P0 · **Depth** measured

**Steps** Complete every step and submit.

**Expected** A modal: "The customer form with Reference ID <n> has been successfully submitted."
**The reference in that sentence must match the one read at the start.** The wizard does not
navigate away and does not hide its Submit button, so checking that the button disappeared will
report a successful submission as a failure.

**Then confirm** `RawCustomerMaster` holds the reference at status 107, with the business state
and division you expect.

**Evidence** The reference, the confirmation text, and the database row.

---

## Consent

### REG-CO-34 — Consent is the customer's step, and it moves 107 → 102
**Priority** P0 · **Depth** measured

**Pre** An application at 107 raised by a **DSA**.

**Steps**
1. Read the consent link from `dbo.UserSMSLog` for the customer mobile.
2. **Replace the host** — the SMS points at `fleetplusuatweb.nayaraenergy.com` regardless of
   where it was sent from. The token is host-agnostic.
3. Open it. Click the Terms button, tick the checkbox, continue.
4. Enter OTP `123456` and verify.

**Expected** "Consent has been securely recorded." The application moves to **102** for a
DSA-raised form, or 105 for an FP-Admin-raised one.

**Trap** The Confirm button is a two-stage gate. It starts as "Read the Terms and Conditions" and
is enabled; clicking it relabels to "Confirm & Continue" and **disables** it until the checkbox
is ticked. Ticking first and clicking once does nothing and the OTP field never appears.

**Worth raising separately** A customer onboarded in QA consents on UAT if the link is followed as
sent.

---

| ID | Pri | Case | Expected |
|---|---|---|---|
| REG-CO-35 | P1 | Consent with a wrong OTP | Refused; the application stays at 107 |
| REG-CO-36 | P1 | Reuse a consent token after consenting | Refused |
| REG-CO-37 | P2 | Consent link for a rejected application | Refused with a sensible message |

---

## Review — the TSM stage

### REG-CO-38 — A same-division TSM reviews: 102 → 105
**Priority** P0 · **Depth** measured

**Pre** An application at 102. A TSM in the **same division** as the application.

**Steps**
1. Sign in as the TSM. Customer Management → Review Onboarding. The application is listed.
2. Open it.
3. **Open each document preview** — PAN, address proof, bank proof — and close each.
4. Tick both acknowledgements: PAN document and bank document.
5. Enter remarks.
6. Click **Reviewed**, then **YES** in the confirmation.
7. Poll the status.

**Expected** `SubmitReviewerDecision` returns success and the application moves to 105.

**Traps, all of which cost time here**
- **Step 3 is not optional.** Without the previews, "Reviewed" sends no request, opens no dialog
  and writes no message. It simply does nothing. Nothing on screen says why.
- Remarks are mandatory and the refusal is an inline `#Remarks_error`, not a dialog.
- The confirmation's button text is "YES" with whitespace — and there is a "NO" beside it.
- The status moves **asynchronously**. Read it immediately and it still says 102.

**Evidence** Status before and after, from the database.

---

| ID | Pri | Case | Expected |
|---|---|---|---|
| REG-CO-39 | P0 | Review without ticking the acknowledgements | Refused — they are the substance of the review |
| REG-CO-40 | P1 | Review without remarks | Refused, inline |
| REG-CO-41 | P1 | **Reject** from the reviewer screen | The application lands in a rejected state and is not reviewable again. Never successfully exercised here — treat as untested |
| REG-CO-42 | P1 | **Send for Correction** | Returns to the maker, who can amend and resubmit |
| REG-CO-43 | P0 | A TSM from a **different division** cannot review | Should not appear in their queue. **Currently OD applications do appear cross-division and cross-state — FP-OD-1.** For Fleet, confirm the queue is division-scoped |

---

## Approve — the checker stage

### REG-CO-44 — A checker who is not the maker approves: 105 → 101
**Priority** P0 · **Depth** measured

**Pre** An application at 105. The PAN and bank account number used by the maker — you will retype
them.

**Steps**
1. Sign in as a checker who is **not** the maker. Customer Management → Approve.
2. **Click through from the queue**, not by URL — reached directly the screen renders without its
   re-entry fields.
3. Open each document preview.
4. Retype the PAN into its Verify field and press Verify. Repeat for the bank account.
5. Enter remarks.
6. Click **Approve**, then **"Yes, approve"**.
7. Poll the status.

**Expected** Both Verify buttons end up **disabled and reading "Verified"** — that is the gate.
The application reaches 101, a `CustomerMaster` row is created with a customer ID, and the
customer's administrator user is created with a temporary password in `dbo.UserSMSLog`.

**Traps**
- Approve is inert until both Verify buttons read "Verified". No message, no request.
- The re-entry is a client-side comparison against what the maker submitted — it is not a lookup.
- The confirmation is "Yes, approve", not "Yes". Taking the first button in the dialog takes Cancel.
- Status moves asynchronously.

**Evidence** Customer ID, status, and the created user.

---

| ID | Pri | Case | Expected |
|---|---|---|---|
| REG-CO-45 | P0 | The maker tries to approve their own application | Refused — four-eyes |
| REG-CO-46 | P1 | Wrong PAN in the re-entry field | "PAN does not match."; Approve stays inert |
| REG-CO-47 | P1 | Approve without remarks | Refused with "Please enter Remarks" written into `#Remarks_error` — no modal, no request |
| REG-CO-48 | P1 | Reject and Send for Correction from the checker screen | Each lands the application in the right state |
| REG-CO-49 | P0 | **Onboarding still creates the customer's own administrator** | A user exists on the customer's mobile after approval. This depends on the admin being created before the customer row reaches a blocking status — `usp_AddUser` refuses any user on a non-OD customer's mobile at 101 or 104. Ordering holds today and nothing guards it, so check it every release |
| REG-CO-50 | P1 | The new admin can sign in and is forced to change its password | Reaches `/CustomerDashboard/Index` after the change |

---

## Branches

| ID | Pri | Case | Expected |
|---|---|---|---|
| REG-CO-51 | P1 | Add a branch to an active customer | Created, pending approval |
| REG-CO-52 | P1 | Approve Customer Branch | Branch becomes active and is usable for vehicle mapping |
| REG-CO-53 | P1 | Branch count limit | Refused past the configured maximum |
| REG-CO-54 | P1 | Add a branch as a Parent Admin against their own customer | Allowed, and only for their own customer |
| REG-CO-55 | P2 | Branch for an inactive customer | Refused with a message naming the customer status |
