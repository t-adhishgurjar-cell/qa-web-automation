import { test } from '@playwright/test';
import { LoginPage } from '../src/pages/login.page';
import { DashboardPage } from '../src/pages/dashboard.page';
import { AddVehiclePage } from '../src/pages/vehicle/add-vehicle.page';
import { DbHelper } from '../src/helpers/db.helper';
import * as XLSX from 'xlsx';
import * as fs from 'fs';
import * as path from 'path';

/**
 * VA-29 — a vehicle for a customer that is not Active.
 *
 * All 139 vehicles currently queued belong to Active customers, so this state
 * does not arise on its own and has to be provoked. Status 104 is Inactive.
 *
 * The question is asked of BOTH routes on purpose. Manual entry calls
 * /Customer/GetCustomerStatus as the UID is typed and has somewhere obvious to
 * refuse; bulk upload validates server-side at commit, which is a different code
 * path that has already proved to differ — bulk lands vehicles at 409 where
 * manual lands them at 411. Two routes into the same queue that disagree about
 * who may be added is worth knowing either way.
 *
 *   TOOLS=true ENV=qa npx playwright test --project=tools --grep "va29"
 */

const INACTIVE = process.env.VA29_CUSTOMER ?? 'NAYAFP2023400133';
const OFFICER = { label: 'Ahmedabad I Division Admin', mobile: '9073139002' };
const PASSWORD = process.env.OFFICER_PASSWORD ?? 'Nayara@1';
const POOL = path.join(__dirname, '../test-data/deregistered-vehicles.json');

async function freeRegistration(skip: Set<string>): Promise<string> {
  const pool: { no: string }[] = JSON.parse(fs.readFileSync(POOL, 'utf8'));
  for (const e of pool) {
    if (skip.has(e.no)) continue;
    const taken = await DbHelper.query<{ n: number }>(
      `SELECT (SELECT COUNT(*) FROM dbo.VehicleDetails WHERE VehicleNo=@v)
            + (SELECT COUNT(*) FROM dbo.RawVehiclesDetail WHERE VehicleNo=@v) AS n`, { v: e.no });
    skip.add(e.no);
    if (Number(taken[0]?.n ?? 0) === 0) return e.no;
  }
  throw new Error('pool exhausted');
}

test.use({ storageState: { cookies: [], origins: [] } });

