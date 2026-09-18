# Vehicle Approval — division scope change

Change request: **"No mapping restrictions in customer & vehicle management"**, limited to
(a) vehicle approval and (b) bulk mapping/de-mapping, for **registered** vehicles.

## The flow being changed

1. A vehicle is added (by a customer admin, branch admin, DSA — anyone).
2. The Vahan API verification **fails**.
3. The vehicle lands on **Vehicle Approval** (`/Vehicle/VehicleApproval`).
4. It is mapped to the **customer's division** — *not* the adding user's division.
5. **Old rule:** only admins of that customer division could approve it.
   **New rule:** any State Admin can approve it, whatever the customer's division.

Step 4 is the part that must **not** change. Only the approver restriction in step 5 is lifted.
A change that also altered the division a vehicle is mapped to would satisfy every
"can X approve it" test and still be wrong.

## Measured baseline (2026-09-18, QA)

| Officer | Scope | `/Vehicle/VehicleApproval` |
|---|---|---|
| Ahmedabad State Admin | GJ_I | 10 rows |
| Kolkata State Admin | WB_NE | 10 rows — **identical** |
| Ahmedabad Division Admin | Division 1 | 10 rows — identical |
| Kolkata Division Admin | Division 26 | 10 rows — identical |
| Region Admin (West and East) | zone | **REFUSED the screen** |

Gujarat and West Bengal are disjoint scopes, so identical lists mean the listing is no longer
filtered. Confirmed against the prior behaviour: previously not all states saw the whole list.

### What the queue actually contains

Resolved through `CustomerMaster.CustomerDivisionId` -> `DivisionMaster` -> `BusinessStateMaster`:

| Customer | Division | Business state | Region |
|---|---|---|---|
| NAYAFP2020700026 | Dehradun (15) | UP_UK | North |
| NAYAFP2020900113 | Lucknow (28) | UP_UK | North |
| NAYAFP2020900114 | Lucknow (28) | UP_UK | North |
| NAYAFP2031500044 | Bengaluru (6) | Karnataka | South |
| NAYAFP2107000217 | Noida (34) | UP_UK | North |

No customer in the queue is in GJ_I or WB_NE, yet the Gujarat and West Bengal admins each see all
ten rows — including a Karnataka customer, from the South region. That is the restriction being
gone, evidenced at division level rather than inferred from row counts.

Note also that `VehicleDetails` has **no division column**. A vehicle's division is the customer's,
resolved by join at read time, so "mapped to the customer's division" is a property of the query
rather than stored state — which is why step 4 cannot drift independently, and why the whole
restriction lived in whatever filtered that query.

## Scenarios

`A` = action verified in the application, `D` = verified in the database, `W` = requires a write.

### Core — the new rule

| # | Scenario | Expected | Notes |
|---|---|---|---|
| VA-01 | State Admin of the **same** division as the customer approves | Approved | The old path must still work — a change that only inverted the rule would fail here |
| VA-02 | State Admin of a **different** state approves | Approved | The change itself. `W` |
| VA-03 | Vehicle added by a user in division X for a customer in division Y | Queued against **Y** | Step 4. `D` |
| VA-04 | After approval, the vehicle's division mapping is unchanged | Still Y | The regression that would hide behind a passing VA-02. `D` |
| VA-05 | Queue lists vehicles from many customer divisions at once | All listed | Measured: 10 rows spanning several customers |
| VA-06 | Approved vehicle leaves the queue | Gone from the list | |

### Who may approve

| # | Scenario | Expected | Status |
|---|---|---|---|
| VA-10 | Division Admin (any division) | **Approves — confirmed intended** | Ruled: State and Division Admins may approve. Measured: the Ahmedabad I (GJ_I/West) Division Admin approved a Gurgaon (HR_HP_PB/North) vehicle — `ApprovedBy 230686`, `UserTypeId 6 DIVISION_ADMIN` |
| VA-11 | Region Admin | **Refused — correct** | Ruled: only State and Division Admins approve. Measured: both Region Admins are refused the screen outright, which matches |
| VA-12 | FP Admin | Approved | Superset role |
| VA-13 | TSM / DSA / BDA | Refused | |
| VA-14 | Customer Admin / Branch Admin | Refused | Not an FP officer screen |

### Edge cases

