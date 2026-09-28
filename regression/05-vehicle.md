# 05 — Vehicle

Seventeen screens. Add, approve, map, limit, block, transfer, de-map, and the lifecycle view.

**Status reference** 401 Active · 402 Admin Approved · 403 Blocked · 404 De-mapped · 405 Failed ·
408 Vahan Verified · 409 Pending · 410 Vahan Failed · 411 Pending for Approval · 412 Duplicate

**Test registrations** `test-data/deregistered-vehicles.json` — 277 registrations, 230 unused.
Never reuse one across runs: a registration is not a key, and a vehicle carries several lifecycle
rows over time.

---

## Add Vehicles — `/Vehicle/AddVehicles`

### REG-VEH-01 — The customer field depends on who is adding
**Priority** P1 · **Depth** measured

**Steps** Open Add Vehicles as a Parent Admin, then as an officer.

**Expected** A parent admin gets a dropdown of their **own** branches (`#avBranchLocation`). An
officer gets a free-text customer field (`#CustomerId`). Two different controls for the same
concept — a test written for one will not find the other.

---

| ID | Pri | Case | Expected |
|---|---|---|---|
| REG-VEH-02 | P1 | Number of cards, then Add | The requested number of vehicle rows render |
| REG-VEH-03 | P1 | Registered vehicle: registration, fuel type, ownership, tank size | All mandatory |
| REG-VEH-04 | P1 | Vehicle type is fixed at "Registered" | `#ddlVehicleType` is disabled — the generic path is not reachable from here |
| REG-VEH-05 | P0 | Verify against Vahan, success | Status 408 Vahan Verified; details populate from Vahan |
| REG-VEH-06 | P0 | Verify against Vahan, failure | Status 410 Vahan Failed, and the vehicle goes to the Vehicle Approval queue at 411 |
| REG-VEH-07 | P1 | Submit | Confirm the control you press is the visible one: `#btnsubmit` also exists **hidden** in the inactive Manual Entry pane. The real one is `#btnSubmitPreview` |
| REG-VEH-08 | P1 | A registration already in FleetPlus | Refused, or 412 Duplicate — record which |
| REG-VEH-09 | P1 | Malformed registration | Refused before submission |
| REG-VEH-10 | P0 | Add to a customer in another division, as an officer | Allowed — per the change request, mapping is not division-restricted |
| REG-VEH-11 | P0 | **Add to an inactive customer** | Refused. **Known:** the message misattributes the cause. Record the wording |

---

## Bulk upload

| ID | Pri | Case | Expected |
|---|---|---|---|
| REG-VEH-12 | P1 | Download the template, fill it, upload | Rows accepted and vehicles created |
| REG-VEH-13 | P0 | A sheet whose ownership column is wrong | Rejected with "Invalid Vehicle Type" — note the column is **ownership** (Owned/Attached), not fuel. The message names the wrong thing |
| REG-VEH-14 | P0 | Mixed sheet: valid rows, rows for another branch, rows invalid for other reasons | Accepted, rejected-on-branch and rejected-for-other must be **distinguishable** in the result. Collapsing them hides which rule fired |
| REG-VEH-15 | P1 | Uploaded vehicles sit at 409, then move to 411 | A background job moves them roughly 2.5 minutes after upload. Asynchronous, not stranded — wait before raising |
| REG-VEH-16 | P1 | Empty sheet, and a sheet with headers only | Refused with a message |
| REG-VEH-17 | P2 | A very large sheet | Completes or refuses cleanly; no timeout with partial writes |
| REG-VEH-18 | P0 | Partial failure | Accepted rows persist, rejected rows do not, and the report says which |

---

## Vehicle Approval — `/Vehicle/VehicleApproval`

Where a Vahan failure lands. The change request removed the division restriction here.

### REG-VEH-19 — Approve the vehicle you intended
**Priority** P0 · **Depth** measured

**Steps**
1. Search a registration using the search **button** — `#btnVehicleApprovalSearch`. Enter is not
   wired.
2. Approve from **that row**.

**Expected** Status 411 → 401 for that registration only.

**Trap** There is no page-level Approve. Every row carries its own `.btn-approve-vahan`, so acting
on "the first Approve on the page" approves row one — which is how the wrong vehicle was approved
here once. Scope the action to the matched row.

**Evidence** The registration, its status before and after, and the statuses of neighbouring rows.

---

