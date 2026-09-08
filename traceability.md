# Traceability — FleetPlus UserType × CustomerType matrix

Generated 2026-09-08 04:12:08 UTC
from `FleetPlus_UserType_Matrix_TestCases.xlsx` and the results of the last run.

## Summary

| | Cases |
|---|---|
| In the workbook | 139 |
| Automated | 52 |
| — passed | 52 |
| — failed | 0 |
| — skipped | 0 |
| — of those, known defects held green | 6 |
| Not covered | 87 |

> **Read the pass column carefully.** 6 of the automated cases are marked as expected failures: the application disagrees with the specification, the test asserts the behaviour that actually ships, and so the run stays green. They are confirmed defects, not clean passes. Each is flagged below and listed in full under *Known defects*.

## What this run does not vary

Every case here was executed as **loadtest_006** (user 4108, FP_ADMIN, category Nayara). The suite varies the user type being created and the state of the target mobile, holding the operator constant — so the results are the rules as enforced *for an FP_ADMIN maker*. Whether HO or HO Admin have narrower rights is a separate axis that is never exercised. The procedure does not branch on the caller, so no difference is expected, but that is read from the code rather than measured.

The same account acted as both maker and checker during customer onboarding, which QA permits. Four-eyes separation is therefore not tested by anything here.

## Automated

