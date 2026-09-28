import { test } from '@playwright/test';
import { LoginPage } from '../src/pages/login.page';
import { DashboardPage } from '../src/pages/dashboard.page';
import { ManageVehiclePage } from '../src/pages/vehicle/manage-vehicle.page';
import { PARENT_ADMIN } from '../src/config/accounts';
import { DbHelper } from '../src/helpers/db.helper';

/**
 * Why three customer-side vehicle screens find nothing for a vehicle that is Active on their own branch.
 *
 * Manage Vehicles, Set Prepaid Limit and De-map each returned 0 rows for DL4CU8472 — Active at 401
 * under NAYAFP2023400247, which is a branch of this account's own customer. Three screens behaving
 * identically points at something common: most likely a branch filter these grids require and the
 * search did not set. The page object's own notes say #mvBranchLocation is present for a parent admin
 * and absent for a branch admin, so such a control exists on at least one of them.
 *
 * This dumps each screen's controls, then searches with and without the branch selected, so "the grid
 * needs a branch" is separated from "the vehicle is missing".
 *
 *   TOOLS=true ENV=qa npx playwright test --project=tools --grep "probe customer vehicle screens"
 */

/**
 * Two subjects, differing only in age.
 *
 * DL4CU8472 was approved roughly half an hour before this probe first ran and was found on Manage
 * Vehicles and De-map. DL4CAV0123 was approved seconds before the lifecycle run searched for it and
 * was found on neither. If the older one appears and the newer one does not, the customer-side grids
 * lag behind approval rather than being broken — and a regression suite has to wait rather than assert
 * immediately.
 */
const REGISTRATIONS = (process.env.PROBE_VEHICLES ?? 'DL4CU8472,DL4CAV0123').split(',');
const REGISTRATION = REGISTRATIONS[0];
const BRANCH = process.env.PROBE_BRANCH ?? 'NAYAFP2023400247';

