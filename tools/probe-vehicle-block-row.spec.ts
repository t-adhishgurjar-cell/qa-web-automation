import { test } from '../src/fixtures/page.fixtures';
import { PARENT_ADMIN } from '../src/config/accounts';
import { ManageVehiclePage } from '../src/pages/vehicle/manage-vehicle.page';
import { vehiclesUnder } from '../src/helpers/vehicle-state.helper';

/**
 * How a vehicle is actually blocked.
 *
 * The row for an Active vehicle offers no link or button, so the control is not
 * where the test looked. The grid has ten columns and seven are on screen, so
 * the likeliest answer is an action column scrolled out of view — but the
 * Customer Status screen puts its action in a screen-level button instead, and
 * guessing between those two is how afternoons go missing.
 *
 *   TOOLS=true ENV=qa npx playwright test --project=tools --grep "vehicle block row"
 */

test.use({ storageState: { cookies: [], origins: [] } });

test.describe('Tools — probes @tools', () => {
  test('probe vehicle block row', async ({ loginPage, dashboardPage, page }) => {
    test.setTimeout(8 * 60_000);

    await loginPage.navigate();
    await loginPage.login(PARENT_ADMIN.username, PARENT_ADMIN.password, PARENT_ADMIN.roleCode);
    await dashboardPage.assertDashboardLoaded();

    const fleet = await vehiclesUnder(PARENT_ADMIN.ownCustomerId);
    const target = fleet.find(v => v.VehicleStatus === 401) ?? fleet[0];
    console.log(`\nlooking at ${target.VehicleNo} (status ${target.VehicleStatus})\n`);

    const vehicles = new ManageVehiclePage(page);
    await vehicles.open('blockUnblock');
    await vehicles.fillInput(vehicles.blockVehicleNo, target.VehicleNo);
    // The field is an autocomplete; typing alone may leave a suggestion open
    // that swallows the Search click.
    await page.keyboard.press('Escape');
    await vehicles.clickElement(vehicles.blockSearch);
    await page.waitForTimeout(4_000);

    const detail = await page.evaluate((registration: string) => {
      const txt = (el: Element | null) => (el?.textContent || '').replace(/\s+/g, ' ').trim();
      const table = Array.from(document.querySelectorAll('table')).find(t =>
        (t.textContent || '').includes(registration)
      );
      if (!table) return { found: false, headers: [], cells: [], rowHtml: '', screenButtons: [] as string[] };

      const headers = Array.from(table.querySelectorAll('thead th')).map(th => txt(th));
      const row = Array.from(table.querySelectorAll('tbody tr')).find(r =>
        (r.textContent || '').includes(registration)
      );
      const cells = row ? Array.from(row.querySelectorAll('td')).map((td, i) => `[${i}] ${txt(td) || '(empty)'}`) : [];

      // Everything clickable on the page, not just in the row — the action may
      // be a screen-level control that operates on a selected row.
      const screenButtons = Array.from(document.querySelectorAll('button, a.btn, input[type=button]'))
        .filter(el => {
          const r = (el as HTMLElement).getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        })
        .map(el => `${(el as HTMLElement).id || '(no id)'}:"${txt(el)}"`);

      return {
        found: true,
        headers,
        cells,
        rowHtml: (row?.innerHTML || '').replace(/\s+/g, ' ').slice(0, 900),
        screenButtons,
      };
    }, target.VehicleNo);

    console.log(`grid found: ${detail.found}`);
    console.log(`headers (${detail.headers.length}): ${detail.headers.join(' | ')}`);
    console.log(`\ncells:`);
    detail.cells.forEach(c => console.log(`  ${c}`));
    console.log(`\nrow html: ${detail.rowHtml}`);
    console.log(`\nvisible controls on the page:`);
    detail.screenButtons.forEach(b => console.log(`  ${b}`));
  });
});