| TC | Outcome | Scenario |
|---|---|---|
| TC-UAM-001 | pass | Create FP_ADMIN — No existing record — Should be Allowed |
| TC-UAM-002 | pass | Create FP_ADMIN — OD only (CustomerTypeCode=1004) — Should be Allowed |
| TC-UAM-003 | pass | Create FP_ADMIN — Fleet only (CustomerTypeCode=1001) — Should be Blocked |
| TC-UAM-004 | pass | Create FP_ADMIN — Non Fleet (CustomerTypeCode=1002) — Should be Blocked |
| TC-UAM-005 | pass | Create FP_ADMIN — Corporate (CustomerTypeCode=1006) — Should be Blocked |
| TC-UAM-006 | pass | Create FP_ADMIN — OD + non-OD mixed — Should be Blocked |
| TC-UAM-007 | pass | Create FP_ADMIN — Existing RO user in Users table — Should be Blocked |
| TC-UAM-008 | pass | Create FP_ADMIN — Existing OTHER_RO user — Should be Blocked |
| TC-UAM-009 | pass | Create FP_ADMIN — Existing admin/system user — Should be Blocked |
| TC-UAM-010 | pass | Create HO_ADMIN — No existing record — Should be Allowed |
| TC-UAM-011 | pass | Create HO_ADMIN — OD only (CustomerTypeCode=1004) — Should be Allowed |
| TC-UAM-012 | pass | Create HO_ADMIN — Fleet only (CustomerTypeCode=1001) — Should be Blocked |
| TC-UAM-013 | pass | Create HO_ADMIN — Non Fleet (CustomerTypeCode=1002) — Should be Blocked |
| TC-UAM-014 | pass | Create HO_ADMIN — Corporate (CustomerTypeCode=1006) — Should be Blocked |
| TC-UAM-015 | pass | Create HO_ADMIN — OD + non-OD mixed — Should be Blocked |
| TC-UAM-016 | pass | Create HO_ADMIN — Existing RO user in Users table — Should be Blocked |
| TC-UAM-017 | pass | Create HO_ADMIN — Existing OTHER_RO user — Should be Blocked |
| TC-UAM-018 | pass | Create HO_ADMIN — Existing admin/system user — Should be Blocked |
| TC-UAM-019 | pass | Create HO — No existing record — Should be Allowed |
| TC-UAM-020 | pass | Create HO — OD only (CustomerTypeCode=1004) — Should be Allowed |
| TC-UAM-021 | pass | Create HO — Fleet only (CustomerTypeCode=1001) — Should be Blocked |
| TC-UAM-022 | pass | Create HO — Non Fleet (CustomerTypeCode=1002) — Should be Blocked |
| TC-UAM-023 | pass | Create HO — Corporate (CustomerTypeCode=1006) — Should be Blocked |
| TC-UAM-024 | pass | Create HO — OD + non-OD mixed — Should be Blocked |
| TC-UAM-025 | pass | Create HO — Existing RO user in Users table — Should be Blocked |
| TC-UAM-026 | pass | Create HO — Existing OTHER_RO user — Should be Blocked |
| TC-UAM-027 | pass | Create HO — Existing admin/system user — Should be Blocked |
| TC-UAM-064 | pass | Create OTHER_NAYARA — No existing record — Should be Allowed |
| TC-UAM-065 | pass | Create OTHER_NAYARA — OD only (CustomerTypeCode=1004) — Should be Allowed |
| TC-UAM-066 | pass | Create OTHER_NAYARA — Fleet only (CustomerTypeCode=1001) — Should be Blocked |
| TC-UAM-067 | pass | Create OTHER_NAYARA — Non Fleet (CustomerTypeCode=1002) — Should be Blocked |
| TC-UAM-068 | pass | Create OTHER_NAYARA — Corporate (CustomerTypeCode=1006) — Should be Blocked |
| TC-UAM-069 | pass | Create OTHER_NAYARA — OD + non-OD mixed — Should be Blocked |
| TC-UAM-070 | pass | Create OTHER_NAYARA — Existing RO user in Users table — Should be Blocked |
| TC-UAM-071 | pass | Create OTHER_NAYARA — Existing OTHER_RO user — Should be Blocked |
| TC-UAM-072 | pass | Create OTHER_NAYARA — Existing admin/system user — Should be Blocked |
| TC-UAM-073 | pass | Create OTHER_NON — No existing record — Should be Allowed |
| TC-UAM-074 | pass | Create OTHER_NON — OD only (CustomerTypeCode=1004) — Should be Allowed |
| TC-UAM-075 | pass (known defect) | Create OTHER_NON — Fleet only (CustomerTypeCode=1001) — Should be Allowed |
| TC-UAM-076 | pass (known defect) | Create OTHER_NON — Non Fleet (CustomerTypeCode=1002) — Should be Allowed |
| TC-UAM-077 | pass (known defect) | Create OTHER_NON — Corporate (CustomerTypeCode=1006) — Should be Allowed |
| TC-UAM-078 | pass (known defect) | Create OTHER_NON — OD + non-OD mixed — Should be Allowed |
| TC-UAM-079 | pass | Create OTHER_NON — Existing RO user in Users table — Should be Blocked |
| TC-UAM-080 | pass | Create OTHER_NON — Existing OTHER_RO user — Should be Blocked |
| TC-UAM-081 | pass | Create OTHER_NON — Existing admin/system user — Should be Blocked |
| TC-UAM-EC-002 | pass | Create user with mobile = "  9876543210  " (spaces) |
| TC-UAM-EC-004 | pass | Create user with 9-digit mobile number |
| TC-UAM-EC-005 | pass | Create user with 11-digit mobile number |
| TC-UAM-EC-006 | pass (known defect) | Create FP_ADMIN where mobile has inactive Fleet CustomerMaster record |
| TC-UAM-EC-008 | pass (known defect) | Create FP_ADMIN where mobile has OD (active) + Fleet (inactive) |
| TC-UAM-EC-012 | pass | Create FP_ADMIN where mobile has OD + Fleet + Corporate CM records |
| TC-UAM-EC-015 | pass | Create FP_ADMIN where mobile already has an active FP_ADMIN user |

## Known defects

Cases where the application and the specification disagree. The test records what the application does, so these turn red if the defect is ever fixed — which is the signal to revisit them.

**Scope of the CustomerMaster defect.** Comparing the specification against the procedure across the whole 117-cell matrix predicts 20 affected cells, but only the 4 listed below were measured. The other 16 belong to CUSTOMER_PARENT_USER, CUSTOMER_CHILD_USER, RO and OTHER_RO — user types Add User cannot create, reachable only through the customer-admin flow and the RO onboarding API. They run through the same unguarded check and are expected to behave identically, but that expectation is inferred from reading the procedure, not observed. Treat 4 as verified and 16 as predicted.

