import { test } from '@playwright/test';
import { LoginPage } from '../src/pages/login.page';
import { DashboardPage } from '../src/pages/dashboard.page';
import { ManageVehiclePage } from '../src/pages/vehicle/manage-vehicle.page';
import { PARENT_ADMIN } from '../src/config/accounts';

/**
 * Does searching by registration on Manage Vehicles lose the branch filter?
 *
 * Selecting a branch lists its vehicles — 9 rows, including both subjects. Selecting the same branch
 * and then searching for one of those registrations returned nothing. If that reproduces, a user who
 * narrows a branch listing by registration is shown an empty grid for a vehicle that was on screen a
 * moment earlier.
 *
 * Counted at each stage so the step that empties the grid is identified rather than inferred.
 *
 *   TOOLS=true ENV=qa npx playwright test --project=tools --grep "probe manage vehicles search"
 */

const BRANCH = process.env.PROBE_BRANCH ?? 'NAYAFP2023400247';
const REGISTRATION = process.env.PROBE_VEHICLE ?? 'DL4CAV0123';

test.describe('Tools — probes @tools', () => {
  test('probe manage vehicles search', async ({ page }) => {
    test.setTimeout(420_000);

    await new LoginPage(page).navigate();
    await new LoginPage(page).login(PARENT_ADMIN.username, PARENT_ADMIN.password, PARENT_ADMIN.roleCode);
    await new DashboardPage(page).assertDashboardLoaded();

    const vehicles = new ManageVehiclePage(page);
    await vehicles.open('manage');

    const count = async (label: string) => {
      const rows = (await page.locator('table tbody tr').allTextContents())
        .map(r => r.replace(/\s+/g, ' ').trim())
        .filter(r => r && !/^no (data|record|matching)/i.test(r) && !/loading/i.test(r));
      console.log(`  ${label}: ${rows.length} row(s), contains ${REGISTRATION}: ${rows.some(r => r.includes(REGISTRATION))}`);
      return rows;
    };

    await count('on arrival, nothing selected');

    const branchSelect = page.locator('#branchOfficeUidVal');
    const option = (await branchSelect.locator('option').allTextContents()).find(o => o.includes(BRANCH));
    await branchSelect.selectOption({ label: option! });
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);
    await page.waitForTimeout(1_500);
    await count(`after selecting the branch ${BRANCH}`);

    // Now add the registration and search, which is what the lifecycle test did.
    page.on('response', async r => {
      if (r.request().method() === 'POST' && /vehicle/i.test(r.url())) {
        console.log(`    <- ${r.status()} ${r.url().split('/').pop()?.split('?')[0]}: ` +
          `${(await r.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 200)}`);
      }
    });
    await page.locator('#vehicleNoVal').fill(REGISTRATION);
    await page.locator('#btnManageVehiclesSearch').click();
    await page.waitForLoadState('networkidle', { timeout: 12_000 }).catch(() => undefined);
    await page.waitForTimeout(2_000);
    await count(`after searching for ${REGISTRATION}`);

    console.log(`  branch still selected: "${await branchSelect.inputValue()}"`);

    // And the reverse order: search first, then select the branch.
    await page.locator('#btnManageVehiclesReset').click().catch(() => undefined);
    await page.waitForTimeout(1_500);
    await page.locator('#vehicleNoVal').fill(REGISTRATION);
    await page.locator('#btnManageVehiclesSearch').click();
    await page.waitForLoadState('networkidle', { timeout: 12_000 }).catch(() => undefined);
    await page.waitForTimeout(2_000);
    await count('searching by registration alone, no branch selected');
  });
});
