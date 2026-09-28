# 06 — Users, roles and access control

Screens: Manage Users (`/User/UserDetails`), View Purchase OTP (`/User/UserOtpLog`),
Manage Roles (`/Security/ManageRole`), Manage Mobile Roles (`/Security/ManageMobileRoles`),
Manage RO Users (`/RetailOutlet/ManageROUsers`), Manage Customer Users — covered in module 04.

Everything that creates a user goes through `usp_AddUser`, so its rules appear on every screen in
this module. What follows is what that procedure does, stated once, so the cases below can refer
to it rather than repeat it.

---

## The rules every user-creating screen inherits

**One conflict check, three arms.** A new user is refused if its mobile matches any of:

1. **A non-OD customer** at status 101 or 104. Note 104 — a *deactivated* customer still blocks.
   OD (type 1004) is excluded, so an OD customer's mobile is free.
2. **An active retail outlet** (`ROStatus = 201`), on either of its two mobile columns.
3. **An existing user** of a blocking type: FP_ADMIN, HO_ADMIN, HO, REGION_ADMIN, STATE_ADMIN,
   DIVISION_ADMIN, TERRITORY_ADMIN, OTHER_NAYARA, OTHER_NON, RO, OTHER_RO. **No `IsActive` filter**
   — a disabled user still blocks its mobile. 44 mobiles are currently unusable for this reason.

**The check has no user-type guard.** Its ticket (NFP-1694) describes it as blocking
"Nayara/system-type" creation, but the implementation applies it to every type. That is the
20-cell disagreement in the automated matrix, and the cases below assert the specified behaviour,
not the coded one.

**Three things the procedure does not do.** It never writes `UserLocationMapping` — both insert
blocks are commented out — and `@SelectedLocations` is accepted and discarded. So a user created
here has **no region, state or division**, whatever the screen sent. It also inherits the password:
`IsParentUser` is 0 whenever the mobile already exists, and the hash is taken from the existing
row.

---

## Manage Users — `/User/UserDetails`

| ID | Pri | Case | Expected |
|---|---|---|---|
| REG-UA-01 | P1 | Opens and lists users for an entitled role | Grid renders with name, mobile, type, status |
| REG-UA-02 | P1 | Which user types the screen offers | A short list — FP_ADMIN, HO_ADMIN, HO, OTHER_NON, OTHER_NAYARA. Record it; the procedure itself accepts any type, so the restriction is the screen's |
| REG-UA-03 | P0 | Create a user with a fresh mobile | Created; confirm `Users`, `UserProfiles` (status 301) and `UserRoleMappings` rows |
| REG-UA-04 | P0 | **The created user has no location mapping** | No `UserLocationMapping` row. Assert it deliberately — a future change that starts writing one must be noticed, because it would change who sees what |
| REG-UA-05 | P0 | That user signs in and opens a location-scoped screen | It sees nothing, because it has no scope. Record it as the expected consequence of REG-UA-04 |
| REG-UA-06 | P0 | Create a user on a mobile held by a Fleet customer | Refused: "This mobile number is already registered." |
| REG-UA-07 | P1 | Same, where the customer is **inactive** (104) | Still refused |
| REG-UA-08 | P1 | Same, where the customer is **OD** | **Allowed** — the OD exclusion |
| REG-UA-09 | P1 | Create a user on a mobile held by an active RO | Refused |
| REG-UA-10 | P0 | Create a user on a mobile held by a **disabled** admin user | Refused. 44 mobiles are in this state and cannot be reused without a database change |
| REG-UA-11 | P1 | Create a second user of the **same type** on one mobile | Refused: "User Already Exists for this mobile number with same user Type" — for the five legacy types only |
| REG-UA-12 | P1 | Create a second user of a **different** type on one mobile | Allowed, and it **inherits the first user's password**. Confirm the hashes match |
| REG-UA-13 | P0 | Change that shared password | Every row on the mobile changes. Security-relevant: disabling one row revokes nothing |
| REG-UA-14 | P1 | Deactivate a user | Cannot sign in; its mobile still blocked |
| REG-UA-15 | P1 | Edit a user's name, email, roles | Saved; roles take effect on next sign-in |
| REG-UA-16 | P2 | Search and filter the user list | Filters correctly |
| REG-UA-17 | P2 | Export | Matches the grid |

