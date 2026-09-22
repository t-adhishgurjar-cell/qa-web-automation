import { test } from '../src/fixtures/page.fixtures';

/**
 * Who can review an OD application once its division is a placeholder.
 *
 * This is the consequence the change request does not mention. Division has never
 * been decoration on this form — it decides which TSM sees the application, and a
 * form raised into a division no TSM is mapped to sits at status 102, Pending for
 * Review, in a queue nobody can open. That exact failure cost this suite a day
 * already, on Hyderabad-vs-Gurgaon.
 *
 * So: are the fifteen new OD Default divisions mapped to any reviewer, and is
 * anyone's location mapping pointed at them?
 *
 * Read-only.
 *
 *   TOOLS=true ENV=qa npx playwright test --project=tools --grep "probe od placeholder reviewers"
 */

test.describe('Tools — probes @tools', () => {
  test('probe od placeholder reviewers', async ({ db }) => {
    test.setTimeout(300_000);

    const show = (title: string, rows: unknown[]) => {
      console.log(`\n--- ${title} (${rows.length}) ---`);
      for (const row of rows.slice(0, 30)) console.log('  ' + JSON.stringify(row));
      if (!rows.length) console.log('  (none)');
    };

    show('the placeholder divisions', await db.query(`
      SELECT DivisionId, DivisionName, BusinessStateId, RegionId
      FROM dbo.DivisionMaster WHERE IsPlaceholder = 1 ORDER BY DivisionId`));

    show('one placeholder per business state?', await db.query(`
      SELECT BusinessStateId, COUNT(*) AS placeholders
      FROM dbo.DivisionMaster WHERE IsPlaceholder = 1
      GROUP BY BusinessStateId HAVING COUNT(*) <> 1`));

    for (const table of ['TSMDivisionMapping', 'CustomerMaster', 'RawCustomerMaster', 'UserLocationMapping']) {
      const columns = await db.query(`
        SELECT COLUMN_NAME AS c FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_NAME = '${table}'
          AND (COLUMN_NAME LIKE '%Division%' OR COLUMN_NAME LIKE '%State%' OR COLUMN_NAME LIKE '%Region%')
        ORDER BY COLUMN_NAME`);
      console.log(`\n  ${table}: ${(columns as { c: string }[]).map(r => r.c).join(', ') || '(no division/state/region column)'}`);
    }

    show('TSMs mapped to a placeholder division (by DMId)', await db.query(`
      SELECT m.*, d.DivisionName FROM dbo.TSMDivisionMapping m
      JOIN dbo.DivisionMaster d ON d.DMId = m.DivisionCode
      WHERE d.IsPlaceholder = 1`));

    show('officers whose location mapping is a placeholder division', await db.query(`
      SELECT TOP 30 u.UserId, u.DivisionId, d.DivisionName
      FROM dbo.UserLocationMapping u JOIN dbo.DivisionMaster d ON d.DivisionId = u.DivisionId
      WHERE d.IsPlaceholder = 1`));

    show('customers already on a placeholder division', await db.query(`
      SELECT TOP 30 c.CustomerID, c.BusinessName, c.Status, d.DivisionName, c.CreatedOn
      FROM dbo.CustomerMaster c JOIN dbo.DivisionMaster d ON d.DivisionId = c.CustomerDivisionId
      WHERE d.IsPlaceholder = 1 ORDER BY c.CreatedOn DESC`));

    show('in-flight applications on a placeholder division', await db.query(`
      SELECT TOP 30 r.ReferenceNo, r.Status, d.DivisionName, r.CreatedOn
      FROM dbo.RawCustomerMaster r JOIN dbo.DivisionMaster d ON d.DivisionId = r.CustomerDivisionId
      WHERE d.IsPlaceholder = 1 ORDER BY r.CreatedOn DESC`));

    // How OD applications were divisioned before the placeholders existed — the
    // baseline any "the division changed" claim has to be measured against.
    show('the last ten OD applications and their divisions', await db.query(`
      SELECT TOP 10 r.ReferenceNo, r.Status, r.CustomerDivisionId, d.DivisionName,
             d.IsPlaceholder, r.CreatedOn
      FROM dbo.RawCustomerMaster r
      LEFT JOIN dbo.DivisionMaster d ON d.DivisionId = r.CustomerDivisionId
      JOIN dbo.CustomerTypeMaster t ON t.Id = r.CustomerType
      WHERE t.CustomerTypeCode = 1004 ORDER BY r.CreatedOn DESC`));
  });
});