| ID | Pri | Case | Expected |
|---|---|---|---|
| REG-VEH-20 | P0 | A Division Admin of the customer's division approves | Allowed |
| REG-VEH-21 | P0 | A State Admin approves | Allowed |
| REG-VEH-22 | P0 | A Division Admin of **another** division approves | Allowed per the change request — mapping restrictions removed for vehicle approval. Confirm this is still the intent before signing off |
| REG-VEH-23 | P1 | Reject from the approval queue | The vehicle lands in a rejected state and leaves the queue. Never successfully exercised — treat as untested |
| REG-VEH-24 | P1 | The queue's status column | Read the cell by its content, not by column index — a guessed index returned "-" for all 146 rows here and hid a real finding |
| REG-VEH-25 | P1 | Queue contents against the database | Match on `(VehicleNo, CustomerID)` together. A registration alone is not a key and produced 20 false offenders |
| REG-VEH-26 | P1 | Approve a vehicle whose customer was deactivated after it entered the queue | Refused: "Customer is Inactive. Vehicle cannot be approved." `ApproveVehicleWithRC` answers `statusCode 0`, the vehicle stays 411. **Verified fixed 28 Sep — NFP-1913** |
| REG-VEH-26b | P1 | Approve a vehicle whose **parent** customer is inactive | Refused naming the parent. **Cannot be set up:** deactivating a parent cascades to its branches, and a branch cannot be reactivated while the parent is inactive — so an Active branch under an Inactive parent is unreachable from these screens. Ask the developer for the route before signing this off |
| REG-VEH-26c | P2 | Activating a branch whose parent is inactive | Refused **with a message**. Currently silent — the action posts, nothing changes, nothing is said |
| REG-VEH-27 | P2 | A grid still rendering | "Loading…" is not a data row. Wait for it to resolve before counting |

---

## Manage, view and map

| ID | Pri | Case | Expected |
|---|---|---|---|
| REG-VEH-28 | P1 | Manage Vehicles lists the customer's vehicles with status | Renders; statuses match the database |
| REG-VEH-29 | P0 | Scope: an officer sees vehicles within their hierarchy | Confirm which levels apply — this is the screen behind "previously not all states could see all the vehicle list" |
| REG-VEH-30 | P1 | View Vehicles as a read-only role | Renders; no action offered |
| REG-VEH-31 | P1 | Bulk mapping via the Bulk Upload tab | Scoped as the change request intends |
| REG-VEH-32 | P0 | Bulk de-map across divisions | Works; **the customer boundary holds** — a vehicle cannot be de-mapped to another customer |
| REG-VEH-33 | P1 | De-map a single vehicle | Status 404; it leaves the active list |
| REG-VEH-34 | P1 | De-map a vehicle that was never approved | Refused or no-op with a message. Untested |
| REG-VEH-35 | P1 | De-map then re-add the same registration | Record what happens — 412 Duplicate, a new row, or a refusal. Untested |
| REG-VEH-36 | P1 | Transfer a vehicle between customers | Ownership moves; history preserved |
| REG-VEH-37 | P1 | Vehicle RO Mapping | Vehicle restricted to the mapped outlets |
| REG-VEH-38 | P2 | Registration with case and whitespace differences | Treated as the same vehicle, or refused — not silently duplicated |

---

## Limits

| ID | Pri | Case | Expected |
|---|---|---|---|
| REG-VEH-39 | P1 | Set Vehicle Limit | Saved; enforced on the next transaction |
| REG-VEH-40 | P1 | Set Vehicle Prepaid Limit | Saved; balance reflects it |
| REG-VEH-41 | P1 | Vehicle Default Limits Update | Applies to newly added vehicles, not retrospectively |
| REG-VEH-42 | P1 | View Vehicle Limits Usage | Consumed and remaining match the transactions |
| REG-VEH-43 | P2 | Limit above the customer's own limit | Refused |
| REG-VEH-44 | P2 | Zero and negative limits | Refused |

---

## Block, authenticate, lifecycle

| ID | Pri | Case | Expected |
|---|---|---|---|
| REG-VEH-45 | P0 | Block a vehicle | Status 403; it cannot transact |
| REG-VEH-46 | P0 | Unblock | Returns to 401 and can transact |
| REG-VEH-47 | P1 | Block needs a reason | Refused without one |
| REG-VEH-48 | P1 | Vehicle Authentication | Behaves per configuration |
| REG-VEH-49 | P1 | Manage Products and Transactions per vehicle | Enable and disable both take effect |
| REG-VEH-50 | P1 | Vehicle Lifecycle shows every transition | Add, approve, limit, block, de-map, transfer — each with actor and timestamp |
| REG-VEH-51 | P1 | Generic Vehicle Approval | Untested. Structural: opens, refuses the unentitled, approves |
| REG-VEH-52 | P1 | Manage Pending Vehicle | Untested. Structural, as above |
