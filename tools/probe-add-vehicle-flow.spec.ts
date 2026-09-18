import { test } from '@playwright/test';
import { LoginPage } from '../src/pages/login.page';
import { DashboardPage } from '../src/pages/dashboard.page';

/**
 * The Add Vehicles flow past the customer step, driven by a foreign-geography
 * officer.
 *
 * Customer lookup is already known to be unrestricted: an Ahmedabad (GJ_I/West)
 * Division Admin resolves a Noida (UP_UK/North) customer through
 * /Customer/GetFormName with no complaint. That is not the same as being allowed
 * to add — the server may check at insert — so this walks the rest of the form.
 *
 * SUBMIT=true actually creates the vehicle. Without it the flow stops at the
 * last screen before the write and prints what it would have submitted.
 *
 * Vehicle numbers come from the de-registered list in test-data, so Vahan
 * verification is expected to FAIL — which is the trigger that puts the vehicle
 * in the approval queue, and the whole point.
 *
 *   TOOLS=true ENV=qa SUBMIT=true npx playwright test --project=tools --grep "add vehicle flow"
 */

const PASSWORD = process.env.OFFICER_PASSWORD ?? 'Nayara@1';
const OFFICER = { label: 'Ahmedabad Division Admin (GJ_I / West)', mobile: '9073139002' };
const CUSTOMER_UID = process.env.ADD_UID ?? 'NAYAFP2023400247';
const VEHICLE = process.env.ADD_VEHICLE ?? 'DL3CAC7148';

test.use({ storageState: { cookies: [], origins: [] } });

