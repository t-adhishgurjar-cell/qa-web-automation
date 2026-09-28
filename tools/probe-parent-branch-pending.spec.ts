import { test } from '../src/fixtures/page.fixtures';

/**
 * Finds a branch/parent pair that can exercise the second half of NFP-1913.
 *
 * The claim is "Parent customer is Inactive. Vehicle cannot be approved." To test it: a vehicle at
 * 411 on a **branch** customer, whose **parent** is then deactivated. dbo.CustomerMaster links them
 * with ParentId, not ParentCustomerID.
 *
 * Preference order for the subject, and it matters: a pair this suite created, so deactivating the
 * parent cannot disturb anyone else's testing.
 *
 *   TOOLS=true ENV=qa npx playwright test --project=tools --grep "probe parent branch pending"
 */

test.describe('Tools — probes @tools', () => {
  test('probe parent branch pending', async ({ db }) => {
    const show = (title: string, rows: unknown[]) => {
      console.log(`\n--- ${title} (${rows.length}) ---`);
      for (const row of rows.slice(0, 20)) console.log('  ' + JSON.stringify(row));
      if (!rows.length) console.log('  (none)');
    };

    show('this suite\'s own pair', await db.query(`
      SELECT c.CustomerID, c.ParentId, c.Status, c.BusinessName, c.CustomerStateId, c.CustomerDivisionId,
             p.CustomerID AS parentId, p.Status AS parentStatus, p.BusinessName AS parentName
      FROM dbo.CustomerMaster c
      LEFT JOIN dbo.CustomerMaster p ON CAST(p.Id AS varchar(20)) = CAST(c.ParentId AS varchar(20))
      WHERE c.CustomerID IN ('NAYAFP2023400255','NAYAFP1023400254')`));

    show('how ParentId is shaped, on a few branches', await db.query(`
      SELECT TOP 5 Id, CustomerID, ParentId, Status, BusinessName
      FROM dbo.CustomerMaster WHERE ParentId IS NOT NULL ORDER BY Id DESC`));

    show('vehicles at 411 on a customer that HAS a parent', await db.query(`
      SELECT r.VehicleNo, r.CustomerID, c.Status AS branchStatus, c.ParentId,
             p.CustomerID AS parent, p.Status AS parentStatus
      FROM dbo.RawVehiclesDetail r
      JOIN dbo.CustomerMaster c ON c.CustomerID = r.CustomerID
      JOIN dbo.CustomerMaster p ON p.Id = c.ParentId
      WHERE r.VehicleStatus = 411`));

    show('branches of this suite\'s parent, for seeding', await db.query(`
      SELECT c.CustomerID, c.Status, c.BusinessName, c.BranchLocation
      FROM dbo.CustomerMaster c
      JOIN dbo.CustomerMaster p ON p.Id = c.ParentId
      WHERE p.CustomerID = 'NAYAFP1023400254'`));
  });
});
