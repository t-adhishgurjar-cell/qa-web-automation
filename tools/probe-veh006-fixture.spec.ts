import { test } from '../src/fixtures/page.fixtures';
import { PARENT_ADMIN } from '../src/config/accounts';

/**
 * Is W-VEH-006 asking the right account about the right vehicle?
 *
 * The test signs in as the parent admin (PARENT_ADMIN.ownCustomerId) and looks up DL3CW9474, which
 * VehicleDetails says belongs to NAYAFP2023400247. If that customer is not this admin's own or one of
 * its branches, then an empty authentication panel is the correct answer and the fixture is wrong —
 * the test would be asserting that an account can see a vehicle it has no claim to.
 *
 *   TOOLS=true ENV=qa npx playwright test --project=tools --grep "probe veh006 fixture"
 */

const OWN = PARENT_ADMIN.ownCustomerId;
const VEHICLE_OWNER = 'NAYAFP2023400247';

test.describe('Tools — probes @tools', () => {
  test('probe veh006 fixture', async ({ db }) => {
    const show = (t: string, rows: unknown[]) => {
      console.log(`\n--- ${t} (${rows.length}) ---`);
      for (const r of rows.slice(0, 20)) console.log('  ' + JSON.stringify(r));
      if (!rows.length) console.log('  (none)');
    };

    console.log(`  the account's own customer: ${OWN}`);
    console.log(`  the vehicle's customer:     ${VEHICLE_OWNER}`);

    show('both customers, with their parent linkage', await db.query(`
      SELECT Id, CustomerID, ParentId, Status, BusinessName
      FROM dbo.CustomerMaster WHERE CustomerID IN ('${OWN}', '${VEHICLE_OWNER}')`));

    show('branches of the account own customer', await db.query(`
      SELECT c.CustomerID, c.Status, c.BranchLocation
      FROM dbo.CustomerMaster c
      JOIN dbo.CustomerMaster p ON p.Id = c.ParentId
      WHERE p.CustomerID = '${OWN}'`));

    show('vehicles this account should be able to see — its own customer and branches', await db.query(`
      SELECT TOP 10 v.VehicleNo, v.CustomerID, v.VehicleStatus
      FROM dbo.VehicleDetails v
      WHERE v.CustomerID = '${OWN}'
         OR v.CustomerID IN (SELECT c.CustomerID FROM dbo.CustomerMaster c
                             JOIN dbo.CustomerMaster p ON p.Id = c.ParentId
                             WHERE p.CustomerID = '${OWN}')`));

    show('who owns NAYAFP2023400247', await db.query(`
      SELECT c.CustomerID, c.ParentId, p.CustomerID AS parent, p.BusinessName AS parentName
      FROM dbo.CustomerMaster c
      LEFT JOIN dbo.CustomerMaster p ON p.Id = c.ParentId
      WHERE c.CustomerID = '${VEHICLE_OWNER}'`));
  });
});
