# 04 — Customer management

The twelve customer screens not covered by onboarding: profile, approved customers, status,
credit PIN, audit, virtual account, TDS, RO credit, and the two Lead screens.

---

## Approved Customers — `/Customer/ManageCustomers`

| ID | Pri | Case | Expected |
|---|---|---|---|
| REG-CM-01 | P1 | Opens for an entitled officer and lists customers | Grid renders with customer ID, name, type, status |
| REG-CM-02 | P0 | Scope: a division admin sees only its own division's non-OD customers | Confirm against `CustomerMaster.CustomerDivisionId`. **OD is exempt by design** — see REG-OD-27 |
| REG-CM-03 | P1 | Search by customer ID, mobile, PAN, name | Each filters; the result is narrower than unfiltered |
| REG-CM-04 | P1 | Export to Excel and PDF | File downloads; row count matches the grid |
| REG-CM-05 | P2 | Paging | Later pages render and do not repeat page one |
| REG-CM-06 | P2 | A search with no match | An empty-state message, not a blank grid or "Loading…" left on screen |

**Trap for REG-CM-03 and -06** The grid renders cells with no separator between them, so a row
reads `11000514939OD…` — the serial number runs into the reference. When comparing by eye, read
the cell, not the row.

---

## Customer Profile and View Customer Information

| ID | Pri | Case | Expected |
|---|---|---|---|
| REG-CM-07 | P1 | Open a customer's profile | Business, customer, address, bank and branch details all render |
| REG-CM-08 | P1 | Edit a field and save | Goes to Customer Edit Approval rather than applying immediately |
| REG-CM-09 | P0 | Approve the edit (`/Customer/ApproveCustomerProfileEdit`), as someone other than the editor | Applied; four-eyes holds |
| REG-CM-10 | P1 | Reject the edit | Original values intact |
| REG-CM-11 | P1 | View Customer Information as a read-only role | Renders; no editable control offered |
| REG-CM-12 | P2 | Profile of an inactive customer | Renders, with the status shown |

---

## Activate / Deactivate — `/Customer/ManageCustomerStatus`

| ID | Pri | Case | Expected |
|---|---|---|---|
| REG-CM-13 | P0 | Deactivate an active customer | Status 101 → 104, with a reason recorded |
| REG-CM-14 | P0 | Its users cannot sign in afterwards | Refused |
| REG-CM-15 | P0 | Its vehicles cannot transact afterwards | Refused |
| REG-CM-16 | P1 | Reactivate | 104 → 101; users and vehicles usable again |
| REG-CM-17 | P1 | Deactivate needs a reason | Refused without one |
| REG-CM-18 | P1 | Adding a vehicle to an inactive customer | Refused. **Known:** the message misattributes the cause — see REG-VEH-31 |
| REG-CM-19 | P0 | A deactivated customer's mobile still blocks new users | It does: `usp_AddUser` counts status **104** as well as 101. Confirm, because it is counter-intuitive and correct |
| REG-CM-20 | P2 | Deactivate a customer that is already inactive | Refused or no-op, with a message |

---

## Manage Credit PIN and the change log

| ID | Pri | Case | Expected |
|---|---|---|---|
| REG-CM-21 | P1 | Manage Credit PIN opens and renders its controls | Renders for an entitled role |
| REG-CM-22 | P1 | Set a PIN validity period | Saved; reflected on reopening |
| REG-CM-23 | P1 | Credit Pin Logs records the change | A row with actor, old and new values, timestamp |
| REG-CM-24 | P2 | Invalid validity (past date, zero, non-numeric) | Refused |

---

## Customer Audit Logs

| ID | Pri | Case | Expected |
|---|---|---|---|
| REG-CM-25 | P1 | Every change made in this module appears | Onboarding approval, edits, status changes, PIN changes — each with actor and timestamp |
| REG-CM-26 | P1 | Filter by customer and by date | Filters correctly |
| REG-CM-27 | P0 | The log cannot be edited or deleted from the UI | No control offered |

