import { test } from '../src/fixtures/page.fixtures';

/**
 * The node identifiers needed to create an officer against a division.
 *
 * The Office API takes a node name, not an id, and answers HTTP 200 / Success 1 for a
 * request that creates nothing or creates against the wrong node — so the name has to
 * come from the data rather than from a pattern. "Ahmedabad I" is DOAHMEDA1, which makes
 * DOAHMEDA2 a reasonable guess for Ahmedabad II and a guess is exactly what produced six
 * officers on the wrong nodes once before.
 *
 *   TOOLS=true ENV=qa npx playwright test --project=tools --grep "probe division nodes"
 */

test.describe('Tools — probes @tools', () => {
  test('probe division nodes', async ({ db }) => {
    const divisions = await db.query(`
      SELECT d.DivisionId, d.DivisionName, d.DMId, d.BusinessStateId, s.BusinessStateName,
             d.RegionId, r.RegionName, d.StatusFlag, d.IsPlaceholder
      FROM dbo.DivisionMaster d
      LEFT JOIN dbo.BusinessStateMaster s ON s.BusinessStateId = d.BusinessStateId
      LEFT JOIN dbo.RegionMaster r ON r.RegionId = d.RegionId
      WHERE d.DivisionName LIKE '%Ahmedabad%' ORDER BY d.DivisionId`);
    console.log('\n--- Ahmedabad divisions ---');
    for (const row of divisions as unknown[]) console.log('  ' + JSON.stringify(row));

    const nodes = await db.query(`
      SELECT * FROM dbo.StateNodeMapping WHERE BusinessStateId = 11`);
    console.log('\n--- the state node for GJ_I ---');
    for (const row of nodes as unknown[]) console.log('  ' + JSON.stringify(row));

    const existing = await db.query(`
      SELECT u.Id, u.UserName, ut.Code AS UserTypeCode, m.RegionId, m.BusinessStateId,
             m.DivisionId, u.IsActive
      FROM dbo.Users u
      JOIN dbo.UserTypesMaster ut ON ut.Id = u.UserTypeId
      JOIN dbo.UserLocationMapping m ON m.UserId = u.Id
      WHERE m.DivisionId = 2 AND ut.Code = 'DIVISION_ADMIN'`);
    console.log('\n--- division admins that already exist for division 2 ---');
    for (const row of existing as unknown[]) console.log('  ' + JSON.stringify(row));
    if (!existing.length) console.log('  (none)');
  });
});