| # | Scenario | Why it matters |
|---|---|---|
| VA-20 | Customer has **no division** set | Where does the vehicle go — visible to nobody, or to everybody? Under the old rule an orphan was unapprovable; under the new one it may silently become approvable |
| VA-21 | Customer's division is **inactive** (`DivisionMaster.StatusFlag=0`) | |
| VA-22 | Approver's own `UserLocationMapping` row is inactive, user still active | Does entitlement read the mapping at all now? |
| VA-23 | Approver mapped to **several** divisions | |
| VA-24 | **Approve an already-approved vehicle** (stale tab, double submit) | Idempotent, or a second approval/audit row? |
| VA-25 | **Two State Admins approve the same vehicle concurrently** | The race the change makes possible for the first time — previously only one division's admins could reach it, now everyone can |
| VA-26 | **Bulk approve via select-all** across divisions | `#vapSelectAll` exists on the screen; bulk is where a per-row check is most likely to be missing |
| VA-27 | **Generic (unregistered) vehicle** in the queue | CR covers *registered* vehicles only — a generic vehicle must NOT inherit the relaxed rule |
| VA-28 | Vahan-**successful** vehicle | Must never appear in this queue |
| VA-29 | Customer is Inactive / Pending | Should a vehicle for a non-Active customer be approvable? |
| VA-30 | Customer moves division **after** the vehicle is queued | Does the queue entry follow the customer? |
| VA-31 | Rejected, then re-submitted | Returns to the queue, still mapped to the customer division |
| VA-32 | Pagination — page 2 of a long queue | Scoping applied per page rather than per query would show here |
| VA-33 | Search by customer id / vehicle no returns cross-division results | The filters are `#txtCustomerId`, `#txtVehicleNo` |
| VA-34 | Audit trail records **which** admin approved | With any state admin now able to act, "who approved this" matters more than before |

### Server-side — the likeliest place for a real defect

| # | Scenario | Why |
|---|---|---|
| VA-40 | Region Admin, refused in the UI, calls the approve endpoint directly | UI refusal is not enforcement. This application has form-level scoping enforced only by absence elsewhere |
| VA-41 | Customer Admin calls the approve endpoint | |
| VA-42 | Approve a vehicle id **not** in the caller's list, by id | The old rule lived somewhere; if the UI filter was removed but the server check was not, this fails for a foreign division — or vice versa, which is worse |
| VA-43 | Out-of-scope screens still scoped: Add Vehicles, Transfer, Block/Unblock, single De-Map | The CR is narrow. `TC014`–`TC019` already assert branch scoping on Add Vehicles and must keep passing |

## Results — executed 2026-09-18

Fixtures come from `test-data/deregistered-vehicles.json`, extracted from the de-registered
vehicle PDF. Those registrations fail Vahan by definition (`vahanStatus 405`), which is the
trigger that routes a vehicle to the approval queue.

| # | Scenario | Result |
|---|---|---|
| VA-02 | State Admin of a different state approves | **PASS** — Kolkata (WB_NE/East) approved a Noida (UP_UK/North) vehicle; 411 -> 402, live row 401 |
| VA-03 | Queued against the customer's division, not the adder's | **PASS** — added by Ahmedabad I (GJ_I/West), queued under Noida (UP_UK/North) |
| VA-05 | Queue spans customer divisions | **PASS** — Dehradun, Lucknow, Noida, Bengaluru all listed together |
| VA-06 | Approved vehicle leaves the queue | **PASS** — searching an approved vehicle returns "No records found." |
| VA-24/25 | Two admins, one vehicle (stale tab) | **PASS on data, FAIL on message** — see defect below |
| VA-26 | Bulk approve across divisions | **PASS** — 3 vehicles in 2 divisions, one action, "3 approved.", no duplicate live rows |
| VA-33 | Search returns cross-division results | **PASS** — WB_NE admin found a HR_HP_PB customer's vehicle by both customer id and registration |
| VA-10 | Division Admin approves cross-division | **PASS** — Ahmedabad I (GJ_I/West) approved a Gurgaon (HR_HP_PB/North) vehicle through the UI |
| VA-11 | Region Admin cannot approve | **PASS** — refused the screen; no approval path exists for the role |
| VA-28 | No Vahan-verified vehicle in the queue | **FAIL** — 8 listed as "Vahan Verified", 1 as "Duplicate"; see below |
| VA-32 | Pagination | **PASS** — 146 rows across 2 pages at size 100; no scope or status change on page 2 |
| VA-29 | Vehicle for an Inactive customer | **Refused by both routes — bulk's reason is wrong**; see below |
| VA-31 | Reject then re-submit | **Not applicable — no reject path exists**; see below |

The approver matrix is therefore settled and matches the ruling:

