# usp_AddUser — what the change history says, and what the body does

Source supplied 24 September 2026. `sys.objects` gives create and modify dates both as
**2026-09-22 16:08:40**, so it is dropped and recreated on each deploy and only the
newest change is visible from the catalogue — the header comments are the only record of
the earlier ones.

This suite's read-only login cannot see procedure bodies
(`HAS_PERMS_BY_NAME(...,'VIEW DEFINITION') = 0`), so everything below is the supplied
text read against measurements of the live database, not a second reading of the source.

---

## The four documented rounds

### 1. Rudra — 29 June 2026

| Claim | In the body? |
|---|---|
| `OTHER_RO`: call `usp_ValidateMobileForROUser` before creation | **yes** |
| `PasswordHash` inherited from parent user when `IsParentUser = 0` | **yes** |
| `IsParentUser` strictly 0 if mobile exists, else 1 | **yes** |
| `IsSystemUser` set for any admin/system `UserTypeCode` | **yes** |

### 2. Shreyansh Rai — 3 September 2026

| Claim | In the body? |
|---|---|
| **NFP-1683** — `IsSystemUser` expanded to all eight admin codes | **yes** |
| **NFP-1694** — add `RO` and `OTHER_RO` to the existing-user mobile conflict check | **yes**, via `BlocksMobileReuse = 1` |
| **NFP-1694** — block **Nayara/system-type** creation on a non-OD customer's mobile | **no — the guard is missing.** See below |
| Lists declared once in `@TypeCodeRules` | **yes** |
| "Business behavior UNCHANGED — same codes, same outcomes" | **unverifiable** without the prior version |
| Three `EXISTS` replaced by one `UNION`, "better performance" | present, but see below |

### 3. Rudra — 7 September 2026

| Claim | In the body? |
|---|---|
| `UserProfiles.UserCode` takes whichever of `@CMSCode` / `@CustomerId` is supplied, `''` counting as not supplied | **partly** — see below |
| Re-enabled `usp_ValidateMobileForROUser` and `usp_ValidateMobileForCustomerUser` | **yes**, both passed the resolved code |

### 4. Unattributed — 22 September 2026 (the currently deployed change)

| Claim | In the body? |
|---|---|
| Hard caps per parent/branch `UserCode` from `ConfigurationMaster` | **yes** |
| Inactive rows count toward the limit | **yes** — the count filters neither `StatusFlag` nor `IsActive` |
| Missing or invalid config fails the create | **yes** |
| Applies to all creators including FP | **yes** — no creator exemption anywhere |

Measured in QA: both keys exist and parse — `MaxCustomerParentUsersAllowed` = 2,
`MaxCustomerBranchUsersAllowed` = 2 — and **16 customer codes already hold two or more
parent users, 8 hold two or more branch users**. Creating either type against those
customers now fails with "Maximum of 2 … allowed" where it previously succeeded. This is
the change that is actually live, and it is the one most likely to surprise someone.

---

## Where the body and the header disagree

### The NFP-1694 guard does not exist
The procedure computes

```sql
DECLARE @IsCurrentTypeSystemType BIT = CASE WHEN EXISTS (
    SELECT 1 FROM @TypeCodeRules WHERE Code = @UserTypeCode AND IsSystemType = 1)
  THEN 1 ELSE 0 END;
```

and then uses it for exactly one thing — `DECLARE @IsSystemUser BIT = @IsCurrentTypeSystemType`,
which sets a column on the inserted row. The mobile-conflict `UNION` that decides whether
creation is allowed **never references it**. So the CustomerMaster arm refuses *every*
user type on a non-OD customer's mobile, not the eight the ticket describes.

This is the whole of the 20-cell disagreement recorded in
`src/data/usertype-matrix.data.ts`, and it means the workbook is right and the code is
broader than its own stated intent. It is a one-line fix — the arm needs
`AND @IsCurrentTypeSystemType = 1` — which is worth knowing before anyone re-specifies
the matrix to match the code.

### `UserCode` stores `''` where the note says "not supplied"
`@MappingUserCode` correctly treats `''` as absent:

```sql
DECLARE @MappingUserCode VARCHAR(20) = COALESCE(
    NULLIF(LTRIM(RTRIM(@CMSCode)), ''), NULLIF(LTRIM(RTRIM(@CustomerId)), ''));
```

but the insert falls back past it:

```sql
COALESCE(@MappingUserCode, ISNULL(@CMSCode, @CustomerId))
```

When neither code is supplied, callers send `''` rather than NULL — which is the premise
of the whole change — so `@MappingUserCode` is NULL and the fallback yields `''`. The
column gets an empty string, not NULL. Every later lookup does
`LTRIM(RTRIM(up.UserCode)) = LTRIM(RTRIM(@MappingUserCode))`, so this does not break the
cap counting, but it does mean "no mapping code" is stored two different ways depending
on the path.

### The performance claim is the wrong way round
Three `EXISTS` checks short-circuit: the first match ends the work. The replacement is

```sql
DECLARE @MobileConflict INT = (SELECT COUNT(*) FROM ( ... UNION ALL ... UNION ALL ... ))
```

`COUNT(*)` cannot stop early — it evaluates all three arms every time, including two
that are irrelevant once the first has matched. For the common case, one round trip
instead of three but strictly more work inside it. `EXISTS (SELECT 1 FROM (...) )` would
have kept the single round trip *and* the short-circuit.

---

## In the body, absent from the history

### `@SelectedLocations` is accepted and never used
The parameter is declared — `@SelectedLocations VARCHAR(1000) = NULL` — and appears
nowhere else in the procedure. `@SelectedRoles` is split and inserted into
`UserRoleMappings`; its sibling is silently discarded.

### `UserLocationMapping` is never written
Both insert blocks for it are commented out — the `@CMSCode` branch and the `@CustomerId`
branch. Taken with the dead parameter above, a user created through this procedure has
**no region, state or division at all**, and the caller gets no indication that the
locations it sent were ignored.

Consequences worth holding on to:

- An officer cannot be created through this path in a usable state; that is what the
  Office API is for, and it writes the mapping itself.
- Creating a `TERRITORY_ADMIN` here would produce a TSM with no division — no use for a
  division-scoped queue, which is the only thing a TSM is for.
- Neither block is mentioned in any change note, so whether this is deliberate or a
  disable-and-forget is not recoverable from the source.

### A new refusal the 22/09 note does not mention
For `CUSTOMER_PARENT_USER` and `CUSTOMER_CHILD_USER`, a missing mapping code now fails
with "Customer ID is required to create this user type." before the cap is even read.

### OD customers never block a mobile
The CustomerMaster arm excludes `CustomerTypeCode <> 1004`, so an OD customer's mobile
does not block new user creation while a Fleet, Non Fleet or Corporate one does. That
exemption predates the OD division change and is unrelated to it, but it is the reason
the matrix has an "OD only" column that expects success.

---

## Verified against the live database

| Claim in the source | Check |
|---|---|
| CustomerMaster arm takes `Status IN (101, 104)` | 104 is Inactive, so a deactivated non-OD customer still blocks. NAYAFP2023400019 (9876896688) and four others sit at 104 |
| Users arm has no `IsActive` filter | Users 7 (STATE_ADMIN), 207 (HO_ADMIN), 293 (FP_ADMIN) are `IsActive = 0` and would still block |
| Caps are read from `ConfigurationMaster` | Both keys present, `StatusFlag = 1`, value 2, parse as int |
| Inactive rows count toward the cap | 16 parent codes and 8 branch codes already at or over it |

`tools/probe-add-user-sp-claims.spec.ts` re-runs all four.
