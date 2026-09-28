import { test } from '../src/fixtures/page.fixtures';

/**
 * Who is granted the two vehicle screens nothing could open?
 *
 * View Vehicles and Vehicle RO Mapping were refused to the Kolkata State Admin, the customer's parent
 * admin and FP Admin alike. Both are active final pages in dbo.MenuMaster, so either they belong to a
 * role none of those three holds — entitlement working — or nothing is granted them, which would make
 * them dead menu entries.
 *
 *   TOOLS=true ENV=qa npx playwright test --project=tools --grep "probe unreachable vehicle screens"
 */

const SCREENS = ['ViewVehicles', 'VehicleROMapping'];

test.describe('Tools — probes @tools', () => {
  test('probe unreachable vehicle screens', async ({ db }) => {
    for (const action of SCREENS) {
      const menu = await db.query(`
        SELECT MenuId, MenuName, Controller, Action, StatusFlag
        FROM dbo.MenuMaster WHERE Action = '${action}'`);
      console.log(`\n=== ${action} ===`);
      console.log(`  menu: ${JSON.stringify(menu)}`);

      const roles = await db.query<{ RoleName: string; users: number }>(`
        SELECT r.RoleName,
               (SELECT COUNT(*) FROM dbo.UserRoleMappings urm
                 JOIN dbo.Users u ON u.Id = urm.UserId
                 WHERE urm.RoleId = r.Id AND urm.StatusFlag = 1 AND u.IsActive = 1) AS users
        FROM dbo.RoleMenuMappings rmm
        JOIN dbo.MenuMaster m ON m.MenuId = rmm.MenuId
        JOIN dbo.Roles r ON r.Id = rmm.RoleId
        WHERE m.Action = '${action}' AND rmm.StatusFlag = 1
        ORDER BY users DESC`);
      console.log(`  granted to ${roles.length} role(s):`);
      for (const r of roles.slice(0, 8)) console.log(`    ${r.RoleName} (${r.users} active user(s))`);
      if (!roles.length) console.log('    NOTHING — no role is granted this screen');

      const holders = await db.query(`
        SELECT TOP 5 u.UserName, ut.Code AS userType, r.RoleName
        FROM dbo.Users u
        JOIN dbo.UserTypesMaster ut ON ut.Id = u.UserTypeId
        JOIN dbo.UserRoleMappings urm ON urm.UserId = u.Id AND urm.StatusFlag = 1
        JOIN dbo.Roles r ON r.Id = urm.RoleId
        WHERE u.IsActive = 1 AND EXISTS (
          SELECT 1 FROM dbo.RoleMenuMappings rmm
          JOIN dbo.MenuMaster m ON m.MenuId = rmm.MenuId
          WHERE rmm.RoleId = r.Id AND m.Action = '${action}' AND rmm.StatusFlag = 1)`);
      console.log(`  example accounts that hold it: ${JSON.stringify(holders)}`);
    }
  });
});