test.describe('Tools — probes @tools', () => {
  test('add vehicle flow', async ({ page }) => {
    test.setTimeout(8 * 60_000);

    page.on('response', async r => {
      if (r.request().method() === 'POST') {
        const b = await r.text().catch(() => '');
        console.log(`  HTTP ${r.status()} ${r.url().replace(/^https?:\/\/[^/]+/, '')}  ${b.slice(0, 220)}`);
      }
    });

    const loginPage = new LoginPage(page);
    const dashboardPage = new DashboardPage(page);
    await loginPage.navigate();
    await loginPage.login(OFFICER.mobile, PASSWORD);
    await dashboardPage.assertDashboardLoaded();

    await page.goto('/Vehicle/AddVehicles', { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page.waitForTimeout(3_000);

    console.log(`\n${OFFICER.label}\n  customer UID : ${CUSTOMER_UID}\n  vehicle      : ${VEHICLE} (de-registered)`);

    await page.locator('#CustomerId').fill(CUSTOMER_UID);
    await page.locator('#CustomerId').blur();
    await page.waitForTimeout(3_500);
    await page.locator('#NoOfCards').fill('1');
    await page.waitForTimeout(1_000);

    const addBtn = page.locator('#btnAdd');
    console.log(`  #btnAdd enabled after filling count: ${await addBtn.isEnabled().catch(() => false)}`);
    await addBtn.click({ timeout: 10_000 }).catch(e => console.log(`  click failed: ${e}`));
    await page.waitForTimeout(4_000);

    const step2 = await page.evaluate(() => {
      const onScreen = (el: Element) => {
        const r = (el as HTMLElement).getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      };
      const txt = (el: Element) => (el.textContent || '').replace(/\s+/g, ' ').trim();
      return {
        url: location.href,
        fields: Array.from(document.querySelectorAll('input:not([type=hidden]), select'))
          .filter(onScreen)
          .map(f => {
            const e = f as HTMLInputElement;
            return `${e.tagName.toLowerCase()}#${e.id || '-'}[name=${e.name || '-'}]${e.readOnly ? ' RO' : ''}${e.placeholder ? ` ph="${e.placeholder}"` : ''}`;
          }),
        buttons: Array.from(document.querySelectorAll('button, a.btn')).filter(onScreen).map(b => `#${(b as HTMLElement).id || '-'}:"${txt(b)}"`),
        modal: Array.from(document.querySelectorAll('.modal.show')).map(m => txt(m).slice(0, 220)),
      };
    });
    console.log(`\n  after Add Vehicles — url ${step2.url}`);
    for (const f of step2.fields) console.log(`    field : ${f}`);
    console.log(`    buttons: ${step2.buttons.join(' | ')}`);
    if (step2.modal.length) console.log(`    MODAL: ${step2.modal.join(' | ')}`);

    if (process.env.SUBMIT !== 'true') {
      console.log('\n  SUBMIT not set — stopping before the write.');
      return;
    }

    // The measured controls, by id, rather than a "first visible input" guess:
    //   #VehicleNo_1  #VehicleType_1 (fuel) #Ownership_1 #TankSize_1 #btnVerify_1 #btnsubmit
    await page.locator('#VehicleNo_1').fill(VEHICLE);
    await page.waitForTimeout(800);

    console.log('\n  clicking Verify (Vahan) — a de-registered vehicle should FAIL here');
    await page.locator('#btnVerify_1').click({ timeout: 10_000 }).catch(e => console.log(`  verify click failed: ${e}`));
    await page.waitForTimeout(8_000);

    for (let i = 0; i < 3; i += 1) {
      const modal = page.locator('.modal.show').first();
      if (!(await modal.isVisible().catch(() => false))) break;
      console.log(`  VAHAN MODAL: "${((await modal.textContent()) ?? '').replace(/\s+/g, ' ').trim().slice(0, 240)}"`);
      const ok = modal.locator('button:visible, a:visible')
        .filter({ hasText: /^\s*(ok|yes|confirm|proceed|continue)\s*$/i }).first();
      if (!(await ok.isVisible().catch(() => false))) break;
      await ok.click({ timeout: 8_000 }).catch(() => undefined);
      await page.waitForTimeout(2_500);
    }

    // Whatever Vahan left behind, fill the remaining mandatory fields.
    const state = await page.evaluate(() => {
      const v = (id: string) => {
        const e = document.querySelector(id) as HTMLInputElement | null;
        return e ? `"${e.value}"${e.readOnly ? ' RO' : ''}${e.disabled ? ' DIS' : ''}` : '(absent)';
      };
      const sel = document.querySelector('#Ownership_1') as HTMLSelectElement | null;
      return {
        vehicleNo: v('#VehicleNo_1'),
        fuel: v('#VehicleType_1'),
        tank: v('#TankSize_1'),
        ownership: sel ? Array.from(sel.options).map(o => o.text.trim()).join(' / ') : '(absent)',
      };
    });
    console.log(`  after Vahan: vehicleNo=${state.vehicleNo} fuel=${state.fuel} tank=${state.tank}`);
    console.log(`  ownership options: ${state.ownership}`);

    if (!(await page.locator('#VehicleType_1').inputValue().catch(() => ''))) {
      await page.locator('#VehicleType_1').fill('Diesel').catch(() => undefined);
    }
    if (!(await page.locator('#TankSize_1').inputValue().catch(() => ''))) {
      await page.locator('#TankSize_1').fill('50').catch(() => undefined);
    }
    await page.locator('#Ownership_1').selectOption({ index: 1 }).catch(() => undefined);
    await page.waitForTimeout(800);

    console.log('\n  clicking Submit');
    await page.locator('#btnsubmit').click({ timeout: 10_000 }).catch(e => console.log(`  submit failed: ${e}`));
    await page.waitForTimeout(7_000);

    for (let i = 0; i < 4; i += 1) {
      const modal = page.locator('.modal.show').first();
      if (!(await modal.isVisible().catch(() => false))) break;
      console.log(`  MODAL: "${((await modal.textContent()) ?? '').replace(/\s+/g, ' ').trim().slice(0, 300)}"`);
      const ok = modal.locator('button:visible, a:visible')
        .filter({ hasText: /^\s*(ok|yes|confirm|proceed|continue)\s*$/i }).first();
      if (!(await ok.isVisible().catch(() => false))) break;
      await ok.click({ timeout: 8_000 }).catch(() => undefined);
      await page.waitForTimeout(3_000);
    }

    const errs = await page.evaluate(() =>
      Array.from(document.querySelectorAll('.error, .text-danger, .field-validation-error'))
        .filter(el => { const r = (el as HTMLElement).getBoundingClientRect(); return r.width > 0 && r.height > 0; })
        .map(el => (el.textContent || '').replace(/\s+/g, ' ').trim())
        .filter(t => t && t !== '*'));
    console.log(`  inline messages: ${errs.join(' | ') || '(none)'}`);
  });
});