test.describe('Tools — probes @tools', () => {
  test('probe customer vehicle screens', async ({ page }) => {
    test.setTimeout(600_000);

    const vehicle = await DbHelper.query(`
      SELECT VehicleNo, CustomerID, VehicleStatus FROM dbo.VehicleDetails WHERE VehicleNo = @v`,
      { v: REGISTRATION });
    console.log(`  the vehicle: ${JSON.stringify(vehicle)}`);
    console.log(`  the account's own customer: ${PARENT_ADMIN.ownCustomerId}, role ${PARENT_ADMIN.roleCode}`);

    await new LoginPage(page).navigate();
    await new LoginPage(page).login(PARENT_ADMIN.username, PARENT_ADMIN.password, PARENT_ADMIN.roleCode);
    await new DashboardPage(page).assertDashboardLoaded();

    const vehicles = new ManageVehiclePage(page);

    for (const screen of ['manage', 'purchaseLimit', 'demap'] as const) {
      console.log(`\n=== ${screen} — ${ManageVehiclePage.ROUTES[screen]} ===`);
      await vehicles.open(screen);

      const controls = await page.evaluate(() =>
        Array.from(document.querySelectorAll('input,select,button'))
          .filter(e => e.id && !!(e as HTMLElement).offsetParent)
          .map(e => {
            const el = e as HTMLInputElement;
            const options = el.tagName === 'SELECT'
              ? Array.from((el as unknown as HTMLSelectElement).options).slice(0, 4).map(o => o.text.trim()).join(' | ')
              : '';
            return `${el.tagName.toLowerCase()}#${el.id} type=${el.type}` +
              `${options ? ` options[${options}]` : ''}`;
          }));
      console.log('  controls:');
      for (const c of controls) console.log(`    ${c}`);

      // Any branch selector, and what it offers.
      const branchSelect = page.locator('select#mvBranchLocation, select[id*="ranch"]').first();
      if (await branchSelect.isVisible().catch(() => false)) {
        const options = await branchSelect.locator('option').allTextContents();
        console.log(`  branch selector offers: ${options.slice(0, 6).map(o => o.trim()).join(' | ')}`);
        const wanted = options.find(o => o.includes(BRANCH));
        if (wanted) {
          await branchSelect.selectOption({ label: wanted }).catch(() => undefined);
          console.log(`  selected "${wanted.trim()}"`);
          await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);
        } else {
          console.log(`  ${BRANCH} is not among the branch options`);
        }
      } else {
        console.log('  no branch selector on this screen');
      }

      // On de-map there is no branch filter, only a registration — so search it explicitly and
      // watch what the screen asks the server.
      if (screen === 'demap') {
        page.on('response', async r => {
          if (r.request().method() === 'POST' && /map|vehicle/i.test(r.url())) {
            console.log(`    <- ${r.status()} ${r.url().split('/').pop()?.split('?')[0]}: ` +
              `${(await r.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 300)}`);
          }
        });
        await page.locator('#dmVehicleNo').fill(REGISTRATION);
        await page.locator('#btnDeMapSearch').click();
        await page.waitForLoadState('networkidle', { timeout: 12_000 }).catch(() => undefined);
        await page.waitForTimeout(2_500);
        const said = await page.evaluate(() =>
          Array.from(document.querySelectorAll('.modal.show, .toast.show, .text-danger, [id$="_error"]'))
            .filter(e => !!(e as HTMLElement).offsetParent)
            .map(e => (e.textContent || '').replace(/\s+/g, ' ').trim())
            .filter(t => t && !/^[*\s]+$/.test(t)));
        console.log(`  after searching ${REGISTRATION}: ${[...new Set(said)].join(' || ') || 'no message'}`);

        // What the De-Map control actually is. A click on "button, a, .btn" filtered by text timed
        // out, so the element is something else — a checkbox, a styled span, or outside the row.
        const anatomy = await page.evaluate(() => {
          const out: string[] = [];
          document.querySelectorAll('table').forEach((t, ti) => {
            out.push(`table[${ti}] id="${t.id}" rows=${t.querySelectorAll('tbody tr').length}`);
            t.querySelectorAll('tbody tr').forEach((tr, ri) => {
              tr.querySelectorAll('td').forEach((td, ci) => {
                const inner = Array.from(td.querySelectorAll('*')).map(e =>
                  `<${e.tagName.toLowerCase()}${e.id ? ` id=${e.id}` : ''}` +
                  `${(e as HTMLElement).className ? ` class="${(e as HTMLElement).className}"` : ''}>`);
                if (/de-?map/i.test(td.textContent || '') || inner.length) {
                  out.push(`  r${ri}c${ci} text="${(td.textContent || '').trim().slice(0, 30)}" ${inner.join(' ')}`);
                }
              });
            });
          });
          return out.slice(0, 30);
        });
        console.log('  de-map grid anatomy:');
        for (const a of anatomy) console.log(`    ${a}`);

        // The action is evidently not inside a cell, so list everything clickable on the page.
        const clickable = await page.evaluate(() =>
          Array.from(document.querySelectorAll('button, a, input[type=button], input[type=submit], input[type=checkbox], .btn'))
            .filter(e => !!(e as HTMLElement).offsetParent)
            .map(e => `<${e.tagName.toLowerCase()}> id="${e.id}" class="${(e as HTMLElement).className}" ` +
              `text="${(e.textContent || '').trim().slice(0, 28)}"`));
        console.log('  everything clickable after the search:');
        for (const c of clickable) console.log(`    ${c}`);

        const headers = await page.evaluate(() =>
          Array.from(document.querySelectorAll('#dmDetailTable th')).map(h => (h.textContent || '').trim()));
        console.log(`  dmDetailTable headers: ${headers.join(' | ')}`);
      }

      // What the grid holds, and whether each subject is in it.
      const unfiltered = await page.locator('table tbody tr').allTextContents();
      const rows = unfiltered.map(r => r.replace(/\s+/g, ' ').trim())
        .filter(r => r && !/^no (data|record|matching)/i.test(r));
      console.log(`  grid holds ${rows.length} row(s)`);
      for (const reg of REGISTRATIONS) {
        const age = await DbHelper.query<{ ApprovedOn: string }>(
          `SELECT ApprovedOn FROM dbo.VehicleDetails WHERE VehicleNo = @v`, { v: reg });
        console.log(`    ${reg}: in the grid ${rows.some(r => r.includes(reg))}, ` +
          `approved ${age[0]?.ApprovedOn ?? 'unknown'}`);
      }
      for (const r of rows.slice(0, 3)) console.log(`    ${r.slice(0, 140)}`);
    }
  });
});
