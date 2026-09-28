import { test } from '../src/fixtures/page.fixtures';

/**
 * The customer-management screens and who is entitled to each.
 *
 * Needed to test hierarchy visibility on the right surface. The onboarding list
 * shows a region admin nothing at all — not the OD application and not anything
 * else — so it is a maker's screen, and drawing a conclusion about OD from it
 * would have been wrong. This asks the menu tables which screens exist under
 * Customer Management and which roles they are mapped to.
 *
 *   TOOLS=true ENV=qa npx playwright test --project=tools --grep "probe customer menus"
 */

test.describe('Tools — probes @tools', () => {
  test('probe customer menus', async ({ db }) => {
    const show = (title: string, rows: unknown[]) => {
      console.log(`\n--- ${title} (${rows.length}) ---`);
      for (const row of rows.slice(0, 40)) console.log('  ' + JSON.stringify(row));
      if (!rows.length) console.log('  (none)');
    };

    show('screens under the Customer controller', await db.query(`
      SELECT MenuId, MenuName, Controller, Action, ParentMenuId, StatusFlag
      FROM dbo.MenuMaster WHERE Controller = 'Customer' ORDER BY MenuOrder`));

    // dbo.Roles names the column RoleName; r.Name fails with "Invalid column name".
    show('which roles each customer screen is mapped to', await db.query(`
      SELECT m.MenuName, r.RoleName
      FROM dbo.RoleMenuMappings rmm
      JOIN dbo.MenuMaster m ON m.MenuId = rmm.MenuId
      JOIN dbo.Roles r ON r.Id = rmm.RoleId
      WHERE m.Controller = 'Customer' AND rmm.StatusFlag = 1
      ORDER BY m.MenuName, r.RoleName`));
  });
});
