import { test } from '../src/fixtures/page.fixtures';

/**
 * The current state of the records named in NFP-1913, before verifying the fix.
 *
 * The ticket names customer NAYAFP2023400255 and registration DL4CU8468, and reports that the
 * approval succeeded while the customer was Inactive — 411 to 402 in RawVehiclesDetail, 401 in
 * VehicleDetails, approved by user 230688. Verifying a fix needs to know where those records sit
 * now: whether the customer was left active or inactive, whether DL4CU8468 is still approved from
 * the original run, and whether anything is pending that the fix can be exercised against.
 *
 *   TOOLS=true ENV=qa npx playwright test --project=tools --grep "probe nfp1913 state"
 */

const CUSTOMER = 'NAYAFP2023400255';

test.describe('Tools — probes @tools', () => {
  test('probe nfp1913 state', async ({ db }) => {
    const show = (title: string, rows: unknown[]) => {
      console.log(`\n--- ${title} (${rows.length}) ---`);
      for (const row of rows.slice(0, 20)) console.log('  ' + JSON.stringify(row));
      if (!rows.length) console.log('  (none)');
    };

    show('the customer', await db.query(`
      SELECT c.CustomerID, c.Status, s.StatusName, c.CustomerStateId, c.CustomerDivisionId,
             c.MobileNo, c.ModifiedOn
      FROM dbo.CustomerMaster c
      LEFT JOIN dbo.StatusMaster s ON s.StatusId = c.Status
      WHERE c.CustomerID = '${CUSTOMER}'`));

    for (const t of ['RawVehiclesDetail', 'VehicleDetails']) {
      const cols = await db.query<{ c: string }>(`
        SELECT COLUMN_NAME AS c FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_NAME = '${t}' AND (COLUMN_NAME LIKE '%Status%' OR COLUMN_NAME LIKE '%On%'
              OR COLUMN_NAME LIKE '%By%' OR COLUMN_NAME LIKE '%Customer%' OR COLUMN_NAME = 'VehicleNo')
        ORDER BY ORDINAL_POSITION`);
      console.log(`\n  ${t}: ${cols.map(r => r.c).join(', ')}`);
    }

    show('DL4CU8468, the registration in the ticket', await db.query(`
      SELECT 'RawVehiclesDetail' AS src, VehicleNo, VehicleStatus, CustomerID
      FROM dbo.RawVehiclesDetail WHERE VehicleNo = 'DL4CU8468'
      UNION ALL
      SELECT 'VehicleDetails', VehicleNo, VehicleStatus, CustomerID
      FROM dbo.VehicleDetails WHERE VehicleNo = 'DL4CU8468'`));

    show('everything pending approval for this customer', await db.query(`
      SELECT VehicleNo, VehicleStatus, CustomerID
      FROM dbo.RawVehiclesDetail
      WHERE CustomerID = '${CUSTOMER}' AND VehicleStatus = 411`));

    show('every vehicle this customer has, by status', await db.query(`
      SELECT VehicleStatus, COUNT(*) AS vehicles FROM dbo.RawVehiclesDetail
      WHERE CustomerID = '${CUSTOMER}' GROUP BY VehicleStatus ORDER BY VehicleStatus`));

    show('live vehicles against an inactive customer — the impact the ticket describes', await db.query(`
      SELECT TOP 10 v.VehicleNo, v.VehicleStatus, v.CustomerID, c.Status AS customerStatus
      FROM dbo.VehicleDetails v
      JOIN dbo.CustomerMaster c ON c.CustomerID = v.CustomerID
      WHERE c.Status = 104 AND v.VehicleStatus = 401`));

    show('how many such pairs exist in total', await db.query(`
      SELECT COUNT(*) AS liveVehiclesOnInactiveCustomers
      FROM dbo.VehicleDetails v
      JOIN dbo.CustomerMaster c ON c.CustomerID = v.CustomerID
      WHERE c.Status = 104 AND v.VehicleStatus = 401`));
  });
});
