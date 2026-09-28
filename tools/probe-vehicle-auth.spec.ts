import { test } from '@playwright/test';
import { LoginPage } from '../src/pages/login.page';
import { DashboardPage } from '../src/pages/dashboard.page';
import { ManageVehiclePage } from '../src/pages/vehicle/manage-vehicle.page';
import { DbHelper } from '../src/helpers/db.helper';
import { PARENT_ADMIN } from '../src/config/accounts';

/**
 * Why Vehicle Authentication returns an empty panel for a live vehicle.
 *
 * W-VEH-006 failed: DL3CW9474 exists in VehicleDetails under NAYAFP2023400247 at 401, yet the
 * screen's OTP SPOC and SPOC mobile both came back empty. Two readings, as ever — the lookup failed,
 * or the vehicle genuinely has no authentication configured and an empty panel is the truthful answer
 * for it.
 *
 * Today has already produced three cases where the second reading was the right one, so this watches
 * the request and checks the data behind it before anything is called a defect.
 *
 *   TOOLS=true ENV=qa npx playwright test --project=tools --grep "probe vehicle auth"
 */

const REGISTRATION = process.env.PROBE_VEHICLE ?? 'DL3CW9474';
// The same account the failing test uses: a customer's own parent admin, not an officer. An earlier
// probe ran as an officer and found the screen empty, which proved nothing about the test — the
// screen may simply not be entitled to that role.
const USER = PARENT_ADMIN;

test.describe('Tools — probes @tools', () => {
  test('probe vehicle auth', async ({ page }) => {
    test.setTimeout(420_000);

    // What the data says about this vehicle's authentication, before opening the screen.
    const cols = await DbHelper.query<{ c: string }>(`
      SELECT COLUMN_NAME AS c FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_NAME = 'VehicleDetails'
        AND (COLUMN_NAME LIKE '%Auth%' OR COLUMN_NAME LIKE '%Spoc%' OR COLUMN_NAME LIKE '%Otp%')
      ORDER BY ORDINAL_POSITION`);
    console.log(`  VehicleDetails auth columns: ${cols.map(r => r.c).join(', ') || '(none)'}`);

    const vehicle = await DbHelper.query(`
      SELECT VehicleNo, CustomerID, VehicleStatus, VahanStatus
      FROM dbo.VehicleDetails WHERE VehicleNo = @v`, { v: REGISTRATION });
    console.log(`  the vehicle: ${JSON.stringify(vehicle)}`);

    await new LoginPage(page).navigate();
    await new LoginPage(page).login(USER.username, USER.password, PARENT_ADMIN.roleCode);
    await new DashboardPage(page).assertDashboardLoaded();

    page.on('response', async r => {
      if (/auth|vehicle/i.test(r.url()) && r.request().method() === 'POST') {
        console.log(`    <- ${r.status()} ${r.url().split('/').pop()?.split('?')[0]}: ` +
          `${(await r.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 300)}`);
      }
    });

    const vehicles = new ManageVehiclePage(page);
    await vehicles.open('authentication');

    const fields = await page.evaluate(() =>
      Array.from(document.querySelectorAll('input,select,textarea,button'))
        .filter(e => e.id && !!(e as HTMLElement).offsetParent)
        .map(e => {
          const el = e as HTMLInputElement;
          return `${el.tagName.toLowerCase()}#${el.id} type=${el.type} value="${(el.value || '').slice(0, 24)}"`;
        }));
    console.log(`\n  visible fields on arrival:`);
    for (const f of fields) console.log(`    ${f}`);

    console.log(`\n  searching ${REGISTRATION}`);
    // Fill BOTH fields explicitly and search. The page object fills the customer id only when it
    // judges the field editable, and it came back empty — so the previous attempt may have searched
    // on a vehicle number alone. If the screen needs both, that is the page object's bug rather than
    // the application's, and this distinguishes them.
    await page.locator('#vaVehicleNo').fill(REGISTRATION);
    await page.locator('#vaCustomerId').fill('NAYAFP2023400247').catch(e =>
      console.log(`  could not fill the customer id: ${String(e).split('\n')[0]}`));
    console.log(`  before searching: vehicle="${await page.locator('#vaVehicleNo').inputValue()}" ` +
      `customer="${await page.locator('#vaCustomerId').inputValue()}"`);
    await page.locator('#btnVehicleAuthSearch').click();
    await page.waitForLoadState('networkidle', { timeout: 12_000 }).catch(() => undefined);
    await page.waitForTimeout(2_500);
    const result = 'searched with both fields filled';
    console.log(`  searchAuthentication returned: ${JSON.stringify(result)}`);

    const after = await page.evaluate(() => {
      const values = Array.from(document.querySelectorAll('input,select'))
        .filter(e => e.id && !!(e as HTMLElement).offsetParent)
        .map(e => `${e.id}="${((e as HTMLInputElement).value || '').slice(0, 30)}"`);
      const said = Array.from(document.querySelectorAll('.modal.show, .toast.show, .text-danger, [id$="_error"]'))
        .filter(e => !!(e as HTMLElement).offsetParent)
        .map(e => (e.textContent || '').replace(/\s+/g, ' ').trim())
        .filter(t => t && !/^[*\s]+$/.test(t));
      return { values, said: [...new Set(said)] };
    });
    console.log(`\n  field values after the search:`);
    for (const v of after.values) console.log(`    ${v}`);
    console.log(`  messages: ${after.said.join('  ||  ') || 'none'}`);
  });
});
