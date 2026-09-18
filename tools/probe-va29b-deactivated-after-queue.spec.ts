import { test, expect } from '@playwright/test';
import { LoginPage } from '../src/pages/login.page';
import { DashboardPage } from '../src/pages/dashboard.page';
import { AddVehiclePage } from '../src/pages/vehicle/add-vehicle.page';
import { CustomerStatusPage } from '../src/pages/customer-management/customer-status.page';
import { DbHelper } from '../src/helpers/db.helper';
import { FP_ADMIN } from '../src/config/accounts';
import * as fs from 'fs';
import * as path from 'path';

/**
 * VA-29b — a customer deactivated AFTER its vehicle is already in the queue.
 *
 * Adding against an inactive customer is already known to be refused by both
 * routes. This is the harder half: the vehicle is queued while the customer is
 * Active, and the customer is deactivated afterwards. Nothing re-validates on
 * the way in, so the question is whether the queue and the approve action
 * re-check the customer at the moment of approval, or only trusted it at submit.
 *
 * It matters more since the change. Any state or division admin in the country
 * can now act on any row, and none of them has context on a customer in a
 * geography they have never dealt with — so "is this customer still active?" is
 * exactly the judgement the system should not be leaving to them.
 *
 * The subject is this suite's own customer, created by the onboarding E2E chain,
 * so nobody else's data is switched off. The customer is reactivated in a
 * finally block whatever happens — leaving a customer deactivated would stop it
 * transacting, which is precisely the kind of damage a test must not do.
 *
 *   TOOLS=true ENV=qa npx playwright test --project=tools --grep "va29b"
 */

const BRANCH = process.env.VA29B_CUSTOMER ?? 'NAYAFP2023400255';
const OFFICER = { label: 'Ahmedabad I Division Admin', mobile: '9073139002' };
const APPROVER = { label: 'Kolkata State Admin (WB_NE / East)', mobile: '9073275904' };
const PASSWORD = process.env.OFFICER_PASSWORD ?? 'Nayara@1';
const POOL = path.join(__dirname, '../test-data/deregistered-vehicles.json');

async function freeRegistration(): Promise<string> {
  const pool: { no: string }[] = JSON.parse(fs.readFileSync(POOL, 'utf8'));
  for (const e of pool) {
    const taken = await DbHelper.query<{ n: number }>(
      `SELECT (SELECT COUNT(*) FROM dbo.VehicleDetails WHERE VehicleNo=@v)
            + (SELECT COUNT(*) FROM dbo.RawVehiclesDetail WHERE VehicleNo=@v) AS n`, { v: e.no });
    if (Number(taken[0]?.n ?? 0) === 0) return e.no;
  }
  throw new Error('pool exhausted');
}

async function customerStatus(id: string): Promise<number | null> {
  const rows = await DbHelper.query<{ Status: number }>(
    `SELECT Status FROM dbo.CustomerMaster WHERE CustomerId = @c`, { c: id });
  return rows[0]?.Status ?? null;
}

test.use({ storageState: { cookies: [], origins: [] } });