---

## Virtual account, TDS, RO credit

| ID | Pri | Case | Expected |
|---|---|---|---|
| REG-CM-28 | P1 | View Virtual Account for a customer | Account number and IFSC render; match the database |
| REG-CM-29 | P2 | Virtual account for a customer that has none | Empty state, not an error |
| REG-CM-30 | P1 | Update Customer TDS (`/CustomerTds/TdsMasterUpdate`) | Rate saved and applied to the next transaction |
| REG-CM-31 | P2 | Invalid TDS rate (negative, above 100) | Refused |
| REG-CM-32 | P1 | RO Credit Transactions (`/Customer/RoAccountDetail`) | Lists transactions; figures match the database |
| REG-CM-33 | P1 | RO Credit Settlement (`/Customer/RoCreditSettlement`) | Settlement recorded and reflected in the balance |

---

## Manage Customer Users — `/Customer/ViewCustomerUser`

This screen is where the 22 September hierarchy caps surface. Both keys are configured at **2**,
and inactive users count toward the limit.

### REG-CM-34 — The parent-user cap is enforced, and says so
**Priority** P1 · **Depth** measured

**Pre** A customer already holding two `CUSTOMER_PARENT_USER` rows. Sixteen customer codes already
qualify.

**Steps** Add a third parent user.

**Expected** Refused with "Maximum of 2 Customer Parent Users allowed for this customer."

**The point of the case** is the message. A refusal here can come from the cap **or** from the
mobile-conflict check, and from outside they are indistinguishable unless the wording is read. Record
which one you got.

---

| ID | Pri | Case | Expected |
|---|---|---|---|
| REG-CM-35 | P1 | The branch-user cap, same shape | "Maximum of 2 Customer Branch Users allowed for this branch." Eight branch codes already at the limit |
| REG-CM-36 | P1 | Deactivate a parent user, then add another | **Still refused** — inactive rows count. Counter-intuitive and deliberate; confirm rather than assume |
| REG-CM-37 | P0 | Add a parent user without a customer ID | "Customer ID is required to create this user type." |
| REG-CM-38 | P1 | Add a user on a mobile already held by a non-OD customer | Refused — the conflict check, not the cap. Distinguish by wording |
| REG-CM-39 | P1 | A customer admin manages only its own users | Cannot see or edit another customer's |
| REG-CM-40 | P2 | Deactivate and reactivate a customer user | Sign-in follows the state |

---

## Leads — `/Lead/LeadList`, `/Lead/CustomerReferral`

**Depth: structural.** Never exercised. Note the one measured fact: `LeadMaster` carries its own
`PinCode` **and** `DivisionId`, and the division is derived from the pin code — lead 47 has pin code
160019 (Chandigarh) and division 17 (Gurgaon). That is a third place the pin-code-to-division rule
lives, and it matters to the OD change.

| ID | Pri | Case | Expected |
|---|---|---|---|
| REG-CM-41 | P1 | Leads Management opens; the status tabs filter | All / New / Contacted / Qualified / Onboarding Initiated / Onboarded / Unqualified / Closed |
| REG-CM-42 | P1 | Add Leads: the form has a pin code and no division control | Lead created |
| REG-CM-43 | P1 | What division the new lead is stored with | Record it. If it is derived from the pin code, it is the same rule the OD change removes elsewhere |
| REG-CM-44 | P1 | A lead progresses to an onboarding application | `OnboardingReferenceNo` populated and the application exists |
| REG-CM-45 | P1 | A lead that becomes an **OD** customer | What division does it end with? Untested, and it is the open question from FP-OD-7 |
| REG-CM-46 | P2 | Add Referral Code, and Customer Referrals | Code created; referrals listed |
| REG-CM-47 | P1 | Lead scope by officer | A lead is visible to the officers whose hierarchy covers it and no others |
| REG-CM-48 | P2 | Export leads | File matches the grid |
