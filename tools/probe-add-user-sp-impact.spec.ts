import { test } from '../src/fixtures/page.fixtures';

/**
 * What else the usp_AddUser changes reach.
 *
 * The procedure is not only behind the Add User screen. Anything that creates a user on a
 * mobile number goes through the same three-arm conflict check and the same caps, so the
 * changes have consequences the tickets do not mention. The sharpest question:
 *
 *   The CustomerMaster arm refuses any new user whose mobile belongs to a non-OD customer
 *   at status 101 or 104. A customer's own administrator is a user on the customer's own
 *   mobile. If onboarding creates that admin through this procedure, and the CustomerMaster
 *   row exists by then, the check matches the customer's own record and refuses its own
 *   admin — for Fleet, Non Fleet and Corporate, but not OD, which is excluded.
 *
 * That would be severe, so it is asked of the data rather than reasoned about: were
 * customer admins still being created after the check landed on 3 September 2026?
 *
 *   TOOLS=true ENV=qa npx playwright test --project=tools --grep "probe add user sp impact"
 */

test.describe('Tools — probes @tools', () => {
  test('probe add user sp impact', async ({ db }) => {
    const show = (title: string, rows: unknown[]) => {
      console.log(`\n--- ${title} (${rows.length}) ---`);
      for (const row of rows.slice(0, 15)) console.log('  ' + JSON.stringify(row));
      if (!rows.length) console.log('  (none)');
    };

    // 1. Customer admins created since the check landed, by customer type.
    show('customer admin users created since 3 Sep, by the type of customer on that mobile', await db.query(`
      SELECT ctm.CustomerTypeName, COUNT(DISTINCT u.Id) AS adminsCreated,
             MIN(u.CreatedOn) AS earliest, MAX(u.CreatedOn) AS latest
      FROM dbo.Users u
      JOIN dbo.UserTypesMaster ut ON ut.Id = u.UserTypeId
      JOIN dbo.CustomerMaster cm ON cm.MobileNo = u.MobileNumber
      JOIN dbo.CustomerTypeMaster ctm ON ctm.Id = cm.CustomerType
      WHERE ut.Code IN ('CUSTOMER_ADMIN','BRANCH_ADMIN','CUSTOMER_PARENT_USER','CUSTOMER_CHILD_USER')
        AND u.CreatedOn >= '2026-09-03'
      GROUP BY ctm.CustomerTypeName ORDER BY adminsCreated DESC`));

    // 2. And before it, for contrast.
    show('the same, for the month before the check landed', await db.query(`
      SELECT ctm.CustomerTypeName, COUNT(DISTINCT u.Id) AS adminsCreated
      FROM dbo.Users u
      JOIN dbo.UserTypesMaster ut ON ut.Id = u.UserTypeId
      JOIN dbo.CustomerMaster cm ON cm.MobileNo = u.MobileNumber
      JOIN dbo.CustomerTypeMaster ctm ON ctm.Id = cm.CustomerType
      WHERE ut.Code IN ('CUSTOMER_ADMIN','BRANCH_ADMIN','CUSTOMER_PARENT_USER','CUSTOMER_CHILD_USER')
        AND u.CreatedOn >= '2026-08-03' AND u.CreatedOn < '2026-09-03'
      GROUP BY ctm.CustomerTypeName ORDER BY adminsCreated DESC`));

    // 3. Non-OD customers approved since the check with no user on their mobile at all —
    //    the shape a blocked admin creation would leave behind.
    show('non-OD customers approved since 3 Sep with no user on their mobile', await db.query(`
      SELECT TOP 15 cm.CustomerID, ctm.CustomerTypeName, cm.MobileNo, cm.Status, cm.CreatedOn
      FROM dbo.CustomerMaster cm
      JOIN dbo.CustomerTypeMaster ctm ON ctm.Id = cm.CustomerType
      WHERE ctm.CustomerTypeCode <> 1004 AND cm.CreatedOn >= '2026-09-03'
        AND cm.Status IN (101, 104)
        AND NOT EXISTS (SELECT 1 FROM dbo.Users u WHERE u.MobileNumber = cm.MobileNo)
      ORDER BY cm.CreatedOn DESC`));

    // 4. How many mobiles are permanently unusable because a disabled blocking-type user
    //    holds them — staff turnover and test-data reuse both hit this.
    show('mobiles held only by disabled blocking-type users', await db.query(`
      SELECT COUNT(DISTINCT u.MobileNumber) AS mobilesLockedByDisabledUsers
      FROM dbo.Users u
      JOIN dbo.UserTypesMaster ut ON ut.Id = u.UserTypeId
      WHERE u.IsActive = 0
        AND ut.Code IN ('FP_ADMIN','HO_ADMIN','HO','REGION_ADMIN','STATE_ADMIN','DIVISION_ADMIN',
                        'TERRITORY_ADMIN','OTHER_NAYARA','OTHER_NON','RO','OTHER_RO')
        AND NOT EXISTS (SELECT 1 FROM dbo.Users a WHERE a.MobileNumber = u.MobileNumber AND a.IsActive = 1)`));

    // 5. Shared-password blast radius: one mobile, many users, one inherited hash.
    show('mobiles carrying the most user rows', await db.query(`
      SELECT TOP 10 u.MobileNumber, COUNT(*) AS userRows,
             COUNT(DISTINCT u.PasswordHash) AS distinctHashes,
             COUNT(DISTINCT ut.Code) AS distinctTypes
      FROM dbo.Users u JOIN dbo.UserTypesMaster ut ON ut.Id = u.UserTypeId
      GROUP BY u.MobileNumber HAVING COUNT(*) > 5 ORDER BY userRows DESC`));
  });
});
