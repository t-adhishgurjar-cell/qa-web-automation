import { test } from '@playwright/test';
import { LoginPage } from '../src/pages/login.page';
import { DashboardPage } from '../src/pages/dashboard.page';
import { DbHelper } from '../src/helpers/db.helper';

/**
 * VA-28 — nothing Vahan-verified should be sitting in the approval queue.
 *
 * The queue exists for vehicles whose Vahan check FAILED. A vehicle that
 * verified cleanly needs no human approval and should have gone straight
 * through; one sitting here would mean either a status written wrongly or a
 * query that selects too much, and an approver would be asked to rubber-stamp
 * something the system already accepted.
 *
 * StatusMaster, entity type 4:
 *   408 Vahan Verified   410 Vahan Failed   411 Pending for Approval
 *   401 Active           402 Admin Approved 412 Duplicate
 *
 * Also covers VA-32 in passing. The grid defaults to 10 rows while 138 sit at
 * 411, so every "the queue shows 10 rows" reading so far has been page one.
 * This sets the page length to its maximum and walks every page, because a
 * scope or status filter applied per page rather than per query would only show
 * up beyond the first.
 *
 *   TOOLS=true ENV=qa npx playwright test --project=tools --grep "va28"
 *
 * Read-only.
 */

const APPROVER = { mobile: '9073275904', label: 'Kolkata State Admin (WB_NE / East)' };
const PASSWORD = process.env.OFFICER_PASSWORD ?? 'Nayara@1';

test.use({ storageState: { cookies: [], origins: [] } });

test.describe('Tools — probes @tools', () => {
  test('va28 — queue contents across every page', async ({ page }) => {
    test.setTimeout(10 * 60_000);

    const counts = await DbHelper.query<{ VehicleStatus: number; n: number }>(
      `SELECT VehicleStatus, COUNT(*) AS n FROM dbo.RawVehiclesDetail
        WHERE StatusFlag = 1 GROUP BY VehicleStatus ORDER BY n DESC`);
    console.log(`RawVehiclesDetail by status: ${JSON.stringify(counts)}`);

    const loginPage = new LoginPage(page);
    const dashboardPage = new DashboardPage(page);
    await loginPage.navigate();
    await loginPage.login(APPROVER.mobile, PASSWORD);
    await dashboardPage.assertDashboardLoaded();

    await page.goto('/Vehicle/VehicleApproval', { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page.waitForTimeout(4_000);

    // Largest page size the grid offers, so fewer pages to walk.
    const sizes = await page.locator('#dt-length-0 option').allTextContents().catch(() => []);
    console.log(`page sizes offered: ${sizes.join(', ')}`);
    await page.locator('#dt-length-0').selectOption(sizes[sizes.length - 1]?.trim() ?? '100').catch(() => undefined);
    await page.waitForTimeout(4_000);

    const all: { customer: string; vehicle: string; status: string }[] = [];
    for (let pageNo = 1; pageNo <= 40; pageNo += 1) {
      const rows = await page.evaluate(() =>
        Array.from(document.querySelectorAll('tbody tr'))
          .filter(r => { const b = (r as HTMLElement).getBoundingClientRect(); return b.width > 0 && b.height > 0; })
          .map(r => Array.from(r.querySelectorAll('td')).map(td => (td.textContent || '').replace(/\s+/g, ' ').trim()))
          .filter(c => c.length > 4)
      );
      // Find the status cell by content rather than by a guessed index — the
      // first attempt read column 6 and got "-" for all 146 rows.
      for (const c of rows) {
        const status = c.find(x => /pending for approval|vahan|active|approved|failed|duplicate|blocked/i.test(x)) ?? '';
        all.push({ customer: c[2] ?? '', vehicle: c[3] ?? '', status });
      }
      console.log(`  page ${pageNo}: ${rows.length} row(s), running total ${all.length}`);

      const next = page.locator('a.page-link, button.page-link').filter({ hasText: /^\s*(next|›|»)\s*$/i }).first();
      const disabled = await next.evaluate(el =>
        el.classList.contains('disabled') || el.closest('li')?.classList.contains('disabled') || false
      ).catch(() => true);
      if (disabled || !(await next.isVisible().catch(() => false))) break;
      await next.click({ timeout: 8_000 }).catch(() => undefined);
      await page.waitForTimeout(2_500);
    }

    const byStatus = all.reduce<Record<string, number>>((acc, r) => {
      acc[r.status || '(blank)'] = (acc[r.status || '(blank)'] ?? 0) + 1;
      return acc;
    }, {});
    console.log(`\nTOTAL rows read from the queue: ${all.length}`);
    console.log(`status text seen: ${JSON.stringify(byStatus)}`);

    const verified = all.filter(r => /vahan verified|^active$|admin approved/i.test(r.status));
    console.log(
      `\n  VA-28 VERDICT: ${verified.length === 0
        ? 'no Vahan-verified or already-approved vehicle is listed in the queue'
        : `*** ${verified.length} row(s) should not be here: ${verified.slice(0, 5).map(v => `${v.vehicle} (${v.status})`).join(', ')} ***`}`
    );

    // Cross-check against the database rather than trusting the label.
    // Match on customer AND vehicle. A registration alone is not a key here:
    // the same VehicleNo carries several RawVehiclesDetail rows from earlier
    // lifecycles, so matching by number alone pulled in an old 408 row for a
    // vehicle that is pending at 411 today and made it look as though verified
    // vehicles were sitting in the queue.
    const pairs = all.filter(r => r.vehicle && r.customer);
    if (pairs.length) {
      const predicate = pairs
        .slice(0, 200)
        .map(p => `(VehicleNo = '${p.vehicle.replace(/'/g, "''")}' AND CustomerID = '${p.customer.replace(/'/g, "''")}')`)
        .join(' OR ');
      const dbStatus = await DbHelper.query<{ VehicleNo: string; CustomerID: string; VehicleStatus: number }>(
        `SELECT VehicleNo, CustomerID, VehicleStatus FROM dbo.RawVehiclesDetail WHERE ${predicate}`);
      const notPending = dbStatus.filter(d => d.VehicleStatus !== 411);
      console.log(`\n  database check on (customer, vehicle): ${dbStatus.length} matched for ${pairs.length} listed`);
      console.log(`  rows not at 411 (Pending for Approval): ${notPending.length}`);
      if (notPending.length) {
        console.log(`  *** ${JSON.stringify(notPending.slice(0, 10))} ***`);
      } else {
        console.log('  every listed row is genuinely at 411 — the queue selects only pending vehicles');
      }
    }
  });
});
