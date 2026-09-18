import { test } from '@playwright/test';
import { LoginPage } from '../src/pages/login.page';
import { DashboardPage } from '../src/pages/dashboard.page';
import { DbHelper } from '../src/helpers/db.helper';
import * as XLSX from 'xlsx';
import * as path from 'path';

/**
 * Bulk de-mapping across divisions — the change request's second activity.
 *
 * Subject: two vehicles belonging to NAYAFP2023400255 (Gurgaon, HR_HP_PB,
 * North). Operator: the Ahmedabad I Division Admin (GJ_I, West). If the CR is
 * delivered on this side too, an officer should be able to de-map vehicles that
 * live in a division other than its own.
 *
 * The template is Vehicle number | Branch location | Reason for De-Mapping, and
 * the form also carries #bdCustomerId, so the customer is named twice — once on
 * the form and once per row. Step one reads the single de-map view to learn what
 * "Branch location" is actually called for these vehicles, rather than guessing
 * between a UID and a display name.
 *
 * DEMAP=true performs it. Without it, the sheet is built and the flow stops
 * before the commit.
 *
 * THIS DE-MAPS REAL VEHICLES — a de-mapped vehicle stops transacting. Only
 * vehicles this suite created are used.
 *
 *   TOOLS=true ENV=qa DEMAP=true npx playwright test --project=tools --grep "bulk demap run"
 */

const OFFICER = { label: 'Ahmedabad I Division Admin (GJ_I / West)', mobile: '9073139002' };
const PASSWORD = process.env.OFFICER_PASSWORD ?? 'Nayara@1';
const CUSTOMER = process.env.DEMAP_CUSTOMER ?? 'NAYAFP2023400255';
const VEHICLES = (process.env.DEMAP_VEHICLES ?? 'DL3CW9470,DL3CAX0909').split(',').map(s => s.trim());

test.use({ storageState: { cookies: [], origins: [] } });

