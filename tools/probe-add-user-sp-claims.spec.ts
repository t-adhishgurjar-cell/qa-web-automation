import { test } from '../src/fixtures/page.fixtures';

/**
 * Checks the claims in usp_AddUser's source against the data it runs on.
 *
 * The procedure body is now known. Three things in it are worth verifying against the
 * environment rather than taken on trust:
 *
 *   1. The 22/09 change added hard caps for CUSTOMER_PARENT_USER and CUSTOMER_CHILD_USER,
 *      read from dbo.ConfigurationMaster, and "Missing / invalid config fails create". So
 *      if those two keys are absent or unparseable, creating either type fails outright
 *      for every caller including FP. That is worth knowing before a suite blames itself.
 *
 *   2. Its mobile-conflict check counts CustomerMaster rows with Status IN (101, 104) —
 *      104 being Inactive. So a deactivated non-OD customer still blocks a new user on
 *      that mobile. The repo's BLOCKING_CUSTOMER_STATUSES already says 101 and 104; this
 *      confirms where that came from.
 *
 *   3. Check 3 joins dbo.Users with no IsActive or StatusFlag filter, so a *disabled* user
 *      of a blocking type still blocks mobile reuse.
 *
 *   TOOLS=true ENV=qa npx playwright test --project=tools --grep "probe add user sp claims"
 */

test.describe('Tools — probes @tools', () => {
  test('probe add user sp claims', async ({ db }) => {
    const show = (title: string, rows: unknown[]) => {
      console.log(`\n--- ${title} (${rows.length}) ---`);
      for (const row of rows.slice(0, 20)) console.log('  ' + JSON.stringify(row));
      if (!rows.length) console.log('  (none)');
    };

    show('the two cap keys the 22/09 change requires', await db.query(`
      SELECT KeyName, KeyValue, StatusFlag,
             TRY_CAST(NULLIF(LTRIM(RTRIM(KeyValue)), '') AS INT) AS parsesAsInt
      FROM dbo.ConfigurationMaster
      WHERE KeyName IN ('MaxCustomerParentUsersAllowed', 'MaxCustomerBranchUsersAllowed')`));

    show('how many customers are already at or over those caps', await db.query(`
      WITH caps AS (
        SELECT KeyName, TRY_CAST(NULLIF(LTRIM(RTRIM(KeyValue)), '') AS INT) AS cap
        FROM dbo.ConfigurationMaster
        WHERE KeyName IN ('MaxCustomerParentUsersAllowed', 'MaxCustomerBranchUsersAllowed')
          AND ISNULL(StatusFlag, 1) = 1
      ),
      counts AS (
        SELECT LTRIM(RTRIM(up.UserCode)) AS userCode, ut.Code AS userTypeCode, COUNT(1) AS held
        FROM dbo.UserProfiles up
        JOIN dbo.Users u ON u.Id = up.UserId
        JOIN dbo.UserTypesMaster ut ON ut.Id = u.UserTypeId
        WHERE ut.Code IN ('CUSTOMER_PARENT_USER', 'CUSTOMER_CHILD_USER')
        GROUP BY LTRIM(RTRIM(up.UserCode)), ut.Code
      )
      SELECT c.userTypeCode, MIN(caps.cap) AS cap, COUNT(*) AS codesAtOrOverCap
      FROM counts c
      CROSS JOIN caps
      WHERE caps.KeyName = CASE WHEN c.userTypeCode = 'CUSTOMER_PARENT_USER'
                               THEN 'MaxCustomerParentUsersAllowed'
                               ELSE 'MaxCustomerBranchUsersAllowed' END
        AND c.held >= caps.cap
      GROUP BY c.userTypeCode`));

    show('inactive non-OD customers whose mobile would still be blocked (status 104)', await db.query(`
      SELECT TOP 5 cm.CustomerID, cm.MobileNo, cm.Status, ctm.CustomerTypeName
      FROM dbo.CustomerMaster cm
      JOIN dbo.CustomerTypeMaster ctm ON ctm.Id = cm.CustomerType AND ctm.StatusFlag = 1
      WHERE cm.StatusFlag = 1 AND cm.Status = 104 AND ctm.CustomerTypeCode <> 1004`));

    show('disabled users of a blocking type, which still block mobile reuse', await db.query(`
      SELECT TOP 5 u.Id, u.UserName, ut.Code AS userTypeCode, u.IsActive
      FROM dbo.Users u
      JOIN dbo.UserTypesMaster ut ON ut.Id = u.UserTypeId
      WHERE u.IsActive = 0
        AND ut.Code IN ('FP_ADMIN','HO_ADMIN','HO','REGION_ADMIN','STATE_ADMIN',
                        'DIVISION_ADMIN','TERRITORY_ADMIN','OTHER_NAYARA','OTHER_NON','RO','OTHER_RO')`));
  });
});
