import { test } from '../src/fixtures/page.fixtures';

/**
 * Who, in the officer hierarchy, ought to be able to see the OD customers raised.
 *
 * The applications land with CustomerStateId 4 (HR_HP_PB) and CustomerDivisionId
 * 0. Region and state admins are scoped by region and state, so they have
 * something to match on; division admins and TSMs are scoped by division, and
 * there is no division 0 in DivisionMaster for them to match. This lists the
 * officers who exist at each level for that state, so the visibility test is run
 * against real accounts rather than assumed ones.
 *
 *   TOOLS=true ENV=qa npx playwright test --project=tools --grep "probe od hierarchy officers"
 */

test.describe('Tools — probes @tools', () => {
  test('probe od hierarchy officers', async ({ db }) => {
    const show = (title: string, rows: unknown[]) => {
      console.log(`\n--- ${title} (${rows.length}) ---`);
      for (const row of rows.slice(0, 25)) console.log('  ' + JSON.stringify(row));
      if (!rows.length) console.log('  (none)');
    };

    show('which officer levels exist per business state', await db.query(`
      SELECT m.BusinessStateId, t.Code AS UserTypeCode, COUNT(DISTINCT u.Id) AS officers
      FROM dbo.Users u
      JOIN dbo.UserTypesMaster t ON t.Id = u.UserTypeId
      JOIN dbo.UserLocationMapping m ON m.UserId = u.Id
      WHERE t.Code IN ('STATE_ADMIN','DIVISION_ADMIN') AND u.IsActive = 1
      GROUP BY m.BusinessStateId, t.Code ORDER BY m.BusinessStateId, t.Code`));

    show('the officers this session created (Id >= 230670)', await db.query(`
      SELECT u.Id AS UserId, u.UserName, t.Code AS UserTypeCode,
             m.RegionId, m.BusinessStateId, m.DivisionId, d.DivisionName, u.IsActive, u.CreatedOn
      FROM dbo.Users u
      JOIN dbo.UserTypesMaster t ON t.Id = u.UserTypeId
      LEFT JOIN dbo.UserLocationMapping m ON m.UserId = u.Id
      LEFT JOIN dbo.DivisionMaster d ON d.DivisionId = m.DivisionId
      WHERE u.Id >= 230670 AND t.Code IN ('REGION_ADMIN','STATE_ADMIN','DIVISION_ADMIN')
      ORDER BY u.Id`));
  });
});
