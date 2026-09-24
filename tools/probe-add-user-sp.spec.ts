import { test } from '../src/fixtures/page.fixtures';

/**
 * Reads usp_AddUser as it stands now.
 *
 * The UserType x CustomerType matrix in src/data/usertype-matrix.data.ts carries two
 * verdicts per cell — what the workbook specifies and what this procedure does — and they
 * disagree on 20 of 117. That analysis was done earlier and against an earlier build, so
 * the definition is re-read rather than recalled, and its modify date reported: if the
 * procedure has changed since, the matrix's "code" column is stale and any conclusion
 * drawn from it is too.
 *
 * Also worth knowing given the TSM question: which user types this procedure is willing to
 * create. The officer API refuses a TERRITORY node outright, so if a TSM can be made at all
 * from the outside, this is the other candidate.
 *
 *   TOOLS=true ENV=qa npx playwright test --project=tools --grep "probe add user sp"
 */

test.describe('Tools — probes @tools', () => {
  test('probe add user sp', async ({ db }) => {
    const meta = await db.query(`
      SELECT o.name, o.type_desc, o.create_date, o.modify_date,
             LEN(m.definition) AS definitionLength
      FROM sys.sql_modules m JOIN sys.objects o ON o.object_id = m.object_id
      WHERE o.name LIKE '%AddUser%' ORDER BY o.name`);
    console.log('\n--- procedures named for adding a user ---');
    for (const row of meta as unknown[]) console.log('  ' + JSON.stringify(row));

    const params = await db.query(`
      SELECT p.name, TYPE_NAME(p.user_type_id) AS type, p.max_length, p.is_output
      FROM sys.parameters p JOIN sys.objects o ON o.object_id = p.object_id
      WHERE o.name = 'usp_AddUser' ORDER BY p.parameter_id`);
    console.log('\n--- usp_AddUser parameters ---');
    for (const row of params as unknown[]) console.log('  ' + JSON.stringify(row));

    // The user types it mentions by name, which is the nearest thing to a list of what it
    // is willing to create.
    const types = await db.query(`
      SELECT ut.Code, ut.Name, ut.HierarchyType, ut.Category
      FROM dbo.UserTypesMaster ut
      WHERE EXISTS (
        SELECT 1 FROM sys.sql_modules m JOIN sys.objects o ON o.object_id = m.object_id
        WHERE o.name = 'usp_AddUser' AND m.definition LIKE '%' + ut.Code + '%')
      ORDER BY ut.Id`);
    console.log('\n--- user types usp_AddUser names explicitly ---');
    for (const row of types as unknown[]) console.log('  ' + JSON.stringify(row));

    const all = await db.query(`SELECT COUNT(*) AS n FROM dbo.UserTypesMaster`);
    console.log(`  (of ${JSON.stringify(all)} in UserTypesMaster)`);

    // definitionLength came back NULL, which is not the same as an empty procedure.
    // Check whether this login is allowed to see procedure bodies at all, because the
    // difference decides what the matrix's "code" column can honestly claim.
    // Deliberately does not ask about the run permission: DbHelper refuses any statement
    // containing a write or execute keyword, and the word inside a permission-check string
    // is enough to trip it. That guard is doing its job — the read-only credential is the
    // reason this suite can be pointed at QA at all — so the question is phrased around it.
    const permission = await db.query(`
      SELECT OBJECT_DEFINITION(OBJECT_ID('dbo.usp_AddUser')) AS definition,
             HAS_PERMS_BY_NAME('dbo.usp_AddUser', 'OBJECT', 'VIEW DEFINITION') AS canViewDefinition,
             CURRENT_USER AS asUser`);
    console.log('\n--- what this login may do with usp_AddUser ---');
    for (const row of permission as { definition: string | null }[]) {
      console.log('  ' + JSON.stringify({ ...row, definition: row.definition ? 'readable' : null }));
    }

    // When it changed, against the rest of this change's footprint.
    const timeline = await db.query(`
      SELECT 'usp_AddUser' AS what, modify_date AS at FROM sys.objects WHERE name = 'usp_AddUser'
      UNION ALL SELECT 'usp_AddUserAPI', modify_date FROM sys.objects WHERE name = 'usp_AddUserAPI'
      UNION ALL SELECT 'OD Default divisions created', MIN(CreatedOn) FROM dbo.DivisionMaster
        WHERE IsPlaceholder = 1
      ORDER BY at`);
    console.log('\n--- timeline ---');
    for (const row of timeline as unknown[]) console.log('  ' + JSON.stringify(row));
  });
});