test.describe('Tools — probes @tools', () => {
  test('bulk demap run', async ({ page }) => {
    test.setTimeout(10 * 60_000);

    const before = await DbHelper.query<{ VehicleNo: string; VehicleStatus: number; CustomerID: string }>(
      `SELECT VehicleNo, VehicleStatus, CustomerID FROM dbo.VehicleDetails
        WHERE VehicleNo IN (${VEHICLES.map(v => `'${v}'`).join(',')})`);
    console.log(`before: ${JSON.stringify(before)}`);
    const live = before.filter(b => b.VehicleStatus === 401);
    const needed = Number(process.env.DEMAP_MIN ?? 2);
    test.skip(live.length < needed, `need ${needed} Active vehicle(s), have ${live.length}`);

    page.on('response', async r => {
      if (r.request().method() === 'POST' && /Demap|DeMap/i.test(r.url())) {
        console.log(`  HTTP ${r.status()} ${r.url().replace(/^https?:\/\/[^/]+/, '')}  ${(await r.text().catch(() => '')).slice(0, 300)}`);
      }
    });

    const loginPage = new LoginPage(page);
    const dashboardPage = new DashboardPage(page);
    await loginPage.navigate();
    await loginPage.login(OFFICER.mobile, PASSWORD);
    await dashboardPage.assertDashboardLoaded();

    await page.goto('/Vehicle/DeMapVehicle', { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page.waitForTimeout(3_000);

    // ── 1. what does the single view call this vehicle's branch? ──────────
    await page.locator('#dmVehicleNo').fill(VEHICLES[0]);
    await page.locator('#btnDeMapSearch').click({ timeout: 10_000 }).catch(() => undefined);
    await page.waitForTimeout(4_000);
    const detail = await page.evaluate(() => {
      const onScreen = (el: Element) => { const b = (el as HTMLElement).getBoundingClientRect(); return b.width > 0 && b.height > 0; };
      return {
        text: (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 500),
        values: Array.from(document.querySelectorAll('input:not([type=hidden])')).filter(onScreen)
          .map(i => `#${(i as HTMLInputElement).id || '-'}="${(i as HTMLInputElement).value}"`),
      };
    });
    console.log(`\n  single view for ${VEHICLES[0]}:`);
    console.log(`    values: ${detail.values.join(' | ')}`);
    console.log(`    text  : ${detail.text.slice(0, 340)}`);

    if (process.env.DEMAP !== 'true') {
      console.log('\n  DEMAP not set — stopping before any de-mapping.');
      return;
    }

    // ── 2. bulk de-map, cross-division ───────────────────────────────────
    await page.goto('/Vehicle/DeMapVehicle', { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page.waitForTimeout(2_500);
    await page.locator('button:has-text("Bulk De-Map"), a:has-text("Bulk De-Map")').first().click({ timeout: 10_000 });
    await page.waitForTimeout(2_500);

    await page.locator('#bdCustomerId').fill(CUSTOMER);
    await page.locator('#bdCustomerId').blur();
    await page.waitForTimeout(3_500);
    const resolvedName = await page.locator('#bdCustomerName').inputValue().catch(() => '');
    console.log(`\n  #bdCustomerId ${CUSTOMER} -> #bdCustomerName "${resolvedName}"`);

    const branch = process.env.DEMAP_BRANCH ?? CUSTOMER;
    const sheet = path.join(process.env.TMPDIR ?? '/tmp', `bulk-demap-${Date.now()}.xlsx`);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
      ['Vehicle number', 'Branch location', 'Reason for De-Mapping'],
      ...live.slice(0, 2).map(v => [v.VehicleNo, branch, 'QA automation — bulk de-map scope test']),
    ]), 'Template');
    XLSX.writeFile(wb, sheet);
    console.log(`  sheet: ${live.slice(0, 2).map(v => v.VehicleNo).join(', ')} against branch "${branch}"`);

    await page.locator('#bdExcelFile').setInputFiles(sheet, { timeout: 15_000 }).catch(async e => {
      console.log(`  setInputFiles failed (${e}); trying the picker`);
      const chooser = page.waitForEvent('filechooser', { timeout: 15_000 }).catch(() => null);
      await page.locator('#btnBdPickExcel').click({ timeout: 10_000 }).catch(() => undefined);
      const fc = await chooser;
      if (fc) await fc.setFiles(sheet);
    });
    await page.waitForTimeout(4_000);

    const staged = await page.evaluate(() => ({
      rows: Array.from(document.querySelectorAll('tbody tr')).map(r => (r.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 120)),
      buttons: Array.from(document.querySelectorAll('button, a.btn'))
        .filter(b => { const x = (b as HTMLElement).getBoundingClientRect(); return x.width > 0 && x.height > 0; })
        .map(b => `#${(b as HTMLElement).id || '-'}:"${(b.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 30)}"`),
    }));
    console.log(`  staged rows: ${staged.rows.join(' | ') || '(none)'}`);
    console.log(`  buttons now: ${staged.buttons.join(' | ')}`);

    const submit = page.locator('button:visible, a.btn:visible')
      .filter({ hasText: /^\s*(submit|process|de-?map|confirm)\s*$/i })
      .filter({ hasNotText: /reset|cancel|template|upload/i }).first();
    if (await submit.isVisible().catch(() => false)) {
      console.log(`  committing with "${(await submit.textContent() ?? '').trim()}"`);
      await submit.click({ timeout: 10_000 }).catch(() => undefined);
      await page.waitForTimeout(4_000);
    } else {
      console.log('  no commit control found after upload');
    }

    for (let i = 0; i < 4; i += 1) {
      const modal = page.locator('.modal.show').first();
      if (!(await modal.isVisible().catch(() => false))) break;
      console.log(`  MODAL: "${((await modal.textContent()) ?? '').replace(/\s+/g, ' ').trim().slice(0, 280)}"`);
      const ok = modal.locator('button:visible, a:visible')
        .filter({ hasText: /^\s*(ok|yes|confirm|proceed|submit)\s*$/i })
        .filter({ hasNotText: /no|cancel/i }).first();
      if (!(await ok.isVisible().catch(() => false))) break;
      await ok.click({ timeout: 8_000 }).catch(() => undefined);
      await page.waitForTimeout(3_500);
    }

    const after = await DbHelper.query<{ VehicleNo: string; VehicleStatus: number }>(
      `SELECT VehicleNo, VehicleStatus FROM dbo.VehicleDetails
        WHERE VehicleNo IN (${VEHICLES.map(v => `'${v}'`).join(',')})`);
    console.log(`\n  after: ${JSON.stringify(after)}`);
    const demapped = after.filter(a => a.VehicleStatus === 404).map(a => a.VehicleNo);
    console.log(
      `  VERDICT: ${demapped.length
        ? `de-mapped across divisions — ${demapped.join(', ')} now 404 DeMapped`
        : 'nothing was de-mapped'}`
    );
  });
});