| Role | Sees the queue | Can approve |
|---|---|---|
| State Admin | yes, unfiltered | yes, any division |
| Division Admin | yes, unfiltered | yes, any division |
| Region Admin | no — refused | no |

### Finding — the queue holds 9 vehicles that passed Vahan and never went live

VA-28 asked whether a Vahan-verified vehicle can appear in a queue meant for failures. It can.
Walking all pages of `/Vehicle/VehicleApproval` at page size 100 returns **146 rows**:

| Label shown in the grid | Rows |
|---|---|
| Pending for Approval (411) | 138 |
| **Vahan Verified (408)** | **8** |
| Duplicate (412) | 1 |

The application labels them itself, so this is not an inference from status codes.

Two explanations were tested and rejected:

- **"verified but the RC document is still pending"** — the approve endpoint is
  `ApproveVehicleWithRC`, so this was the obvious reading. Of the 330 raw rows at 408 only **3**
  carry an `RcDocPath`, and every queued one has none.
- **"all 408 rows are listed"** — they are not. 330 sit at 408; only 8 appear.

What actually distinguishes them: joining `RawVehiclesDetail` to `VehicleDetails` on
(`VehicleNo`, `CustomerID`), **9 of the 330 rows at 408 have no live row at all**. Those are the
ones in the queue. They carry `ApprovedBy NULL` and `ModifiedTime NULL`, and were created in June
and July 2026 — so they have sat there for two to three months without anyone acting on them.

So these are vehicles that **passed Vahan verification and were never promoted to
`VehicleDetails`**. They are stranded in staging, and the approval screen is where they surface.

Whether that is deliberate (a rescue hatch, surfacing records that failed to promote) or a leak in
the queue's query, it reads wrong to an approver: the screen's purpose is vehicles whose
verification failed, and a row labelled "Vahan Verified" invites the question of what approving it
would even mean. Untested deliberately — the eight belong to other customers, and approving one to
find out would be someone else's data.

`PB23T2295`, `NL01AE2359`, `GJ05JD9759`, `NL01AE2368` are the four with no live row under any
customer; the rest have live rows for *other* customers but none for the one they are queued under.

### Defect — the stale-approval message is wrong

Two State Admins open the queue; the first approves; the second clicks Approve on the row its
page still shows. **The data is handled correctly** — no second `VehicleDetails` row, status and
`ModifiedBy` unchanged from the first approver. But the second admin is told:

> **Vehicle Not Available** — This vehicle (DL1YA7706) is already assigned to your account.
> Please add a different vehicle.   `Yes`  `No`  `Ok`

Three things are wrong with that:

1. **"assigned to your account"** — it is not. It belongs to customer NAYAFP2023400247 in Noida.
   The admin reading this has no relationship to the vehicle beyond approving it.
2. **"Please add a different vehicle"** — this is the approval queue, not Add Vehicles. There is
   nothing to add here, and the instruction cannot be followed.
3. **`Yes` / `No` / `Ok` on an error** — three buttons for a message with no question in it.

It reads like the `CheckVehicleAssignment` response from the Add Vehicles flow surfaced verbatim
in a screen it was not written for. Low severity for data, higher than it looks for operations:
**this change is what makes the collision common.** Previously two admins could only race inside
one division; now every State Admin in the country is looking at the same queue, so the first time
most of them meet a concurrent approval they will be told a vehicle they have never seen is
assigned to their account.

### VA-29 — a vehicle for an Inactive customer

Both routes refuse, which is the right outcome. They disagree about why.

| Route | Outcome | What it says |
|---|---|---|
| Manual entry | refused, Add disabled | `GetCustomerStatus` -> `{"status":0,"reason":"Customer is Inactive"}`, modal **"Customer is Inactive"** |
| Bulk upload | refused, nothing written | **"Vehicle cannot be mapped with non fleet branch"** |

**The bulk message is factually wrong.** `NAYAFP2023400133` is a fleet customer:
`CustomerType 1` -> `CustomerTypeCode 1001` = **Fleet**, `CustomerSubType 8` -> code 5003 =
**"Fleet less than 10 KL per month"**. The two customers bulk upload happily accepted are the same
type (subtypes 40 "Fleet greater than 10 KL" and 1 "Aggregator", both 1001). The only difference
between accepted and refused is `Status` — 101 versus 104.

So bulk blames customer *type* for a customer *status* problem. Someone uploading 500 rows and
getting "cannot be mapped with non fleet branch" will go looking for the wrong thing entirely,
while manual entry on the same customer names the real cause.