test.describe('Tools — probes @tools', () => {
  test('va29 — manual entry against an Inactive customer', async ({ page }) => {
    test.setTimeout(8 * 60_000);

    const cust = await DbHelper.query<{ CustomerId: string; Status: number }>(
      `SELECT CustomerId, Status FROM dbo.CustomerMaster WHERE CustomerId=@c`, { c: INACTIVE });
    console.log(`target customer: ${JSON.stringify(cust)}  (101 = Active, 104 = Inactive)`);
    test.skip(cust[0]?.Status === 101, `${INACTIVE} is Active; pick an inactive one`);

    page.on('response', async r => {
      if (/GetCustomerStatus|GetFormName/i.test(r.url())) {
        console.log(`  ${r.url().replace(/^https?:\/\/[^/]+/, '')} -> ${(await r.text().catch(() => '')).slice(0, 200)}`);
      }
    });

    const loginPage = new LoginPage(page);
    const dashboardPage = new DashboardPage(page);
    const addPage = new AddVehiclePage(page);
    await loginPage.navigate();
    await loginPage.login(OFFICER.mobile, PASSWORD);
    await dashboardPage.assertDashboardLoaded();
    await addPage.open();

    const resolved = await addPage.chooseCustomer(INACTIVE);
    console.log(`  #CustomerName resolved to: "${resolved}"`);

    const state = await page.evaluate(() => {
      const onScreen = (el: Element) => { const r = (el as HTMLElement).getBoundingClientRect(); return r.width > 0 && r.height > 0; };
      return {
        addEnabled: !(document.querySelector('#btnAdd') as HTMLButtonElement | null)?.disabled,
        modal: Array.from(document.querySelectorAll('.modal.show')).map(m => (m.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 200)),
        errors: Array.from(document.querySelectorAll('.error, .text-danger')).filter(onScreen)
          .map(e => (e.textContent || '').replace(/\s+/g, ' ').trim()).filter(t => t && t !== '*'),
      };
    });
    console.log(`  Add enabled: ${state.addEnabled}  modal: ${state.modal.join(' | ') || '(none)'}  errors: ${state.errors.join(' | ') || '(none)'}`);
    console.log(
      `\n  VA-29 (manual) VERDICT: ${resolved
        ? '*** the form accepted an Inactive customer and resolved its name ***'
        : 'refused — the customer was not resolved'}`
    );
  });

  test('va29 — bulk upload against an Inactive customer', async ({ page }) => {
    test.setTimeout(8 * 60_000);

    const cust = await DbHelper.query<{ Status: number }>(
      `SELECT Status FROM dbo.CustomerMaster WHERE CustomerId=@c`, { c: INACTIVE });
    test.skip(cust[0]?.Status === 101, `${INACTIVE} is Active`);

    const reg = await freeRegistration(new Set());
    const sheet = path.join(process.env.TMPDIR ?? '/tmp', `va29-${Date.now()}.xlsx`);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
      ['Vehicle No', 'Branch ID', 'Vehicle Type'],
      [reg, INACTIVE, 'Owned'],
    ]), 'Template');
    XLSX.writeFile(wb, sheet);
    console.log(`uploading ${reg} against ${INACTIVE} (Inactive)`);

    page.on('response', async r => {
      if (/BulkUploadProcess/i.test(r.url())) {
        console.log(`  VehicleBulkUploadProcess -> ${(await r.text().catch(() => '')).slice(0, 300)}`);
      }
    });

    const loginPage = new LoginPage(page);
    const dashboardPage = new DashboardPage(page);
    await loginPage.navigate();
    await loginPage.login(OFFICER.mobile, PASSWORD);
    await dashboardPage.assertDashboardLoaded();

    await page.goto('/Vehicle/AddVehicles', { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page.waitForTimeout(3_000);
    await page.locator('#avTabBulk').click({ timeout: 10_000 });
    await page.waitForTimeout(2_500);

    await page.locator('input[type=file]').first().setInputFiles(sheet, { timeout: 15_000 }).catch(() => undefined);
    await page.waitForTimeout(2_500);
    await page.locator('#btnUploadExcel').click({ timeout: 10_000 }).catch(() => undefined);
    await page.waitForTimeout(5_000);

    const staged = await page.evaluate(() =>
      Array.from(document.querySelectorAll('tbody tr')).map(r => (r.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 120)));
    console.log(`  staged: ${staged.join(' | ') || '(none)'}`);

    await page.locator('#btnSubmitPreview:visible').first().click({ timeout: 10_000 }).catch(() => undefined);
    await page.waitForTimeout(3_000);
    for (let i = 0; i < 4; i += 1) {
      const modal = page.locator('.modal.show').first();
      if (!(await modal.isVisible().catch(() => false))) break;
      console.log(`  MODAL: "${((await modal.textContent()) ?? '').replace(/\s+/g, ' ').trim().slice(0, 260)}"`);
      const ok = modal.locator('button:visible, a:visible').filter({ hasText: /^\s*(ok|yes|confirm|proceed)\s*$/i }).first();
      if (!(await ok.isVisible().catch(() => false))) break;
      await ok.click({ timeout: 8_000 }).catch(() => undefined);
      await page.waitForTimeout(3_000);
    }

    const landed = await DbHelper.query(
      `SELECT VehicleNo, CustomerID, VehicleStatus FROM dbo.RawVehiclesDetail WHERE VehicleNo=@v`, { v: reg });
    console.log(`  database: ${JSON.stringify(landed)}`);
    console.log(
      `\n  VA-29 (bulk) VERDICT: ${(landed as unknown[]).length
        ? '*** ACCEPTED — a vehicle was mapped to an Inactive customer ***'
        : 'rejected'}`
    );
  });
});