| TC | Defect |
|---|---|
| TC-UAM-075 | usp_AddUser’s CustomerMaster check has no user-type guard, so a customer record blocks user types the specification permits. |
| TC-UAM-076 | usp_AddUser’s CustomerMaster check has no user-type guard, so a customer record blocks user types the specification permits. |
| TC-UAM-077 | usp_AddUser’s CustomerMaster check has no user-type guard, so a customer record blocks user types the specification permits. |
| TC-UAM-078 | usp_AddUser’s CustomerMaster check has no user-type guard, so a customer record blocks user types the specification permits. |
| TC-UAM-EC-006 | usp_AddUser accepts status 104 (Inactive) as blocking, so a deactivated customer never releases its mobile number. Confirmed against mobile 6000000145 / customer NAYAFP2107000197. |
| TC-UAM-EC-008 | Same defect as EC-006, measured on a fixture built for it: mobile 9876896688 carries an Active OD (NAYAFP3013400036) beside an Inactive Fleet record (NAYAFP2023400019), and Add User was still refused. The OD exemption does not release a mobile — an inactive non-OD record blocks on its own. |

## Findings outside the workbook

Defects found while building test data rather than while executing a case. No workbook row covers them, so they are recorded here or not at all.

**Add Customer and Add User disagree about the same mobile number**

On 9876896688 — whose only record was an inactive Fleet customer — Add Customer accepted the number for a new OD, sent its OTP, and completed onboarding through approval. Add User refuses that same number with "This mobile number is already registered." Whichever rule is correct, the two screens do not share it, so a number can take a new customer but not a new user.

## Not covered, and why

