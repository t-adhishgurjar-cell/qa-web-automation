import { test } from '../src/fixtures/page.fixtures';

/**
 * Is there a self-onboarding path for OD, separate from Add Customer?
 *
 * Everything tested so far is the back-office path: a DSA raising an application
 * through Add Customer. OD is "Owner Driver", which is exactly the segment likely
 * to register itself, and dbo.LeadMaster exists with a PinCode column — so a
 * second enrolment path is plausible and would have its own copy of the division
 * and pin-code rules this change touches.
 *
 * Rather than guess at a URL, this asks the database: which tables hold
 * self-registered customers, what controllers the menus name, and whether any OD
 * customer was created by something other than a back-office maker.
 *
 *   TOOLS=true ENV=qa npx playwright test --project=tools --grep "probe od self onboarding"
 */

test.describe('Tools — probes @tools', () => {
  test('probe od self onboarding', async ({ db }) => {
    const show = (title: string, rows: unknown[]) => {
      console.log(`\n--- ${title} (${rows.length}) ---`);
      for (const row of rows.slice(0, 30)) console.log('  ' + JSON.stringify(row));
      if (!rows.length) console.log('  (none)');
    };

    show('the status master columns, so lead statuses can be named', await db.query(`
      SELECT COLUMN_NAME AS c FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_NAME = 'StatusMaster' ORDER BY ORDINAL_POSITION`));

    show('any master naming a lead source', await db.query(`
      SELECT TABLE_NAME AS t, COLUMN_NAME AS c FROM INFORMATION_SCHEMA.COLUMNS
      WHERE COLUMN_NAME LIKE '%LeadSource%' ORDER BY TABLE_NAME`));

    show('who created leads of each source — is any source not a back-office user?', await db.query(`
      SELECT l.LeadSource, COUNT(*) AS leads,
             MIN(COALESCE(ut.Code, '(no user)')) AS oneMakerType,
             SUM(CASE WHEN l.CreatedBy IS NULL THEN 1 ELSE 0 END) AS noMaker
      FROM dbo.LeadMaster l
      LEFT JOIN dbo.Users u ON u.Id = l.CreatedBy
      LEFT JOIN dbo.UserTypesMaster ut ON ut.Id = u.UserTypeId
      GROUP BY l.LeadSource ORDER BY l.LeadSource`));
  });
});
