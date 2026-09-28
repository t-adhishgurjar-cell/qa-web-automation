import { test } from '../src/fixtures/page.fixtures';

/**
 * Is there already a vehicle pending approval against an inactive customer?
 *
 * If so, NFP-1913 can be verified without switching anything off — which matters, because no
 * account this suite holds is granted Activate / Deactivate Customer. Only the FP_ADMIN and
 * HO_ADMIN roles are, and the FP Admin credential cannot sign in: "Password expired. Reset
 * required."
 *
 * A customer already at 104 with a vehicle at 411 is the exact precondition the ticket describes,
 * arrived at by someone else's earlier testing rather than by this run.
 *
 *   TOOLS=true ENV=qa npx playwright test --project=tools --grep "probe pending on inactive"
 */

test.describe('Tools — probes @tools', () => {
  test('probe pending on inactive', async ({ db }) => {
    const show = (title: string, rows: unknown[]) => {
      console.log(`\n--- ${title} (${rows.length}) ---`);
      for (const row of rows.slice(0, 20)) console.log('  ' + JSON.stringify(row));
      if (!rows.length) console.log('  (none)');
    };

    show('vehicles pending approval whose customer is already inactive', await db.query(`
      SELECT r.VehicleNo, r.VehicleStatus, r.CustomerID, c.Status AS customerStatus,
             c.CustomerStateId, c.CustomerDivisionId, d.DivisionName
      FROM dbo.RawVehiclesDetail r
      JOIN dbo.CustomerMaster c ON c.CustomerID = r.CustomerID
      LEFT JOIN dbo.DivisionMaster d ON d.DivisionId = c.CustomerDivisionId
      WHERE r.VehicleStatus = 411 AND c.Status = 104`));

    // The parent linkage column is not ParentCustomerID; ask before joining on it.
    const parentCols = await db.query<{ c: string }>(`
      SELECT COLUMN_NAME AS c FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_NAME = 'CustomerMaster'
        AND (COLUMN_NAME LIKE '%Parent%' OR COLUMN_NAME LIKE '%Branch%' OR COLUMN_NAME LIKE '%UID%')
      ORDER BY ORDINAL_POSITION`);
    console.log(`\n  CustomerMaster parent/branch columns: ${parentCols.map(r => r.c).join(', ') || '(none)'}`);

    show('every vehicle pending approval, with its customer status', await db.query(`
      SELECT r.VehicleNo, r.CustomerID, c.Status AS customerStatus, s.StatusName
      FROM dbo.RawVehiclesDetail r
      LEFT JOIN dbo.CustomerMaster c ON c.CustomerID = r.CustomerID
      LEFT JOIN dbo.StatusMaster s ON s.StatusId = c.Status
      WHERE r.VehicleStatus = 411`));
  });
});