---

## Officer creation — the Office API path

Officers cannot be created usefully through Manage Users, because that path writes no location
mapping. They come from the Office API, which writes all four tables.

| ID | Pri | Case | Expected |
|---|---|---|---|
| REG-UA-18 | P0 | Create a REGION_ADMIN against a ZONE node | `UserLocationMapping` has `RegionId` only |
| REG-UA-19 | P0 | Create a STATE_ADMIN against a State node | `RegionId` + `BusinessStateId`. The node is the `StateNodeMapping.ShNodeId` — `BSTGUJ1`, not the name `GJ_I` |
| REG-UA-20 | P0 | Create a DIVISION_ADMIN against a DIVISION node | All three columns. The node is `DivisionMaster.DMId` — `DOAHMEDA2` for Ahmedabad II |
| REG-UA-21 | P0 | Create against a node that does not exist | Refused. **Read `data[].Message`** — the response's top level says `Success: 1, "Success"` even when nothing was created |
| REG-UA-22 | P0 | Ask for a TERRITORY node | Refused: "Invalid nodeType". A TSM cannot be created this way — the API knows only ZONE, State and DIVISION |
| REG-UA-23 | P1 | Verify every created officer against the database | Scope columns must match the node. A user created against the wrong node looks fine in the response and is worse than one not created at all |

---

## Existing officers who have never signed in

| ID | Pri | Case | Expected |
|---|---|---|---|
| REG-UA-24 | P1 | An officer with no `UserAuthStatus` row | Exists in the directory and cannot sign in. Every TERRITORY_ADMIN in GJ_I was in this state |
| REG-UA-25 | P1 | Activate one via Forgot Password | Issues a temporary password and creates the `UserAuthStatus` row. This is the only route in |
| REG-UA-26 | P1 | The reset SMS wording | "your temporary FLEETPLUS account password is …" — different from the activation wording "Temporary Password:  …". Anything parsing these must read both |

---

## Roles and entitlement

| ID | Pri | Case | Expected |
|---|---|---|---|
| REG-UA-27 | P0 | Manage Roles opens; a role's menu set can be read | Renders |
| REG-UA-28 | P0 | Grant a menu to a role, then sign in as it | The menu appears |
| REG-UA-29 | P0 | Revoke a menu, then sign in | Gone from the sidebar **and** refused by direct URL. The second half is the one that matters |
| REG-UA-30 | P0 | Every role's sidebar matches `RoleMenuMappings` | Nothing missing, nothing extra. Extra is the access-control defect |
| REG-UA-31 | P1 | Manage Mobile Roles | Mobile entitlement is separate from web; changing one does not change the other |
| REG-UA-32 | P1 | Create a role with no menus | Signs in and sees an empty but functional shell, not an error |
| REG-UA-33 | P2 | Delete or deactivate a role in use | Refused, or its users lose the entitlement — record which |

---

## The UserType × CustomerType matrix

117 cells, automated in `tests/user-management/matrix-add-user.spec.ts` and siblings. For manual
execution, spot-check the cells that disagree.

| ID | Pri | Case | Expected |
|---|---|---|---|
| REG-UA-34 | P0 | A Nayara-type user on a non-OD customer's mobile | Refused. Spec and code agree |
| REG-UA-35 | P0 | A **Customer**-type user on a non-OD customer's mobile | **Spec says allowed; the code refuses.** This is the disagreement — 20 of the 117 cells. Record the actual result |
| REG-UA-36 | P1 | Any type on an OD-only mobile | Allowed |
| REG-UA-37 | P1 | Any type on a mobile with no existing record | Allowed |
| REG-UA-38 | P1 | The two customer-hierarchy rows, since the 22 Sep caps | A refusal may now be the cap rather than the conflict check. **Read the message** — they are indistinguishable otherwise, and the automated matrix does not yet separate them |

---

## View Purchase OTP

| ID | Pri | Case | Expected |
|---|---|---|---|
| REG-UA-39 | P1 | The OTP log lists purchase OTPs for a customer | Renders; entries match `UserSMSLog` |
| REG-UA-40 | P0 | Scope: an officer sees only OTPs within their hierarchy | Confirm. This screen exposes credentials-adjacent data and is worth checking carefully |
