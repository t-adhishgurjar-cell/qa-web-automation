# Jira tickets — vehicle approval scope change

Six tickets, ready to paste. Raised from QA verification of the change request
*"No mapping restrictions in customer & vehicle management"* (vehicle approval + bulk
mapping/de-mapping, registered vehicles).

**None of these blocks the change.** The change itself verified clean across 13 scenarios.
FP-A is the one worth acting on now — it is pre-existing, but the change makes it far more
reachable.

- **Environment:** QA — `webqa.fleetforc.com`, database `Nayara_QA` on `FPDevDB1`
- **Date of testing:** 18 September 2026
- **Full QA report:** https://claude.ai/artifact/LKVNseBsVeBsrzwDTEbKiy
- **Reproduction accounts:** State Admin `9073275904` (WB_NE/East), Division Admin `9073139002`
  (GJ_I/West), FP Admin `loadtest_006`
- **Vehicle fixtures:** from `test-data/details_of_diesel_vehicles_de-registered_as_on_28.01.2022_1.pdf`
  — de-registered registrations fail Vahan by definition, which is the trigger that routes a
  vehicle into the approval queue

Status codes used throughout (`StatusMaster`, `EntityTypeId 4`): 401 Active, 402 Admin Approved,
404 DeMapped, 408 Vahan Verified, 409 Pending, 410 Vahan Failed, 411 Pending for Approval,
412 Duplicate. Customer: 101 Active, 104 Inactive.

---

## FP-A — A vehicle can be approved, and go live, for a deactivated customer

| Field | Value |
|---|---|
| **Type** | Bug |
| **Priority** | High |
| **Component** | Vehicle Management — Vehicle Approval |
| **Affects** | `/Vehicle/VehicleApproval`, `POST /Vehicle/ApproveVehicleWithRC` |
| **Found in** | QA, 18 Sep 2026 |

### Summary
The application refuses to **add** a vehicle for an inactive customer, but does not refuse to
**approve** one that is already queued. A vehicle can therefore go live against a customer that has
been deactivated.

### Steps to reproduce
1. Sign in as a Division Admin (`9073139002`) and open **Vehicle Management → Add Vehicles**.
2. Enter Branch UID `NAYAFP2023400255` (Active at this point) and add one vehicle using a
   de-registered registration, e.g. `DL4CU8468`. Vahan returns `405 Verification Failed`; the
   application answers *"Vehicle has been submitted for approval"*.
3. Confirm it is queued: `RawVehiclesDetail.VehicleStatus = 411`.
4. Sign in as FP Admin, open **Customer Management → Manage Customer Status**, search
   `NAYAFP2023400255`, and click **Deactivate**. The screen confirms
   *"Customer has been deactivated successfully."* (`CustomerMaster.Status` becomes `104`).
5. Sign in as any State Admin (`9073275904`) and open **Vehicle Approval**. Search for `DL4CU8468`.
6. Click **Approve** on the row and confirm.

### Expected
The vehicle should not be approvable while its customer is inactive — consistent with Add
Vehicles, which refuses the same customer outright with *"Customer is Inactive"*.

### Actual
The vehicle is still listed, Approve succeeds, and the application reports
*"Vehicle approved successfully."*

```
RawVehiclesDetail   DL4CU8468   VehicleStatus 411 -> 402
VehicleDetails      DL4CU8468   VehicleStatus 401 Active, ApprovedBy 230688
CustomerMaster      NAYAFP2023400255   Status 104 (Inactive)
```

A live vehicle on a deactivated customer.

### Evidence
- Approver `Users.Id 230688` = `9073275904`, `UserTypeId 5 STATE_ADMIN`
- Contrast, same customer while inactive, via **Add Vehicles**:
  `POST /Customer/GetCustomerStatus` → `{"status":0,"reason":"Customer is Inactive"}`, and the
  screen shows *"Customer is Inactive"* with the Add button disabled
- Contrast, same customer while inactive, via **Bulk Upload**: refused, nothing written

So the check exists on entry and is simply absent at approval.

### Why it matters more now
Before this change only admins of the customer's own division could approve it. Any State or
Division Admin in the country can now act on any row, with no context on a customer in a geography
they have never dealt with — so "is this customer still active?" is exactly the judgement that
should not be left to the approver.

### Notes
The test customer was reactivated immediately afterwards (`Status 101`); no customer was left
switched off.

---

## FP-B — Nine Vahan-verified vehicles never went live and sit in the approval queue

| Field | Value |
|---|---|
| **Type** | Bug |
| **Priority** | Medium |
| **Component** | Vehicle Management — Vehicle Approval |
| **Affects** | `/Vehicle/VehicleApproval`, `POST /Vehicle/GetVehiclesForApprovalList` |