Note also that the preview staged the row as **"Ready"** before the server refused it.

### VA-31 — not applicable: there is no reject path

The scenario assumed a vehicle could be rejected and re-submitted. It cannot.

Scanning every `button`, `a`, `input`, `[data-action]` and `[onclick]` on `/Vehicle/VehicleApproval`
— visible **and** hidden, matching text, id, class, `data-action` and `title` against
reject/decline/deny/refuse/return/correction — returns **zero** controls. A queue row offers
exactly two things:

    <input class="vap-row-select vap-grid-checkbox">
    <button class="btn-approve-vahan">Approve</button>

The page adds Search, Reset, "Approve Selected", Excel and PDF. Nothing declines a vehicle.

Checked thoroughly rather than assumed, because this application does park controls in the DOM
hidden — the *customer* review screen carries both Reject and Send for Correction, and the
onboarding wizard keeps duplicate footers in inactive tab panes. Vehicle approval genuinely has
neither.

**Why this matters more after the change.** An approver who should not approve something — wrong
data, a vehicle that is not really the customer's, a de-registered vehicle that should never be
onboarded — has no way to say so. The only options are approve it or leave it in the queue. That is
a plausible part of why 138 vehicles are sitting at 411, some since June, and it means the queue
has no disposal route at all: nothing ever leaves it except by approval.

## Bulk mapping — the Bulk Upload tab

"Bulk mapping" in the change request is the **Bulk Upload** tab on Add Vehicles (`#avTabBulk`);
bulk DE-mapping is a separate "Bulk De-Map" control inside `/Vehicle/DeMapVehicle`. Neither is a
menu entry of its own, which is why searching all 111 FP Admin menu items found nothing.

The template is three columns — **Vehicle No | Branch ID | Vehicle Type** — and "Vehicle Type" is
*ownership* (`Owned` / `Attached`), not fuel; anything else is refused with "Invalid Vehicle Type".

The tab offers **no branch selector at all**. Manual Entry confines a parent admin to
`#avBranchLocation`, a dropdown of its own branches; Bulk Upload moves the choice into a file the
uploader writes. So the only thing standing between an uploader and someone else's fleet is a
server-side check. There is one, and it is correct:

| Uploader | Target branch | Outcome |
|---|---|---|
| Customer Admin of NAYAFP1023400246 (Noida) | NAYAFP2023400255 — **another customer** | **Rejected**: "You are not authorized to upload vehicles for this Branch UID." |
| Ahmedabad I Division Admin (GJ_I / West) | NAYAFP2023400255 — Gurgaon, **another division** | **Accepted**: "Success" |

That is exactly the intended shape. Customer-to-customer is still forbidden; division-to-division
is open, which is the change request's "no mapping restrictions" for bulk mapping.

Note the preview lies slightly on the way: the staged row reads **"Ready"** for a branch the server
then refuses, because ownership is validated client-side and entitlement only at commit.

### Open — a bulk-uploaded vehicle does not reach the approval queue

Manual entry and bulk upload do not produce the same state:

| Route | Resulting `RawVehiclesDetail.VehicleStatus` | In the approval queue? |
|---|---|---|
| Manual entry, Vahan failed | 411 Pending for Approval | yes |
| **Bulk upload** | **409 Pending** | **no** |

`DL4CNB1474` was uploaded successfully — "Successfully uploaded 1 vehicle(s). Pending for
approval." — and is not findable in `/Vehicle/VehicleApproval` by customer id or by registration.
It is the ONLY row at 409 in the database; the 146-row queue is built from 411.

Bulk upload also performs no Vahan call at submit time, so 409 may be a hand-off to a verification
job that had not run when this was measured. Under watch rather than reported as stuck — but it is
the same shape as the nine 408 rows above, which have been waiting since June.

## Known gaps in this analysis

- Only **listings** have been measured. No approval has been performed, so whether the *action*
  enforces a division check is unknown — that is VA-02 and VA-42, and both need a write.
- `/Vehicle/AddVehicles`, `/Vehicle/DeMapVehicle` and `/Vehicle/VehicleLifecycle` are
  search-driven, so "both officers see nothing" is not evidence either way. VA-43 needs a vehicle
  whose customer division is known, which needs the database.
- Bulk **de-map** is a "Bulk De-Map" control inside `/Vehicle/DeMapVehicle`, not a menu entry.
  Bulk **mapping** has not been located; `/Vehicle/VehicleROMapping` is single-vehicle only.
