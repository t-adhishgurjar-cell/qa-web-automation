# Vehicle Management — regression run, 28 September 2026

Environment `webqa.fleetforc.com`. First run of the vehicle project since commit `f7a7dc8` replaced
82 fixed sleeps across 13 page objects, so this is a **baseline**, not a regression against a known
green state.

---

## What the automated vehicle project actually contains

**3 runnable tests.** Worth stating plainly, because "run the vehicle regression" sounds like more
than it is:

| Test | Result |
|---|---|
| W-VEH-001 / W-VEH-002 — a vehicle is blocked, then unblocked | **pass** (after a fix, below) |
| W-VEH-006 — vehicle authentication finds a vehicle by registration | **fail** — cause not isolated |
| W-VEH-005 — purchase limits open for a real vehicle | **did not run** |

The 34 vehicle-approval scenarios live in `APPROVAL-SCOPE-SCENARIOS.md` and in `tools/` probes, not
in this project. `coverage.api.spec.ts` matches the `api` project, not `vehicle`.

**The describe is serial**, so the first failure stopped the remaining test. For a regression suite
that is the wrong default: one broken case hides everything after it.

---

## W-VEH-001 / W-VEH-002 — pass

Block moved `DL3CW9474` 401 → 403, unblock returned it to 401, both confirmed in
`dbo.VehicleDetails`.

It failed twice first, and both failures were mine:

**The block dialog was never answered.** `completeStatusChange()` **sampled** `.modal.show` with
`isVisible()`. The toggle fires no request, so `settle()`'s networkidle wait returns immediately and
the check ran while Bootstrap was still fading the dialog in — it saw no modal, returned an empty
message, and the test reported a block that had never been attempted. Now waited for, and it throws
if the dialog does not open rather than returning silence.

**Two different dialogs, measured:**

```
Block:    "Block Vehicle | Vehicle: DL3CW9474 | Reason *"   buttons: Cancel | Block
Unblock:  "Unblock Vehicle | Unblock DL3CW9474?"            buttons: Cancel | Yes
```

Block requires a **Reason** (`#txtBlockReason`) and its confirming button is labelled for the action;
unblock needs no reason and says "Yes". A single generic matcher does not cover both.

---

## W-VEH-006 — fail, cause not isolated

Vehicle Authentication returns an **empty panel** for `DL3CW9474`: authentication type, OTP SPOC and
SPOC mobile all blank.

What has been ruled out:

- **Not an entitlement problem.** The screen renders its controls for the account the test uses —
  `#vaVehicleNo`, `#vaCustomerId`, `#btnVehicleAuthSearch`, `#btnVehicleAuthReset`. (An earlier probe
  ran as an officer and found the screen bare, which proved nothing about this test — different role.)
- **Not the wrong fixture.** `DL3CW9474` belongs to `NAYAFP2023400247`, which **is** a branch of
  `NAYAFP1023400246`, the test account's own customer. It is one of the 7 vehicles that account should
  see, at status 401.

What is **not** yet established: the search ran with `#vaCustomerId` **empty**. The page object fills
that field only when it judges it editable. So the open question is whether the screen needs both
fields — a page-object bug — or whether the lookup is genuinely broken. The run to settle it was
blocked by the sign-in flakiness below.

**Do not file this as a defect yet.** Three times today an apparent application failure turned out to
be an unanswered dialog or a stale read.

---

## Also covered in this module today

| Check | Result |
|---|---|
| NFP-1913 — approval refused while the customer is inactive | **verified fixed** — `ApproveVehicleWithRC` returns `statusCode 0` and "Customer is Inactive. Vehicle cannot be approved."; vehicle stays 411 |
| NFP-1913 — control: same row, customer active | approved, `statusCode 1` — so the guard is specific to status |
| NFP-1913 — parent customer inactive | **unreachable.** Deactivating a parent cascades to its branches, and a branch cannot be reactivated while the parent is inactive, so "Active branch under Inactive parent" cannot be produced |
| Add Vehicles → Vahan failure → approval queue | **works.** `DL3CAX0901` and `DL1GB5987` both reached 411 |
| Vehicle Approval, acting on the matched row | **works** — confirmation is "Approve vehicle &lt;reg&gt;? Cancel \| Yes" |

---

## The finding that runs through all of it

**Silent refusals and silent successes.** Five separate places today, all in this module or adjacent
to it:

| Action | What is shown |
|---|---|
| Block with an empty Reason | nothing — refused in silence |
| Block that succeeds | nothing |
| Approve without answering the confirmation | nothing — no request is even sent |
| Activating a branch whose parent is inactive | nothing — refused in silence |
| Changing a customer's status | nothing, while `UpdateCustomerStatus` answers `"… successfully."` |

An operator cannot tell a refusal from a success in any of them, and neither can a test. This is the
single highest-value thing to raise from the run: it is one defect class, not five, and it is what
made three of today's investigations expensive.

---

## Left in the environment

- `DL3CW9474` — back to 401, as it started
- `NAYAFP1023400254` and `NAYAFP2023400255` — both back to 101
- `DL3CAX0901`, `DL1GB5987` — left pending at 411, available for a retest
- `DL4CNB1474` — approved during the NFP-1913 control, so now live at 401

## Not covered

Limits (set, prepaid, default, usage), transfer, RO mapping, products and transactions, lifecycle,
generic vehicle approval, manage pending vehicle, de-map/re-add, and bulk upload beyond what
`APPROVAL-SCOPE-SCENARIOS.md` already records. Module 05 of the manual suite lists all of them as
REG-VEH-01…52.

## Environment

Sign-in failed three times across the run — once stuck at `/Home/LoginOtpVerification`, twice with the
dashboard never rendering. Each passed on retry. The database dropped twice (`ECONNRESET`). Neither is
an application defect, and both cost more time than the testing.
