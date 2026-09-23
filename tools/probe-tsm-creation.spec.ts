import { test } from '../src/fixtures/page.fixtures';

/**
 * How a TSM comes into existence, and whether one can be made for a GJ_I division.
 *
 * The Office API helper derives the user type from the node type it is given — ZONE
 * produces a REGION_ADMIN, State a STATE_ADMIN, DIVISION a DIVISION_ADMIN — and there is
 * no node type wired up that produces a TSM. The payload carries no user type of its own,
 * so a TSM cannot simply be asked for.
 *
 * Before deciding it cannot be done: what do the existing TSMs look like, what does the
 * type master call them, is there a territory structure beneath division, and were they
 * created by this API (Useragent 'SAP') or by something else?
 *
 *   TOOLS=true ENV=qa npx playwright test --project=tools --grep "probe tsm creation"
 */

test.describe('Tools — probes @tools', () => {
  test('probe tsm creation', async ({ db }) => {
    const show = (title: string, rows: unknown[]) => {
      console.log(`\n--- ${title} (${rows.length}) ---`);
      for (const row of rows.slice(0, 20)) console.log('  ' + JSON.stringify(row));
      if (!rows.length) console.log('  (none)');
    };

    show('what the type master calls the territory roles', await db.query(`
      SELECT Id, Name, Code, HierarchyType, Category, IsActive
      FROM dbo.UserTypesMaster
      WHERE Code LIKE '%TERRITOR%' OR Code LIKE '%TSM%' OR Name LIKE '%territor%' OR Name LIKE '%TSM%'
      ORDER BY Id`));

    show('is there a structure below division?', await db.query(`
      SELECT TABLE_NAME AS name FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_NAME LIKE '%Territor%' OR TABLE_NAME LIKE '%SalesArea%' OR TABLE_NAME LIKE '%Node%'
      ORDER BY name`));

    show('existing TSMs in GJ_I (state 11), and how they were made', await db.query(`
      SELECT TOP 20 u.Id, u.UserName, ut.Code AS UserTypeCode, m.RegionId, m.BusinessStateId,
             m.DivisionId, d.DivisionName, p.Useragent, u.IsActive, u.CreatedOn
      FROM dbo.Users u
      JOIN dbo.UserTypesMaster ut ON ut.Id = u.UserTypeId
      JOIN dbo.UserLocationMapping m ON m.UserId = u.Id
      LEFT JOIN dbo.DivisionMaster d ON d.DivisionId = m.DivisionId
      LEFT JOIN dbo.UserProfiles p ON p.UserId = u.Id
      WHERE m.BusinessStateId = 11 AND ut.Code IN ('TERRITORY_ADMIN','TSM')
      ORDER BY u.Id DESC`));

    show('how the TSM this suite uses was made', await db.query(`
      SELECT u.Id, u.UserName, ut.Code AS UserTypeCode, p.Useragent, p.Status,
             m.RegionId, m.BusinessStateId, m.DivisionId, u.CreatedOn, u.CreatedBy
      FROM dbo.Users u
      JOIN dbo.UserTypesMaster ut ON ut.Id = u.UserTypeId
      LEFT JOIN dbo.UserProfiles p ON p.UserId = u.Id
      LEFT JOIN dbo.UserLocationMapping m ON m.UserId = u.Id
      WHERE u.UserName = '9612200200'`));

    show('TSMDivisionMapping, which ties a TSM to divisions', await db.query(`
      SELECT TOP 20 * FROM dbo.TSMDivisionMapping ORDER BY 1 DESC`));

    show('GJ_I TSMs in divisions 1 and 2 — which are usable?', await db.query(`
      SELECT DISTINCT u.Id, u.UserName, m.DivisionId, d.DivisionName, u.IsActive,
             a.UserId AS hasAuthStatus,
             (SELECT COUNT(*) FROM dbo.UserSMSLog l WHERE l.MobileNo = u.UserName
                AND l.SMSText LIKE '%Temporary Password%') AS tempPasswordSms
      FROM dbo.Users u
      JOIN dbo.UserTypesMaster ut ON ut.Id = u.UserTypeId
      JOIN dbo.UserLocationMapping m ON m.UserId = u.Id
      LEFT JOIN dbo.DivisionMaster d ON d.DivisionId = m.DivisionId
      LEFT JOIN dbo.UserAuthStatus a ON a.UserId = u.Id
      WHERE ut.Code = 'TERRITORY_ADMIN' AND m.BusinessStateId = 11 AND m.DivisionId IN (1, 2)
      ORDER BY m.DivisionId, u.Id DESC`));

    show('the columns UserAuthStatus offers', await db.query(`
      SELECT COLUMN_NAME AS c FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_NAME = 'UserAuthStatus' ORDER BY ORDINAL_POSITION`));
  });
});
