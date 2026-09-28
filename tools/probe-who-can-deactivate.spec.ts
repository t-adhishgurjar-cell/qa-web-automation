import { test } from '../src/fixtures/page.fixtures';

/**
 * Which roles are granted Activate / Deactivate Customer, and which accounts this suite holds have
 * one of them.
 *
 * Verifying NFP-1913 needs the customer switched off, and three accounts have already failed to
 * reach the screen: FP Admin cannot sign in at all ("Password expired. Reset required."), and
 * neither the Ahmedabad State Admin nor the Ahmedabad I Division Admin renders #searchInput. Rather
 * than keep trying accounts, ask the role mapping.
 *
 *   TOOLS=true ENV=qa npx playwright test --project=tools --grep "probe who can deactivate"
 */

const HELD = ['9611200199','9612200200','9616200104','9616200106','9200000000',
              '9072986100','9073068501','9073139002','9063600900','9111181007','7486836430',
              '9073209903','9073275904','9073340105'];

test.describe('Tools — probes @tools', () => {
  test('probe who can deactivate', async ({ db }) => {
    const show = (title: string, rows: unknown[]) => {
      console.log(`\n--- ${title} (${rows.length}) ---`);
      for (const row of rows.slice(0, 30)) console.log('  ' + JSON.stringify(row));
      if (!rows.length) console.log('  (none)');
    };

    show('roles granted Activate / Deactivate Customer', await db.query(`
      SELECT r.Id AS RoleId, r.RoleName
      FROM dbo.RoleMenuMappings rmm
      JOIN dbo.MenuMaster m ON m.MenuId = rmm.MenuId
      JOIN dbo.Roles r ON r.Id = rmm.RoleId
      WHERE m.Action = 'ManageCustomerStatus' AND rmm.StatusFlag = 1
      ORDER BY r.RoleName`));

    show('accounts this suite holds, and whether their roles include it', await db.query(`
      SELECT u.UserName, ut.Code AS userType, r.RoleName,
             CASE WHEN EXISTS (
               SELECT 1 FROM dbo.RoleMenuMappings rmm
               JOIN dbo.MenuMaster m ON m.MenuId = rmm.MenuId
               WHERE rmm.RoleId = r.Id AND m.Action = 'ManageCustomerStatus' AND rmm.StatusFlag = 1
             ) THEN 'YES' ELSE 'no' END AS canDeactivate
      FROM dbo.Users u
      JOIN dbo.UserTypesMaster ut ON ut.Id = u.UserTypeId
      JOIN dbo.UserRoleMappings urm ON urm.UserId = u.Id AND urm.StatusFlag = 1
      JOIN dbo.Roles r ON r.Id = urm.RoleId
      WHERE u.UserName IN (${HELD.map(m => `'${m}'`).join(',')}) AND u.IsActive = 1
      ORDER BY canDeactivate DESC, u.UserName`));

    show('any active user whose role grants it, as a fallback', await db.query(`
      SELECT TOP 15 u.UserName, ut.Code AS userType, r.RoleName,
             m2.BusinessStateId, m2.DivisionId
      FROM dbo.Users u
      JOIN dbo.UserTypesMaster ut ON ut.Id = u.UserTypeId
      JOIN dbo.UserRoleMappings urm ON urm.UserId = u.Id AND urm.StatusFlag = 1
      JOIN dbo.Roles r ON r.Id = urm.RoleId
      LEFT JOIN dbo.UserLocationMapping m2 ON m2.UserId = u.Id
      WHERE u.IsActive = 1 AND EXISTS (
        SELECT 1 FROM dbo.RoleMenuMappings rmm
        JOIN dbo.MenuMaster m ON m.MenuId = rmm.MenuId
        WHERE rmm.RoleId = r.Id AND m.Action = 'ManageCustomerStatus' AND rmm.StatusFlag = 1)
      ORDER BY u.Id DESC`));
  });
});
