import { test } from '../src/fixtures/page.fixtures';

/**
 * Where the dummy OD divisions are wired in, and whether anything assigns them.
 *
 * Dev's mechanism for this change was to create a dummy division for every active
 * business state — the fifteen "OD Default - <state>" rows in dbo.DivisionMaster
 * with IsPlaceholder = 1. If that is the design, then an OD application storing
 * CustomerDivisionId = 0 is the mechanism not being applied, not the change working,
 * and the finding withdrawn on that basis has to come back.
 *
 * Before asserting either way: which database code mentions IsPlaceholder at all,
 * and does anything reference the placeholder rows? Assignment might happen at
 * approval rather than at submission — no post-fix OD application has been approved
 * yet, so an absence in CustomerMaster proves nothing on its own.
 *
 *   TOOLS=true ENV=qa npx playwright test --project=tools --grep "probe od placeholder usage"
 */

test.describe('Tools — probes @tools', () => {
  test('probe od placeholder usage', async ({ db }) => {
    const show = (title: string, rows: unknown[]) => {
      console.log(`\n--- ${title} (${rows.length}) ---`);
      for (const row of rows.slice(0, 25)) console.log('  ' + JSON.stringify(row));
      if (!rows.length) console.log('  (none)');
    };

    show('database code mentioning IsPlaceholder', await db.query(`
      SELECT o.name, o.type_desc, o.modify_date
      FROM sys.sql_modules m JOIN sys.objects o ON o.object_id = m.object_id
      WHERE m.definition LIKE '%IsPlaceholder%' ORDER BY o.modify_date DESC`));

    show('database code mentioning the OD Default rows by name or DMId', await db.query(`
      SELECT o.name, o.type_desc, o.modify_date
      FROM sys.sql_modules m JOIN sys.objects o ON o.object_id = m.object_id
      WHERE m.definition LIKE '%OD Default%' OR m.definition LIKE '%ODDEF%'
      ORDER BY o.modify_date DESC`));

    show('code that decides a division for a customer, most recently changed first', await db.query(`
      SELECT TOP 20 o.name, o.type_desc, o.modify_date
      FROM sys.sql_modules m JOIN sys.objects o ON o.object_id = m.object_id
      WHERE m.definition LIKE '%CustomerDivisionId%' ORDER BY o.modify_date DESC`));

    show('anything at all referencing division 51-65', await db.query(`
      SELECT 'RawCustomerMaster' AS source, COUNT(*) AS rows_
      FROM dbo.RawCustomerMaster WHERE CustomerDivisionId BETWEEN 51 AND 65
      UNION ALL SELECT 'CustomerMaster', COUNT(*) FROM dbo.CustomerMaster
      WHERE CustomerDivisionId BETWEEN 51 AND 65
      UNION ALL SELECT 'LeadMaster', COUNT(*) FROM dbo.LeadMaster
      WHERE DivisionId BETWEEN 51 AND 65
      UNION ALL SELECT 'UserLocationMapping', COUNT(*) FROM dbo.UserLocationMapping
      WHERE DivisionId BETWEEN 51 AND 65`));

    show('is a dummy division offered on the form for every active business state?', await db.query(`
      SELECT s.BusinessStateId, s.BusinessStateName, s.StatusFlag AS stateActive,
             d.DivisionId, d.DivisionName, d.StatusFlag AS divisionActive
      FROM dbo.BusinessStateMaster s
      LEFT JOIN dbo.DivisionMaster d ON d.BusinessStateId = s.BusinessStateId AND d.IsPlaceholder = 1
      ORDER BY s.BusinessStateId`));

    show('the applications that DID get a dummy division', await db.query(`
      SELECT r.ReferenceNo, r.Status, r.CustomerStateId, r.CustomerDivisionId,
             d.DivisionName, r.CreatedBy, u.UserName, ut.Code AS MakerType,
             t.CustomerTypeName, r.CreatedOn, r.ModifiedOn
      FROM dbo.RawCustomerMaster r
      JOIN dbo.DivisionMaster d ON d.DivisionId = r.CustomerDivisionId
      LEFT JOIN dbo.Users u ON u.Id = r.CreatedBy
      LEFT JOIN dbo.UserTypesMaster ut ON ut.Id = u.UserTypeId
      LEFT JOIN dbo.CustomerTypeMaster t ON t.Id = r.CustomerType
      WHERE d.IsPlaceholder = 1 ORDER BY r.CreatedOn DESC`));

    show('the customer that DID get a dummy division', await db.query(`
      SELECT c.CustomerID, c.Status, c.CustomerStateId, c.CustomerDivisionId,
             d.DivisionName, t.CustomerTypeName, c.CreatedOn, c.ModifiedOn
      FROM dbo.CustomerMaster c
      JOIN dbo.DivisionMaster d ON d.DivisionId = c.CustomerDivisionId
      LEFT JOIN dbo.CustomerTypeMaster t ON t.Id = c.CustomerType
      WHERE d.IsPlaceholder = 1`));

    show('every OD application since the dummy divisions were created, in order', await db.query(`
      SELECT r.ReferenceNo, r.Status, r.CustomerStateId, r.CustomerDivisionId,
             u.UserName AS maker, r.CreatedOn
      FROM dbo.RawCustomerMaster r
      JOIN dbo.CustomerTypeMaster t ON t.Id = r.CustomerType
      LEFT JOIN dbo.Users u ON u.Id = r.CreatedBy
      WHERE t.CustomerTypeCode = 1004 AND r.CreatedOn >= '2026-09-22 16:11'
      ORDER BY r.CreatedOn`));

    show('the three makers, side by side', await db.query(`
      SELECT u.Id AS UserId, u.UserName, ut.Code AS UserTypeCode, u.IsActive,
             m.RegionId, m.BusinessStateId, m.DivisionId, d.DivisionName,
             d.IsPlaceholder AS mappedToDummy
      FROM dbo.Users u
      JOIN dbo.UserTypesMaster ut ON ut.Id = u.UserTypeId
      LEFT JOIN dbo.UserLocationMapping m ON m.UserId = u.Id
      LEFT JOIN dbo.DivisionMaster d ON d.DivisionId = m.DivisionId
      WHERE u.UserName IN ('8527769693','7000000187','9611200199')
      ORDER BY u.UserName, m.BusinessStateId, m.DivisionId`));

    show('roles each maker holds', await db.query(`
      SELECT u.UserName, r.RoleName
      FROM dbo.Users u
      JOIN dbo.UserRoleMappings rm ON rm.UserId = u.Id
      JOIN dbo.Roles r ON r.Id = rm.RoleId
      WHERE u.UserName IN ('8527769693','7000000187','9611200199') AND rm.StatusFlag = 1
      ORDER BY u.UserName, r.RoleName`));
  });
});