### Summary
The approval queue exists for vehicles whose Vahan verification **failed**. It also contains
vehicles that **passed**, plus one marked Duplicate. They are records that verified successfully
and were never promoted to `VehicleDetails`.

### Steps to reproduce
1. Sign in as any State or Division Admin and open **Vehicle Approval**.
2. Set the page-size selector (`#dt-length-0`) to **100** — it defaults to 10, which hides this.
3. Walk both pages and read the status column.

### Expected
Every row is `Pending for Approval`.

### Actual
146 rows: **138** `Pending for Approval (411)`, **8** `Vahan Verified (408)`, **1** `Duplicate (412)`.
The grid prints these labels itself.

### Evidence
Joining `RawVehiclesDetail` to `VehicleDetails` on (`VehicleNo`, `CustomerID`), **9 of the 330 raw
rows at 408 have no live row at all** — and those are the ones listed. All carry
`ApprovedBy NULL`, `ModifiedTime NULL`, created June–July 2026, so they have been stranded for two
to three months.

With no live row under any customer: `PB23T2295`, `NL01AE2359`, `GJ05JD9759`, `NL01AE2368`.

Two explanations were tested and ruled out:
- **"Verified but RC document pending"** — the approve endpoint is `ApproveVehicleWithRC`, so this
  was the obvious reading. Of the 330 rows at 408 only **3** carry an `RcDocPath`, and none of the
  queued ones do.
- **"All 408 rows are listed"** — 330 exist, 8 appear.

### Impact
Approvers are shown rows labelled "Vahan Verified" with no defined meaning for approving them, and
nine customer vehicles have been silently unusable since June.

---

## FP-C — Stale approval tells an admin a stranger's vehicle is assigned to them

| Field | Value |
|---|---|
| **Type** | Bug |
| **Priority** | Medium |
| **Component** | Vehicle Management — Vehicle Approval |
| **Labels** | messaging, ux |

### Summary
When two admins have the queue open and one approves, the second is shown a message that is wrong
in three separate ways. **The data is handled correctly** — this is the wording only.

### Steps to reproduce
1. Sign in as State Admin A (`9073275904`) and as State Admin B (`9073068501`) in separate
   sessions. Open **Vehicle Approval** in both. Both see vehicle `DL1YA7706`.
2. As A, approve `DL1YA7706`. It succeeds.
3. As B, **without refreshing**, click Approve on the same row.

### Expected
Something like *"This vehicle has already been approved by another user. Refresh the list."*

### Actual
> **Vehicle Not Available**
> This vehicle (DL1YA7706) is already assigned to your account. Please add a different vehicle.
> `[Yes]` `[No]` `[Ok]`

1. **"assigned to your account"** — it is not. It belongs to customer `NAYAFP2023400247` in Noida.
   Admin B has no relationship to it beyond being able to approve it.
2. **"Please add a different vehicle"** — this is the approval queue, not Add Vehicles. There is
   nothing to add here and the instruction cannot be followed.
3. **Three buttons** (`Yes` / `No` / `Ok`) for a message that asks no question.

It appears to be the `CheckVehicleAssignment` response from the Add Vehicles flow surfaced verbatim
on a screen it was not written for.

### Evidence
Data integrity is correct and should not change: after B's attempt, `RawVehiclesDetail` remains
`402` with `ModifiedBy` still A, and `VehicleDetails` holds exactly **one** row for `DL1YA7706`.

### Why it matters more now
Before this change two admins could only collide inside a single division. Every State and Division
Admin now watches the same national queue, so this message will be seen far more often — quite
likely as the first thing a new approver ever sees go wrong.

---

## FP-D — Bulk upload blames customer type for a customer status problem

| Field | Value |
|---|---|
| **Type** | Bug |
| **Priority** | Low |
| **Component** | Vehicle Management — Add Vehicles (Bulk Upload) |
| **Labels** | messaging |

### Summary
Bulk upload correctly refuses a vehicle for an inactive customer, but reports the wrong reason —
it blames the customer's **type** when the problem is the customer's **status**.

### Steps to reproduce
1. Sign in as any officer and open **Add Vehicles → Bulk Upload**.
2. **Download Template** and fill one row:
   `Vehicle No = DL4CU8468`, `Branch ID = NAYAFP2023400133`, `Vehicle Type = Owned`.
   (`NAYAFP2023400133` is `Status 104 Inactive`. Note "Vehicle Type" here is *ownership*, not fuel.)
3. **Upload Excel**, then **Submit**, then confirm.

### Expected
*"Customer is Inactive"* — which is exactly what Add Vehicles → Manual Entry says for the very same
customer.

### Actual
> Vehicle cannot be mapped with non fleet branch

