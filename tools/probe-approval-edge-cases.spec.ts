import { test, expect } from '@playwright/test';
import { Browser, Page } from '@playwright/test';
import { LoginPage } from '../src/pages/login.page';
import { DashboardPage } from '../src/pages/dashboard.page';
import { DbHelper } from '../src/helpers/db.helper';

/**
 * Edge cases for vehicle approval, now that any State Admin can approve.
 *
 * The change widens who can act on a queue entry from "admins of one division"
 * to "every state admin in the country". That does not just relax a permission —
 * it makes contention possible for the first time. Two people could not
 * previously race for the same vehicle unless they were in the same division;
 * now anyone can be looking at the same row.
 *
 * So the cases here are about what happens when more than one actor reaches the
 * same vehicle, plus the cheap invariants worth pinning while fixtures exist.
 *
 *   TOOLS=true ENV=qa npx playwright test --project=tools --grep "approval edge"
 *
 * CONSUMES QUEUE FIXTURES — run seed-approval-queue first.
 */

const PASSWORD = process.env.OFFICER_PASSWORD ?? 'Nayara@1';
const KOLKATA_STATE = { label: 'Kolkata State Admin (WB_NE/East)', mobile: '9073275904' };
const AHMEDABAD_STATE = { label: 'Ahmedabad State Admin (GJ_I/West)', mobile: '9073068501' };

interface VehicleRow { Id: number; VehicleStatus: number; ModifiedBy: number | null }

async function rawRows(registration: string): Promise<VehicleRow[]> {
  return DbHelper.query<VehicleRow>(
    `SELECT Id, VehicleStatus, ModifiedBy FROM dbo.RawVehiclesDetail WHERE VehicleNo = @v ORDER BY Id`,
    { v: registration }
  );
}
async function liveRows(registration: string): Promise<{ Id: number; VehicleStatus: number; ApprovedBy: number | null }[]> {
  return DbHelper.query(
    `SELECT Id, VehicleStatus, ApprovedBy FROM dbo.VehicleDetails WHERE VehicleNo = @v ORDER BY Id`,
    { v: registration }
  );
}

async function signIn(browser: Browser, mobile: string): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  const loginPage = new LoginPage(page);
  const dashboardPage = new DashboardPage(page);
  await loginPage.navigate();
  await loginPage.login(mobile, PASSWORD);
  await dashboardPage.assertDashboardLoaded();
  return page;
}

/** Clicks Approve inside the row for `registration` and returns what was said. */
async function approveFromRow(page: Page, registration: string): Promise<string> {
  const row = page.locator('tbody tr').filter({ hasText: registration }).first();
  if (!(await row.isVisible().catch(() => false))) return '(row not listed)';

  // Row-scoped: every row has its own .btn-approve-vahan, so a page-level
  // .first() approves whatever happens to be at the top instead.
  const approve = row.locator('button.btn-approve-vahan, button:has-text("Approve")').first();
  if (!(await approve.isVisible().catch(() => false))) return '(no Approve control)';
  await approve.click({ timeout: 10_000 }).catch(() => undefined);
  await page.waitForTimeout(2_000);

  let said = '';
  for (let i = 0; i < 4; i += 1) {
    const modal = page.locator('.modal.show').first();
    if (!(await modal.isVisible().catch(() => false))) break;
    const text = ((await modal.textContent()) ?? '').replace(/\s+/g, ' ').trim();
    if (!/^Approve vehicle/i.test(text)) said = text;
    const yes = modal
      .locator('button:visible, a:visible')
      .filter({ hasText: /^\s*(yes|ok|confirm|proceed)\s*$/i })
      .filter({ hasNotText: /no|cancel/i })
      .first();
    if (!(await yes.isVisible().catch(() => false))) break;
    await yes.click({ timeout: 8_000 }).catch(() => undefined);
    await page.waitForTimeout(3_000);
  }
  return said || '(no message)';
}

test.use({ storageState: { cookies: [], origins: [] } });

