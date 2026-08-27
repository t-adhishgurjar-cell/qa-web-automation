# Vehicle Management — Automation Coverage

Source of truth for test cases: `test-data/FleetPlusMasterTestCases.xlsx`.
Scope: the 14 screens under **Vehicle Management** in the FleetPlus 3.0 navigation.

## Screen → workbook sheet mapping

| Screen | Workbook sheet | TCs | Marked Automate |
|---|---|---|---|
| Add Vehicles | Single Vehicle Onboarding | 45 | 29 |
| Add Vehicles (bulk) | Bulk Vehicle Onboarding | 23 | 9 |
| Vehicle Approval | Manage Pending Vehicle | 30 | 23 |
| Generic Vehicle Approval | Generic Vehicle & Approval | 26 | 19 |
| Manage Vehicles | Manage Vehicle | 23 | 20 |
| Vehicle Authentication | Vehicle Authentication | 20 | 17 |
| Block/Unblock Vehicle | Vehicle Status(BlockUnblock) | 20 | 19 |
| Set Vehicle Limit | Vehicle Limit | 51 | 25 |
| Set Vehicle Purchase Limit | Vehicle Limit (shared) | — | — |
| Vehicle RO Mapping | Vehicle RO Mapping | 56 | 25 |
| Transfer Vehicle | Vehicle Transfer | 22 | 19 |
| De-map Vehicle | Vehicle Demap | 30 | 14 |

Total: 346 TCs, 219 marked Automate.

## Deferred — no test cases written yet

These three screens exist in the navigation but have no sheet in the workbook.
Test cases need to be authored before they can be automated.

- **View Vehicle Limits Usage**
- **Vehicle Lifecycle** — note: the "Vehicle Lifecycle Report" sheet is a
  different screen, under Reports.
- **View Vehicles** — may be coverable from the Manage Vehicle sheet if it turns
  out to be a read-only variant of Manage Vehicles. Needs confirmation.

## Out of scope for this branch

- **Vehicle Default Limits Update** (31 TCs / 29 Automate). Vehicle-related, but
  the screen lives under Admin, not Vehicle Management.