| TC | Reason |
|---|---|
| TC-UAM-028 | REGION_ADMIN is created by Office API, not by Add User. Out of scope for this signoff. |
| TC-UAM-029 | REGION_ADMIN is created by Office API, not by Add User. Out of scope for this signoff. |
| TC-UAM-030 | REGION_ADMIN is created by Office API, not by Add User. Out of scope for this signoff. |
| TC-UAM-031 | REGION_ADMIN is created by Office API, not by Add User. Out of scope for this signoff. |
| TC-UAM-032 | REGION_ADMIN is created by Office API, not by Add User. Out of scope for this signoff. |
| TC-UAM-033 | REGION_ADMIN is created by Office API, not by Add User. Out of scope for this signoff. |
| TC-UAM-034 | REGION_ADMIN is created by Office API, not by Add User. Out of scope for this signoff. |
| TC-UAM-035 | REGION_ADMIN is created by Office API, not by Add User. Out of scope for this signoff. |
| TC-UAM-036 | REGION_ADMIN is created by Office API, not by Add User. Out of scope for this signoff. |
| TC-UAM-037 | STATE_ADMIN is created by Office API, not by Add User. Out of scope for this signoff. |
| TC-UAM-038 | STATE_ADMIN is created by Office API, not by Add User. Out of scope for this signoff. |
| TC-UAM-039 | STATE_ADMIN is created by Office API, not by Add User. Out of scope for this signoff. |
| TC-UAM-040 | STATE_ADMIN is created by Office API, not by Add User. Out of scope for this signoff. |
| TC-UAM-041 | STATE_ADMIN is created by Office API, not by Add User. Out of scope for this signoff. |
| TC-UAM-042 | STATE_ADMIN is created by Office API, not by Add User. Out of scope for this signoff. |
| TC-UAM-043 | STATE_ADMIN is created by Office API, not by Add User. Out of scope for this signoff. |
| TC-UAM-044 | STATE_ADMIN is created by Office API, not by Add User. Out of scope for this signoff. |
| TC-UAM-045 | STATE_ADMIN is created by Office API, not by Add User. Out of scope for this signoff. |
| TC-UAM-046 | DIVISION_ADMIN is created by Office API, not by Add User. Out of scope for this signoff. |
| TC-UAM-047 | DIVISION_ADMIN is created by Office API, not by Add User. Out of scope for this signoff. |
| TC-UAM-048 | DIVISION_ADMIN is created by Office API, not by Add User. Out of scope for this signoff. |
| TC-UAM-049 | DIVISION_ADMIN is created by Office API, not by Add User. Out of scope for this signoff. |
| TC-UAM-050 | DIVISION_ADMIN is created by Office API, not by Add User. Out of scope for this signoff. |
| TC-UAM-051 | DIVISION_ADMIN is created by Office API, not by Add User. Out of scope for this signoff. |
| TC-UAM-052 | DIVISION_ADMIN is created by Office API, not by Add User. Out of scope for this signoff. |
| TC-UAM-053 | DIVISION_ADMIN is created by Office API, not by Add User. Out of scope for this signoff. |
| TC-UAM-054 | DIVISION_ADMIN is created by Office API, not by Add User. Out of scope for this signoff. |
| TC-UAM-055 | TERRITORY_ADMIN is created by RO onboarding API, not by Add User. Out of scope for this signoff. |
| TC-UAM-056 | TERRITORY_ADMIN is created by RO onboarding API, not by Add User. Out of scope for this signoff. |
| TC-UAM-057 | TERRITORY_ADMIN is created by RO onboarding API, not by Add User. Out of scope for this signoff. |
| TC-UAM-058 | TERRITORY_ADMIN is created by RO onboarding API, not by Add User. Out of scope for this signoff. |
| TC-UAM-059 | TERRITORY_ADMIN is created by RO onboarding API, not by Add User. Out of scope for this signoff. |
| TC-UAM-060 | TERRITORY_ADMIN is created by RO onboarding API, not by Add User. Out of scope for this signoff. |
| TC-UAM-061 | TERRITORY_ADMIN is created by RO onboarding API, not by Add User. Out of scope for this signoff. |
| TC-UAM-062 | TERRITORY_ADMIN is created by RO onboarding API, not by Add User. Out of scope for this signoff. |
| TC-UAM-063 | TERRITORY_ADMIN is created by RO onboarding API, not by Add User. Out of scope for this signoff. |
| TC-UAM-082 | CUSTOMER_PARENT_USER is created by Customer Admin's portal, not by Add User. Out of scope for this signoff. |
| TC-UAM-083 | CUSTOMER_PARENT_USER is created by Customer Admin's portal, not by Add User. Out of scope for this signoff. |
| TC-UAM-084 | CUSTOMER_PARENT_USER is created by Customer Admin's portal, not by Add User. Out of scope for this signoff. |
| TC-UAM-085 | CUSTOMER_PARENT_USER is created by Customer Admin's portal, not by Add User. Out of scope for this signoff. |
| TC-UAM-086 | CUSTOMER_PARENT_USER is created by Customer Admin's portal, not by Add User. Out of scope for this signoff. |
| TC-UAM-087 | CUSTOMER_PARENT_USER is created by Customer Admin's portal, not by Add User. Out of scope for this signoff. |
| TC-UAM-088 | CUSTOMER_PARENT_USER is created by Customer Admin's portal, not by Add User. Out of scope for this signoff. |
| TC-UAM-089 | CUSTOMER_PARENT_USER is created by Customer Admin's portal, not by Add User. Out of scope for this signoff. |
| TC-UAM-090 | CUSTOMER_PARENT_USER is created by Customer Admin's portal, not by Add User. Out of scope for this signoff. |
| TC-UAM-091 | CUSTOMER_CHILD_USER is created by Customer Admin's portal, not by Add User. Out of scope for this signoff. |
| TC-UAM-092 | CUSTOMER_CHILD_USER is created by Customer Admin's portal, not by Add User. Out of scope for this signoff. |
| TC-UAM-093 | CUSTOMER_CHILD_USER is created by Customer Admin's portal, not by Add User. Out of scope for this signoff. |
| TC-UAM-094 | CUSTOMER_CHILD_USER is created by Customer Admin's portal, not by Add User. Out of scope for this signoff. |
| TC-UAM-095 | CUSTOMER_CHILD_USER is created by Customer Admin's portal, not by Add User. Out of scope for this signoff. |
| TC-UAM-096 | CUSTOMER_CHILD_USER is created by Customer Admin's portal, not by Add User. Out of scope for this signoff. |
| TC-UAM-097 | CUSTOMER_CHILD_USER is created by Customer Admin's portal, not by Add User. Out of scope for this signoff. |
| TC-UAM-098 | CUSTOMER_CHILD_USER is created by Customer Admin's portal, not by Add User. Out of scope for this signoff. |
| TC-UAM-099 | CUSTOMER_CHILD_USER is created by Customer Admin's portal, not by Add User. Out of scope for this signoff. |
| TC-UAM-100 | RO is created by RO onboarding API, not by Add User. Out of scope for this signoff. |
| TC-UAM-101 | RO is created by RO onboarding API, not by Add User. Out of scope for this signoff. |
| TC-UAM-102 | RO is created by RO onboarding API, not by Add User. Out of scope for this signoff. |
| TC-UAM-103 | RO is created by RO onboarding API, not by Add User. Out of scope for this signoff. |
| TC-UAM-104 | RO is created by RO onboarding API, not by Add User. Out of scope for this signoff. |
| TC-UAM-105 | RO is created by RO onboarding API, not by Add User. Out of scope for this signoff. |
| TC-UAM-106 | RO is created by RO onboarding API, not by Add User. Out of scope for this signoff. |
| TC-UAM-107 | RO is created by RO onboarding API, not by Add User. Out of scope for this signoff. |
| TC-UAM-108 | RO is created by RO onboarding API, not by Add User. Out of scope for this signoff. |
| TC-UAM-109 | OTHER_RO is created by RO onboarding API (unconfirmed), not by Add User. Out of scope for this signoff. |
| TC-UAM-110 | OTHER_RO is created by RO onboarding API (unconfirmed), not by Add User. Out of scope for this signoff. |
| TC-UAM-111 | OTHER_RO is created by RO onboarding API (unconfirmed), not by Add User. Out of scope for this signoff. |
| TC-UAM-112 | OTHER_RO is created by RO onboarding API (unconfirmed), not by Add User. Out of scope for this signoff. |
| TC-UAM-113 | OTHER_RO is created by RO onboarding API (unconfirmed), not by Add User. Out of scope for this signoff. |
| TC-UAM-114 | OTHER_RO is created by RO onboarding API (unconfirmed), not by Add User. Out of scope for this signoff. |
| TC-UAM-115 | OTHER_RO is created by RO onboarding API (unconfirmed), not by Add User. Out of scope for this signoff. |
| TC-UAM-116 | OTHER_RO is created by RO onboarding API (unconfirmed), not by Add User. Out of scope for this signoff. |
| TC-UAM-117 | OTHER_RO is created by RO onboarding API (unconfirmed), not by Add User. Out of scope for this signoff. |
| TC-UAM-EC-001 | No test attempted this case, and no exclusion has been recorded for it. |
| TC-UAM-EC-003 | No test attempted this case, and no exclusion has been recorded for it. |
| TC-UAM-EC-007 | Needs a user type Add User does not offer, or a direct call to the procedure. Covered once the Office and RO onboarding APIs are available. |
| TC-UAM-EC-009 | Needs two concurrent usp_AddUser calls. The database connection is read-only by design, so the procedure cannot be invoked directly. |
| TC-UAM-EC-010 | Needs two concurrent usp_AddUser calls. The database connection is read-only by design, so the procedure cannot be invoked directly. |
| TC-UAM-EC-011 | Needs a user type Add User does not offer, or a direct call to the procedure. Covered once the Office and RO onboarding APIs are available. |
| TC-UAM-EC-013 | No test attempted this case, and no exclusion has been recorded for it. |
| TC-UAM-EC-014 | No test attempted this case, and no exclusion has been recorded for it. |
| TC-UAM-EC-016 | Needs a user type Add User does not offer, or a direct call to the procedure. Covered once the Office and RO onboarding APIs are available. |
| TC-UAM-EC-017 | Needs a user type Add User does not offer, or a direct call to the procedure. Covered once the Office and RO onboarding APIs are available. |
| TC-UAM-EC-018 | Needs a failure injected mid-transaction. Not reachable from the UI, and not reachable read-only. |
| TC-UAM-EC-019 | Needs a user type Add User does not offer, or a direct call to the procedure. Covered once the Office and RO onboarding APIs are available. |
| TC-UAM-EC-020 | No test attempted this case, and no exclusion has been recorded for it. |
| TC-UAM-EC-021 | No test attempted this case, and no exclusion has been recorded for it. |
| TC-UAM-EC-022 | No test attempted this case, and no exclusion has been recorded for it. |
