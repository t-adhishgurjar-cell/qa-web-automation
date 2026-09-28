import { test } from '@playwright/test';
import { LoginPage } from '../src/pages/login.page';
import { DashboardPage } from '../src/pages/dashboard.page';
import { ManageVehiclePage } from '../src/pages/vehicle/manage-vehicle.page';
import { DbHelper } from '../src/helpers/db.helper';

/**
 * Why blocking a vehicle reported nothing and changed nothing.
 *
 * W-VEH-001 failed: DL3CW9474 stayed at 401 after Block, and the screen said "". That is the same
 * shape as two mistakes already made today — an action whose confirmation was never answered, so no
 * request was sent and the vehicle stayed put for the wrong reason. The page object does look for a
 * confirmation, but with an anchored matcher, /^(block|unblock|…)$/i, which misses "Yes, block" or a
 * label carrying whitespace.
 *
 * So this dumps the dialog and watches the network, which separates "the app refused" from "the
 * click never completed".
 *
 *   TOOLS=true ENV=qa npx playwright test --project=tools --grep "probe block dialog"
 */

const REGISTRATION = process.env.PROBE_VEHICLE ?? 'DL3CW9474';
const USER = { username: process.env.PROBE_USER ?? '9073275904', password: process.env.OFFICER_PASSWORD ?? 'Nayara@1' };

test.describe('Tools — probes @tools', () => {
  test('probe block dialog', async ({ page }) => {
    test.setTimeout(420_000);

    const status = async () => (await DbHelper.query<{ VehicleStatus: number }>(
      `SELECT VehicleStatus FROM dbo.VehicleDetails WHERE VehicleNo = @v`, { v: REGISTRATION }))[0]?.VehicleStatus ?? null;

    console.log(`  ${REGISTRATION} starts at ${await status()}`);

    await new LoginPage(page).navigate();
    await new LoginPage(page).login(USER.username, USER.password);
    await new DashboardPage(page).assertDashboardLoaded();

    page.on('response', async r => {
      if (r.request().method() === 'POST' && /vehicle|block/i.test(r.url())) {
        console.log(`    <- ${r.status()} ${r.url().split('/').pop()?.split('?')[0]}: ` +
          `${(await r.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 240)}`);
      }
    });

    const vehicles = new ManageVehiclePage(page);
    await vehicles.open('blockUnblock');
    // The grid holds 189,607 rows and shows the first page, so the vehicle has to be searched for.
    // The search takes the field and the button explicitly — #txtVehicleNo and
    // #btnVehicleBlockSearch on this screen.
    const rows = await vehicles.search(vehicles.blockVehicleNo, vehicles.blockSearch, REGISTRATION)
      .catch(e => { console.log(`  search failed: ${String(e).slice(0, 160)}`); return [] as string[]; });
    console.log(`  search returned ${rows.length} row(s)`);
    for (const r of rows.slice(0, 3)) console.log(`    ${r.slice(0, 160)}`);

    // The row, and whatever control it offers.
    const row = page.locator('table tbody tr').filter({ hasText: REGISTRATION }).first();
    console.log(`\n  row: ${((await row.textContent().catch(() => '')) ?? '').replace(/\s+/g, ' ').trim().slice(0, 180)}`);

    const controls = await row.evaluate(tr =>
      Array.from(tr.querySelectorAll('button, a, input[type=checkbox], .btn, [role=switch]'))
        .map(e => `<${e.tagName.toLowerCase()}> id="${e.id}" class="${(e as HTMLElement).className}" ` +
          `text="${(e.textContent || '').trim().slice(0, 24)}"` +
          (e instanceof HTMLInputElement ? ` checked=${e.checked}` : ''))
    ).catch(() => []);
    console.log(`  controls in the row:`);
    for (const c of controls) console.log(`    ${c}`);

    // Take the action the page offers, then report the dialog verbatim.
    // The control is a Bootstrap switch carrying the registration in data-vno — a better handle
    // than row position, since a grid of this size reorders on sort and acting on the wrong row
    // blocks somebody else's vehicle.
    const toggle = page.locator(`input.toggle-status[data-vno="${REGISTRATION}"]`).first();
    console.log(`\n  switch found: ${await toggle.isVisible().catch(() => false)}, ` +
      `checked=${await toggle.isChecked().catch(() => null)} (checked = Active)`);
    if (!(await toggle.isVisible().catch(() => false))) {
      console.log('\n  no control on this row for this role');
      return;
    }
    await toggle.click();

    const modal = page.locator('.modal.show').first();
    if (await modal.waitFor({ state: 'visible', timeout: 8_000 }).then(() => true).catch(() => false)) {
      const text = ((await modal.textContent()) ?? '').replace(/\s+/g, ' ').trim();
      const buttons = await modal.evaluate(m =>
        Array.from(m.querySelectorAll('button, .btn')).map(b =>
          `"${(b.textContent || '').trim()}" id="${b.id}"${(b as HTMLButtonElement).disabled ? ' DISABLED' : ''}`));
      console.log(`\n  dialog: ${text.slice(0, 220)}`);
      console.log(`  buttons: ${buttons.join('  |  ')}`);

      // The dialog asks for a Reason and marks it required. Clicking Block without it is refused
      // in silence — no message, no request, no status change — which is why the regression test
      // reported a block that had never been attempted.
      const fields = await modal.evaluate(m =>
        Array.from(m.querySelectorAll('input,select,textarea')).map(e => {
          const el = e as HTMLInputElement;
          return `${el.tagName.toLowerCase()}#${el.id || '(no id)'} name="${el.name}" type=${el.type}` +
            `${el.required || el.getAttribute('data-val-required') !== null ? ' REQUIRED' : ''}`;
        }));
      console.log(`  fields: ${fields.join('  |  ') || 'none'}`);

      for (const f of await modal.locator('textarea:visible, input[type=text]:visible').all()) {
        await f.fill('Blocked by QA regression run — will be unblocked.');
        console.log(`  filled a reason field`);
      }

      // Answer it by text, tolerating whitespace and prefixes like "Yes, block".
      const yes = modal.locator('button:visible, .btn:visible')
        .filter({ hasText: /^\s*(yes|ok|confirm|block|unblock|proceed|submit)/i })
        .filter({ hasNotText: /^\s*(no|cancel|close)/i }).first();
      if (await yes.isVisible().catch(() => false)) {
        console.log(`  answering "${((await yes.textContent()) ?? '').trim()}"`);
        await yes.click();
        await page.waitForLoadState('networkidle', { timeout: 12_000 }).catch(() => undefined);
        await page.waitForTimeout(2_000);
      } else {
        console.log('  nothing in the dialog matched an accept');
      }
    } else {
      console.log('\n  no dialog appeared at all');
    }

    const said = await page.evaluate(() =>
      Array.from(document.querySelectorAll('.modal.show, .toast.show, #succ-mess-text, #error-mess-text, #failer-mess-text'))
        .filter(e => !!(e as HTMLElement).offsetParent)
        .map(e => (e.textContent || '').replace(/\s+/g, ' ').trim()).filter(t => t.length > 2));
    console.log(`\n  on screen: ${[...new Set(said)].join('  ||  ') || 'nothing'}`);
    console.log(`  ${REGISTRATION} is now at ${await status()}`);
  });
});