### Evidence
The customer **is** a fleet branch:

```
NAYAFP2023400133   CustomerType 1 -> CustomerTypeCode 1001 "Fleet"
                   CustomerSubType 8 -> code 5003 "Fleet less than 10 KL per month"
                   Status 104 (Inactive)
```

The two customers bulk upload accepted in the same session are the same type — subtypes 40
("Fleet greater than 10 KL per month") and 1 ("Aggregator"), both `1001 Fleet`. The **only**
difference between accepted and refused is `Status`, 101 against 104.

### Impact
An admin uploading a large sheet is sent looking for a customer-type problem that does not exist,
while manual entry names the real cause on the same customer.

### Also worth fixing alongside
The client-side preview stages the row as **"Ready"** before the server refuses it — ownership is
validated client-side, entitlement only at commit.

---

## FP-E — Vehicle Approval has no reject path

| Field | Value |
|---|---|
| **Type** | Improvement |
| **Priority** | Medium |
| **Component** | Vehicle Management — Vehicle Approval |

### Summary
There is no way to decline a queued vehicle. The only exit from the approval queue is approval.

### Steps to reproduce
1. Sign in as any State or Division Admin and open **Vehicle Approval**.
2. Inspect the controls on any row and on the page.

### Expected
A way to reject or return a vehicle that should not be approved — as the equivalent **customer**
review screen provides, where both **Reject** and **Send for Correction** are offered.

### Actual
A row offers exactly two controls:

```
<input class="vap-row-select vap-grid-checkbox">
<button class="btn-approve-vahan">Approve</button>
```

The page adds Search, Reset, Approve Selected, Excel and PDF. Nothing declines a vehicle.

### Evidence
Every `button`, `a`, `input`, `[data-action]` and `[onclick]` on the screen was scanned — **visible
and hidden** — matching text, id, class, `data-action` and `title` against
reject/decline/deny/refuse/return/correction. **Zero** matches. Hidden elements were included
deliberately because this application does park controls in the DOM; the customer review screen's
Reject and Send for Correction are found that way. Vehicle approval has neither, anywhere.

### Impact
An approver faced with something that should not be approved — wrong data, a vehicle that is not
really the customer's, a de-registered vehicle that should never be onboarded — has no way to say
so. This is a plausible part of why **138 vehicles sit at 411**, the oldest since June: nothing ever
leaves the queue except by approval. See also FP-B, which is the same shape.


---

## FP-F — Bulk De-Map opens for a customer admin with no controls at all

| Field | Value |
|---|---|
| **Type** | Bug |
| **Priority** | Low |
| **Component** | Vehicle Management — De-Map Vehicle (Bulk De-Map) |
| **Affects** | `/Vehicle/DeMapVehicle`, `POST /Vehicle/ResolveBulkDemapCustomerScope` |

### Summary
A Customer Admin can open **Bulk De-Map**, and the panel resolves their customer correctly — then
offers no way to do anything. Every control is missing.

### Steps to reproduce
1. Sign in as a Customer Admin (`9200000000`, role Parent Admin).
2. Open **Vehicle Management → De-Map vehicle**.
3. Click **Bulk De-Map**.
4. Wait for the panel to settle (about five seconds) and inspect it.

### Expected
Either the controls needed to do it — Download Template, Upload Excel, Submit — as an officer is
given; or a clear refusal if the role is not meant to bulk de-map.

### Actual
The panel opens and populates. `POST /Vehicle/ResolveBulkDemapCustomerScope` returns:

```json
{"success":true,"data":{"scopeMode":"parent","enteredCustomerId":"NAYAFP1023400246",
 "parentCustomerId":"NAYAFP1023400246","parentBusinessName":"Adhish Singh Gurjar",
 "lockedBranchLocation":"","isOwnerDriver":0}}
```

`#bdCustomerId` is filled and readonly; `#bdCustomerName` reads "Adhish Singh Gurjar". And then:

```
#btnBdDownloadTemplate   ABSENT from the DOM
#btnBdPickExcel          ABSENT from the DOM
#btnBdSubmit             ABSENT from the DOM
#btnBdReset              ABSENT from the DOM
#bdExcelFile             ABSENT from the DOM
```

All five render for a Division Admin on the same screen.

### Evidence
Checked for **presence in the DOM**, not visibility, and after a six-second settle — the officer's
panel populates from that same scope call, so an instant read would catch it mid-render. The
controls are genuinely not created.

The server evidently considers the role in scope, since the scope call answers `success: true`
with `scopeMode: "parent"`.

### Impact
A user reaches a functional-looking screen, sees their own customer correctly identified, and has
nothing to click. If the restriction is intended, the entry point should say so; if it is not, the
capability is missing for every customer admin.
