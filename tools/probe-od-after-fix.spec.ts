import { test } from '../src/fixtures/page.fixtures';

/**
 * Two questions the corrected reading of the change request raises.
 *
 * The brief is "remove the division hierarchy from OD". So CustomerDivisionId = 0 is
 * the fix working, not a defect, and the risk I raised — that an OD application with
 * no division has no reviewer — has to be re-examined rather than assumed:
 *
 *   1. Has any OD application with division 0 actually advanced past review? One
 *      sits at 105, Pending for Approval, which would mean review routing does not
 *      need a division and the risk is already answered by the product.
 *
 *   2. Approved customers live in dbo.CustomerMaster, not RawCustomerMaster, and are
 *      shown on a different screen. Is an approved OD customer also visible outside
 *      the officer's region and state, or is the over-removal confined to in-flight
 *      applications?
 *
 *   TOOLS=true ENV=qa npx playwright test --project=tools --grep "probe od after fix"
 */

test.describe('Tools — probes @tools', () => {
  test('probe od after fix', async ({ db }) => {
    const show = (title: string, rows: unknown[]) => {
      console.log(`\n--- ${title} (${rows.length}) ---`);
      for (const row of rows.slice(0, 25)) console.log('  ' + JSON.stringify(row));
      if (!rows.length) console.log('  (none)');
    };

    show('OD applications with no division, and how far each has got', await db.query(`
      SELECT r.ReferenceNo, r.Status, r.CustomerStateId, r.CustomerDivisionId, r.CreatedOn
      FROM dbo.RawCustomerMaster r
      JOIN dbo.CustomerTypeMaster t ON t.Id = r.CustomerType
      WHERE t.CustomerTypeCode = 1004 AND (r.CustomerDivisionId = 0 OR r.CustomerDivisionId IS NULL)
      ORDER BY r.Status DESC, r.CreatedOn DESC`));

    show('the columns LeadStatusLog offers, for tracing a status trail', await db.query(`
      SELECT COLUMN_NAME AS c FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_NAME = 'LeadStatusLog' ORDER BY ORDINAL_POSITION`));

    show('approved OD customers and their divisions', await db.query(`
      SELECT TOP 20 c.CustomerID, c.Status, c.CustomerStateId, c.CustomerDivisionId,
             d.DivisionName, c.CreatedOn
      FROM dbo.CustomerMaster c
      JOIN dbo.CustomerTypeMaster t ON t.Id = c.CustomerType
      LEFT JOIN dbo.DivisionMaster d ON d.DivisionId = c.CustomerDivisionId
      WHERE t.CustomerTypeCode = 1004
      ORDER BY c.CreatedOn DESC`));

    show('do approved OD customers have divisions, as a whole?', await db.query(`
      SELECT CASE WHEN c.CustomerDivisionId IS NULL OR c.CustomerDivisionId = 0
                  THEN 'no division' ELSE 'has a division' END AS division,
             COUNT(*) AS customers, MIN(c.CreatedOn) AS earliest, MAX(c.CreatedOn) AS latest
      FROM dbo.CustomerMaster c
      JOIN dbo.CustomerTypeMaster t ON t.Id = c.CustomerType
      WHERE t.CustomerTypeCode = 1004
      GROUP BY CASE WHEN c.CustomerDivisionId IS NULL OR c.CustomerDivisionId = 0
                    THEN 'no division' ELSE 'has a division' END`));

    show('and for Fleet, as the control', await db.query(`
      SELECT CASE WHEN c.CustomerDivisionId IS NULL OR c.CustomerDivisionId = 0
                  THEN 'no division' ELSE 'has a division' END AS division,
             COUNT(*) AS customers
      FROM dbo.CustomerMaster c
      JOIN dbo.CustomerTypeMaster t ON t.Id = c.CustomerType
      WHERE t.CustomerTypeCode = 1001
      GROUP BY CASE WHEN c.CustomerDivisionId IS NULL OR c.CustomerDivisionId = 0
                    THEN 'no division' ELSE 'has a division' END`));
  });
});