test.describe('Tools — probes @tools', () => {
  test('va29b — deactivate the customer after the vehicle is queued', async ({ browser }) => {
    test.setTimeout(15 * 60_000);
    test.skip(!FP_ADMIN.password, 'Set FP_ADMIN_PASS');

    const startStatus = await customerStatus(BRANCH);
    console.log(`${BRANCH} starts at status ${startStatus} (101 Active, 104 Inactive)`);
    expect(startStatus, `${BRANCH} must start Active for this test to mean anything`).toBe(101);

    const registration = await freeRegistration();
    let deactivated = false;

    try {
      // ── 1. queue a vehicle while the customer is still Active ────────────
      {
        const ctx = await browser.newContext();
        const page = await ctx.newPage();
        const login = new LoginPage(page);
        const dash = new DashboardPage(page);
        const add = new AddVehiclePage(page);
        await login.navigate();
        await login.login(OFFICER.mobile, PASSWORD);
        await dash.assertDashboardLoaded();
        await add.open();
        const name = await add.chooseCustomer(BRANCH);
        expect(name, 'the customer should resolve while still Active').not.toBe('');
        const result = await add.addOne(registration);
        console.log(`  queued ${registration}: vahan=${result.vahanStatus} submitted=${result.submitted} "${result.message}"`);
        expect(result.submitted, 'the vehicle should queue while the customer is Active').toBe(true);
        await ctx.close();
      }

      const queued = await DbHelper.query<{ VehicleStatus: number }>(
        `SELECT VehicleStatus FROM dbo.RawVehiclesDetail WHERE VehicleNo=@v`, { v: registration });
      console.log(`  database: ${JSON.stringify(queued)}`);

      // ── 2. deactivate the customer, through the product ──────────────────
      {
        const ctx = await browser.newContext();
        const page = await ctx.newPage();
        const login = new LoginPage(page);
        const dash = new DashboardPage(page);
        const status = new CustomerStatusPage(page);
        await login.navigate();
        await login.login(FP_ADMIN.username, FP_ADMIN.password);
        await dash.assertDashboardLoaded();
        await status.open();
        await status.search(BRANCH);
        console.log(`  Manage Customer Status says: currently ${await status.currentStatus()}, offers ${await status.availableAction()}`);
        const outcome = await status.act('confirm');
        console.log(`  deactivate -> action "${outcome.action}", message "${outcome.message}"`);
        await ctx.close();
      }

      const afterDeactivate = await customerStatus(BRANCH);
      console.log(`  ${BRANCH} is now status ${afterDeactivate}`);
      deactivated = afterDeactivate !== 101;
      expect(deactivated, 'the customer was not actually deactivated; the rest proves nothing').toBe(true);

      // ── 3. is the vehicle still listed, and can it still be approved? ────
      {
        const ctx = await browser.newContext();
        const page = await ctx.newPage();
        const login = new LoginPage(page);
        const dash = new DashboardPage(page);
        await login.navigate();
        await login.login(APPROVER.mobile, PASSWORD);
        await dash.assertDashboardLoaded();

        await page.goto('/Vehicle/VehicleApproval', { waitUntil: 'domcontentloaded', timeout: 45_000 });
        await page.waitForTimeout(4_000);
        await page.locator('#txtVehicleNo').fill(registration).catch(() => undefined);
        await page.locator('#btnVehicleApprovalSearch').click({ timeout: 8_000 }).catch(() => undefined);
        await page.waitForTimeout(3_500);

        const row = page.locator('tbody tr').filter({ hasText: registration }).first();
        const listed = await row.isVisible().catch(() => false);
        console.log(`\n  still listed for an inactive customer? ${listed}`);
        if (listed) console.log(`    row: ${((await row.textContent()) ?? '').replace(/\s+/g, ' ').trim().slice(0, 140)}`);

        if (listed) {
          const approve = row.locator('button.btn-approve-vahan, button:has-text("Approve")').first();
          if (await approve.isVisible().catch(() => false)) {
            await approve.click({ timeout: 10_000 });
            await page.waitForTimeout(2_000);
            let said = '';
            for (let i = 0; i < 4; i += 1) {
              const modal = page.locator('.modal.show').first();
              if (!(await modal.isVisible().catch(() => false))) break;
              const text = ((await modal.textContent()) ?? '').replace(/\s+/g, ' ').trim();
              if (!/^Approve vehicle/i.test(text)) said = text;
              const yes = modal.locator('button:visible, a:visible')
                .filter({ hasText: /^\s*(yes|ok|confirm|proceed)\s*$/i })
                .filter({ hasNotText: /no|cancel/i }).first();
              if (!(await yes.isVisible().catch(() => false))) break;
              await yes.click({ timeout: 8_000 }).catch(() => undefined);
              await page.waitForTimeout(3_000);
            }
            console.log(`    approval attempt said: "${said || '(no message)'}"`);
          }
        }
        await ctx.close();
      }

      const raw = await DbHelper.query<{ VehicleStatus: number }>(
        `SELECT VehicleStatus FROM dbo.RawVehiclesDetail WHERE VehicleNo=@v`, { v: registration });
      const live = await DbHelper.query<{ VehicleStatus: number }>(
        `SELECT VehicleStatus FROM dbo.VehicleDetails WHERE VehicleNo=@v`, { v: registration });
      console.log(`\n  after the attempt: raw=${JSON.stringify(raw)} live=${JSON.stringify(live)}`);
      console.log(
        `  VA-29b VERDICT: ${live.length
          ? '*** APPROVED — a vehicle went live for a DEACTIVATED customer ***'
          : 'not approved while the customer is inactive'}`
      );
    } finally {
      // ── restore, whatever happened above ────────────────────────────────
      if (deactivated) {
        const ctx = await browser.newContext();
        const page = await ctx.newPage();
        const login = new LoginPage(page);
        const dash = new DashboardPage(page);
        const status = new CustomerStatusPage(page);
        await login.navigate();
        await login.login(FP_ADMIN.username, FP_ADMIN.password);
        await dash.assertDashboardLoaded();
        await status.open();
        await status.search(BRANCH);
        const outcome = await status.act('confirm');
        console.log(`\n  RESTORE: "${outcome.action}" -> "${outcome.message}"`);
        await ctx.close();
        const restored = await customerStatus(BRANCH);
        console.log(`  ${BRANCH} restored to status ${restored}`);
        if (restored !== 101) {
          console.log(`  *** ${BRANCH} IS STILL NOT ACTIVE (${restored}) — needs manual attention ***`);
        }
      }
    }
  });
});