test.describe('Tools — probes @tools', () => {
  /**
   * VA-24 / VA-25 — two admins, one vehicle.
   *
   * Both open the queue while the vehicle is pending, so both hold a valid-
   * looking row. One approves. The other then clicks Approve on a row that is
   * now stale — exactly what a second person with the list already open would
   * do, and newly possible across divisions.
   *
   * The failure to look for is a SECOND VehicleDetails row: the same vehicle
   * live twice, which no amount of UI tidiness would reveal.
   */
  test('approval edge — stale tab double approval', async ({ browser }) => {
    test.setTimeout(10 * 60_000);
    const REG = process.env.EDGE_VEHICLE ?? 'DL1YA7706';

    const before = { raw: await rawRows(REG), live: await liveRows(REG) };
    console.log(`\n${REG} before: raw=${JSON.stringify(before.raw)} live=${JSON.stringify(before.live)}`);
    test.skip(before.raw.length === 0, `${REG} is not in the queue`);
    test.skip(before.raw[0].VehicleStatus !== 411, `${REG} is not pending (status ${before.raw[0].VehicleStatus})`);

    const first = await signIn(browser, KOLKATA_STATE.mobile);
    const second = await signIn(browser, AHMEDABAD_STATE.mobile);

    for (const p of [first, second]) {
      await p.goto('/Vehicle/VehicleApproval', { waitUntil: 'domcontentloaded', timeout: 45_000 });
      await p.waitForTimeout(4_000);
    }
    console.log('Both admins have the queue open, both see the row.');

    const saidFirst = await approveFromRow(first, REG);
    console.log(`  ${KOLKATA_STATE.label} approved  -> "${saidFirst}"`);

    const midway = { raw: await rawRows(REG), live: await liveRows(REG) };
    console.log(`  after first: raw=${JSON.stringify(midway.raw)} live=${JSON.stringify(midway.live)}`);

    // The second admin's page still shows the old row.
    const saidSecond = await approveFromRow(second, REG);
    console.log(`  ${AHMEDABAD_STATE.label} approved the STALE row -> "${saidSecond}"`);

    const after = { raw: await rawRows(REG), live: await liveRows(REG) };
    console.log(`  after second: raw=${JSON.stringify(after.raw)} live=${JSON.stringify(after.live)}`);

    console.log(
      `\n  VERDICT: ${after.live.length > 1
        ? `*** ${after.live.length} VehicleDetails rows for one vehicle — the second approval duplicated it ***`
        : `one live row — the second approval did not duplicate (said: "${saidSecond}")`}`
    );

    expect(
      after.live.length,
      `Approving an already-approved vehicle from a stale list created ` +
        `${after.live.length} VehicleDetails rows for ${REG}. A vehicle live twice ` +
        `is invisible in the UI and corrupts anything that joins on registration.`
    ).toBeLessThanOrEqual(1);

    await first.context().close();
    await second.context().close();
  });

  /**
   * VA-33 — do the queue's own filters respect any scope?
   *
   * The list is unfiltered, but the search box is a separate code path and a
   * common place for a leftover scope clause.
   */
  test('approval edge — search across divisions', async ({ page }) => {
    test.setTimeout(6 * 60_000);

    const loginPage = new LoginPage(page);
    const dashboardPage = new DashboardPage(page);
    await loginPage.navigate();
    await loginPage.login(KOLKATA_STATE.mobile, PASSWORD);
    await dashboardPage.assertDashboardLoaded();

    await page.goto('/Vehicle/VehicleApproval', { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page.waitForTimeout(4_000);

    // What actually triggers the search? Enter may not be wired to anything.
    const controls = await page.evaluate(() => {
      const onScreen = (el: Element) => { const r = (el as HTMLElement).getBoundingClientRect(); return r.width > 0 && r.height > 0; };
      return Array.from(document.querySelectorAll('button, a.btn, select, input'))
        .filter(onScreen)
        .map(e => `<${e.tagName.toLowerCase()}>#${(e as HTMLElement).id || '-'}[${(e as HTMLInputElement).type || ''}]:"${(e.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 30)}"`);
    });
    console.log(`  controls on the approval screen:\n    ${controls.join('\n    ')}`);

    // A Gurgaon (HR_HP_PB) customer, searched by a West Bengal admin.
    for (const [label, selector, value] of [
      ['customer id', '#txtCustomerId', process.env.EDGE_SEARCH_UID ?? 'NAYAFP2023400255'],
      ['vehicle no', '#txtVehicleNo', process.env.EDGE_SEARCH_VEHICLE ?? 'DL5CB9606'],
    ] as const) {
      await page.locator(selector).fill(value).catch(() => undefined);
      // #btnVehicleApprovalSearch is the trigger. Pressing Enter does nothing,
      // which made an unfiltered list look like a search that ignored its scope.
      await page.locator('#btnVehicleApprovalSearch').click({ timeout: 8_000 }).catch(() => undefined);
      await page.waitForTimeout(3_500);

      const found = await page.evaluate(() =>
        Array.from(document.querySelectorAll('tbody tr'))
          .filter(r => { const b = (r as HTMLElement).getBoundingClientRect(); return b.width > 0; })
          .map(r => (r.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 90))
      );
      console.log(`\n  search by ${label} = ${value} (Gurgaon customer, searched from WB_NE):`);
      for (const f of found.slice(0, 4)) console.log(`    ${f}`);
      console.log(`    -> ${found.length} row(s)`);
      await page.locator(selector).fill('').catch(() => undefined);
      await page.locator('#btnVehicleApprovalReset').click({ timeout: 8_000 }).catch(() => undefined);
      await page.waitForTimeout(2_000);
    }
  });

  /**
   * VA-26 — bulk approve across divisions.
   *
   * "Approve Selected" (#btnVehicleApprovalBulkApprove) applies to every ticked
   * row at once. Bulk paths are where a per-row entitlement check is most often
   * missing, and this one now spans the whole country rather than one division.
   *
   * It ticks ONLY this suite's own seeded vehicles — never #vapSelectAll, which
   * would approve other people's queue entries as a side effect of testing.
   */
  test('approval edge — bulk approve across divisions', async ({ page }) => {
    test.setTimeout(10 * 60_000);

    const MINE = (process.env.EDGE_BULK ?? 'DL3CW9474,DL3CW9470,DL3CAX0909').split(',').map(s => s.trim());

    const before = await DbHelper.query<{ VehicleNo: string; VehicleStatus: number }>(
      `SELECT VehicleNo, VehicleStatus FROM dbo.RawVehiclesDetail
        WHERE VehicleNo IN (${MINE.map(m => `'${m}'`).join(',')})`);
    console.log(`\nbefore: ${JSON.stringify(before)}`);
    const pending = before.filter(b => b.VehicleStatus === 411).map(b => b.VehicleNo);
    test.skip(pending.length < 2, `need at least 2 pending fixtures, have ${pending.length}`);

    const loginPage = new LoginPage(page);
    const dashboardPage = new DashboardPage(page);
    await loginPage.navigate();
    await loginPage.login(KOLKATA_STATE.mobile, PASSWORD);
    await dashboardPage.assertDashboardLoaded();

    await page.goto('/Vehicle/VehicleApproval', { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page.waitForTimeout(4_000);

    // Tick each of ours, by row. Never select-all.
    for (const reg of pending) {
      const row = page.locator('tbody tr').filter({ hasText: reg }).first();
      if (!(await row.isVisible().catch(() => false))) { console.log(`  ${reg} not listed`); continue; }
      await row.locator('input[type=checkbox]').first().click({ timeout: 8_000 }).catch(() => undefined);
      console.log(`  ticked ${reg}`);
    }
    await page.waitForTimeout(1_000);

    await page.locator('#btnVehicleApprovalBulkApprove').click({ timeout: 10_000 }).catch(e => console.log(`  bulk click failed: ${e}`));
    await page.waitForTimeout(2_500);

    for (let i = 0; i < 4; i += 1) {
      const modal = page.locator('.modal.show').first();
      if (!(await modal.isVisible().catch(() => false))) break;
      console.log(`  MODAL: "${((await modal.textContent()) ?? '').replace(/\s+/g, ' ').trim().slice(0, 260)}"`);
      const yes = modal.locator('button:visible, a:visible')
        .filter({ hasText: /^\s*(yes|ok|confirm|proceed|approve)\s*$/i })
        .filter({ hasNotText: /no|cancel/i }).first();
      if (!(await yes.isVisible().catch(() => false))) break;
      await yes.click({ timeout: 8_000 }).catch(() => undefined);
      await page.waitForTimeout(3_500);
    }

    const after = await DbHelper.query<{ VehicleNo: string; VehicleStatus: number; ModifiedBy: number | null }>(
      `SELECT VehicleNo, VehicleStatus, ModifiedBy FROM dbo.RawVehiclesDetail
        WHERE VehicleNo IN (${MINE.map(m => `'${m}'`).join(',')})`);
    console.log(`after : ${JSON.stringify(after)}`);

    const live = await DbHelper.query<{ VehicleNo: string; n: number }>(
      `SELECT VehicleNo, COUNT(*) AS n FROM dbo.VehicleDetails
        WHERE VehicleNo IN (${MINE.map(m => `'${m}'`).join(',')}) GROUP BY VehicleNo`);
    console.log(`live rows: ${JSON.stringify(live)}`);

    const stillPending = after.filter(a => a.VehicleStatus === 411).map(a => a.VehicleNo);
    console.log(
      `\n  VERDICT: ${stillPending.length === 0
        ? 'all selected vehicles approved in one action, across two divisions'
        : `still pending after bulk approve: ${stillPending.join(', ')}`}`
    );
    const duplicated = live.filter(l => l.n > 1);
    if (duplicated.length) console.log(`  *** duplicates: ${JSON.stringify(duplicated)} ***`);
  });
});
