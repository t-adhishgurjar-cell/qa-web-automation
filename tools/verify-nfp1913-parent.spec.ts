import { test, expect } from '@playwright/test';
import { LoginPage } from '../src/pages/login.page';
import { DashboardPage } from '../src/pages/dashboard.page';
import { AddVehiclePage } from '../src/pages/vehicle/add-vehicle.page';
import { CustomerStatusPage } from '../src/pages/customer-management/customer-status.page';
import { DbHelper } from '../src/helpers/db.helper';
import type { Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

/**
 * NFP-1913, second claim — "Parent customer is Inactive. Vehicle cannot be approved."
 *
 * The first claim is verified: with the vehicle's own customer inactive, ApproveVehicleWithRC
 * answers statusCode 0 and "Customer is Inactive. Vehicle cannot be approved." This is the other
 * half, and it needed building, because no record existed to exercise it — of 139 vehicles pending
 * approval, not one belonged to a customer that was inactive or whose parent was.
 *
 * So the whole precondition is created here:
 *
 *   NAYAFP1023400254   parent, Active            <- deactivated
 *     NAYAFP2023400255 branch, Active, unchanged  <- the vehicle is added here
 *
 * The branch stays Active throughout. That is the point: if approval were refused because the
 * branch was inactive, the test would prove the first claim again rather than the second.
 *
 * Both customers belong to this suite, created by its own onboarding chain, and the parent is
 * restored in a finally block. The restore keys off the parent's live status rather than what this
 * run believes it did — an earlier version trusted its own flag, a stale grid read set it wrong, and
 * a customer was left deactivated.
 *
 *   TOOLS=true ENV=qa npx playwright test --project=tools --grep "nfp1913 parent"
 */

const PARENT = process.env.VERIFY_PARENT ?? 'NAYAFP1023400254';
const BRANCH = process.env.VERIFY_BRANCH ?? 'NAYAFP2023400255';
const ADDER = { username: '9073139002', password: process.env.OFFICER_PASSWORD ?? 'Nayara@1' };
const APPROVER = { username: '9073275904', password: process.env.OFFICER_PASSWORD ?? 'Nayara@1' };
const FP = { username: 'loadtest_006', password: process.env.OFFICER_PASSWORD ?? 'Nayara@1' };
const POOL = path.join(__dirname, '../test-data/deregistered-vehicles.json');

const PARENT_INACTIVE = /parent\s+customer\s+is\s+inactive/i;
const CUSTOMER_INACTIVE = /^(?!.*parent).*customer\s+is\s+inactive/i;

async function signIn(page: Page, username: string, password: string): Promise<void> {
  await page.context().clearCookies();
  await new LoginPage(page).navigate();
  await new LoginPage(page).login(username, password);
  await new DashboardPage(page).assertDashboardLoaded();
}

/** A registration FleetPlus has never seen. De-registered numbers fail Vahan, which is the trigger. */
async function freeRegistration(): Promise<string> {
  const pool: { no: string }[] = JSON.parse(fs.readFileSync(POOL, 'utf8'));
  for (const entry of pool) {
    const taken = await DbHelper.query<{ n: number }>(
      `SELECT (SELECT COUNT(*) FROM dbo.VehicleDetails WHERE VehicleNo = @v)
            + (SELECT COUNT(*) FROM dbo.RawVehiclesDetail WHERE VehicleNo = @v) AS n`, { v: entry.no });
    if (Number(taken[0]?.n ?? 0) === 0) return entry.no;
  }
  throw new Error('the de-registered pool is exhausted');
}

async function statusOf(customer: string): Promise<number | null> {
  const rows = await DbHelper.query<{ Status: number }>(
    `SELECT Status FROM dbo.CustomerMaster WHERE CustomerID = @c`, { c: customer });
  return rows[0]?.Status ?? null;
}

async function vehicleStatus(registration: string): Promise<number | null> {
  const rows = await DbHelper.query<{ VehicleStatus: number }>(
    `SELECT VehicleStatus FROM dbo.RawVehiclesDetail WHERE VehicleNo = @v`, { v: registration });
  return rows[0]?.VehicleStatus ?? null;
}

/** Polls the customer-status grid, which reloads after the change rather than with it. */
async function settled(status: CustomerStatusPage, customer: string, want?: 'Active' | 'Inactive') {
  let last: 'Active' | 'Inactive' | null = null;
  for (let i = 0; i < 8; i++) {
    await status.open();
    await status.search(customer);
    last = await status.currentStatus();
    if (!want || last === want) return last;
  }
  return last;
}

test.describe('Tools — verification @tools', () => {
  test('nfp1913 parent — an inactive parent blocks vehicle approval', async ({ page }) => {
    test.setTimeout(900_000);

    console.log(`  parent ${PARENT} status ${await statusOf(PARENT)}`);
    console.log(`  branch ${BRANCH} status ${await statusOf(BRANCH)}`);

    // ── 1. A vehicle at 411 on the branch, both customers still Active.
    const registration = await freeRegistration();
    console.log(`\n  seeding ${registration} on ${BRANCH} as ${ADDER.username}`);
    await signIn(page, ADDER.username, ADDER.password);
    const add = new AddVehiclePage(page);
    await add.open();
    await add.chooseCustomer(BRANCH);
    const seeded = await add.addOne(registration);
    console.log(`  add outcome: ${JSON.stringify(seeded).slice(0, 240)}`);

    const queuedAt = await vehicleStatus(registration);
    console.log(`  ${registration} is at ${queuedAt}`);
    expect(
      queuedAt,
      `${registration} did not reach 411. Vahan may have verified it, in which case it went live ` +
        `instead of queueing — pick another registration.`
    ).toBe(411);

    // ── 2. Deactivate the PARENT only.
    await signIn(page, FP.username, FP.password);
    const status = new CustomerStatusPage(page);
    const parentBefore = await settled(status, PARENT);
    console.log(`\n  ${PARENT} is ${parentBefore}`);

    try {
      expect(parentBefore, `${PARENT} must start Active for this test`).toBe('Active');
      await status.act('confirm');
      const parentNow = await settled(status, PARENT, 'Inactive');
      console.log(`  ${PARENT} is now ${parentNow}`);
      expect(parentNow, `${PARENT} could not be deactivated`).toBe('Inactive');

      // ── 2b. The cascade, and why this half of the ticket is hard to reach.
      //
      // Deactivating the parent deactivates its branches too — measured: NAYAFP2023400255 went to
      // 104 on its own. That is defensible behaviour, and it means the state the second message
      // describes (branch Active, parent Inactive) is not produced by deactivating a parent. If the
      // branch is inactive then the FIRST guard applies, and a refusal would prove the first claim
      // over again.
      //
      // So the only way to reach it from the UI is to put the branch back to Active while leaving
      // the parent Inactive. Whether the application permits that is itself worth knowing: if it
      // refuses, the second message is unreachable from here and is either defensive code or
      // reachable only through some other path.
      let branchStatus = await statusOf(BRANCH);
      console.log(`  ${BRANCH} is ${branchStatus} — the parent's deactivation cascaded`);

      if (branchStatus !== 101) {
        console.log(`\n  attempting to reactivate ${BRANCH} while ${PARENT} stays Inactive`);
        const branchNow = await settled(status, BRANCH);
        console.log(`  the screen says ${BRANCH} is ${branchNow}, action offered: ${await status.availableAction()}`);
        const outcome = await status.act('confirm');
        console.log(`  outcome: ${JSON.stringify(outcome)}`);
        branchStatus = await statusOf(BRANCH);
        console.log(`  ${BRANCH} is now ${branchStatus}; ${PARENT} is ${await statusOf(PARENT)}`);
      }

      if (branchStatus !== 101 || (await statusOf(PARENT)) !== 104) {
        console.log(
          `\n  VERDICT: the state this half of NFP-1913 describes — an ACTIVE branch under an\n` +
          `  INACTIVE parent — could not be produced through the UI. Deactivating the parent\n` +
          `  cascades to the branch, and the branch cannot be reactivated while the parent is\n` +
          `  inactive. So "Parent customer is Inactive. Vehicle cannot be approved." is not\n` +
          `  reachable by this route: any refusal here would come from the branch's own status.\n` +
          `  Either the message guards a state reached some other way — a branch added or imported\n` +
          `  under an inactive parent — or it is defensive code. Worth asking whoever wrote the fix\n` +
          `  which they intended, because an unreachable message cannot be signed off as working.`
        );
        return;
      }

      // ── 3. Attempt the approval.
      await signIn(page, APPROVER.username, APPROVER.password);
      const posts: string[] = [];
      page.on('response', async r => {
        if (r.request().method() === 'POST' && /approve|vehicle/i.test(r.url())) {
          posts.push(`${r.status()} ${r.url().split('/').pop()?.split('?')[0]}: ` +
            `${(await r.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 260)}`);
        }
      });

      await page.goto('/Vehicle/VehicleApproval', { waitUntil: 'domcontentloaded' });
      await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);

      const row = page.locator('table tbody tr').filter({ hasText: registration }).first();
      await expect(row, `${registration} is not in the approval queue`).toBeVisible({ timeout: 20_000 });
      await row.locator('.btn-approve-vahan').first().click();

      // Answer "Approve vehicle <reg>? Cancel | Yes". Without this no request is sent at all, and
      // the vehicle stays pending for the wrong reason — which is exactly how the first claim was
      // nearly mis-verified.
      const confirm = page.locator('.modal.show').first();
      await expect(confirm, 'Approve raised no confirmation, so nothing was submitted').toBeVisible({ timeout: 10_000 });
      const yes = confirm.locator('button:visible, .btn:visible')
        .filter({ hasText: /^\s*(yes|confirm|ok|approve)/i })
        .filter({ hasNotText: /^\s*(no|cancel|close)/i }).first();
      await yes.click();
      await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);
      await page.waitForTimeout(2_000);

      const said = await page.evaluate(() =>
        Array.from(document.querySelectorAll('.modal.show, .toast.show, #error-mess-text, #failer-mess-text, #succ-mess-text'))
          .filter(e => !!(e as HTMLElement).offsetParent)
          .map(e => (e.textContent || '').replace(/\s+/g, ' ').trim())
          .filter(t => t.length > 2));
      const text = [...new Set(said)].join(' ');

      console.log(`\n  requests: ${posts.join('  ||  ') || 'NONE — nothing was submitted'}`);
      console.log(`  on screen: ${text || 'nothing'}`);

      const finalStatus = await vehicleStatus(registration);
      console.log(`  ${registration} is now at ${finalStatus}`);

      // ── 4. The verdict.
      expect(
        posts.some(p => /ApproveVehicleWithRC/i.test(p)),
        'No approval request was sent, so this says nothing about the fix.'
      ).toBeTruthy();

      expect(
        finalStatus,
        `${registration} was approved (now ${finalStatus}) even though its parent ${PARENT} is ` +
          `inactive. The second half of NFP-1913 has not held.`
      ).toBe(411);

      expect(
        PARENT_INACTIVE.test(text) || posts.some(p => PARENT_INACTIVE.test(p)),
        `The approval was refused and the vehicle stayed pending, but the message does not name the ` +
          `parent. Expected "Parent customer is Inactive. Vehicle cannot be approved."; got: ` +
          `${text || 'nothing on screen'} / ${posts.join(' || ')}. If it says only "Customer is ` +
          `Inactive" then the guard fires on the wrong relationship and the operator is told the ` +
          `wrong thing.`
      ).toBeTruthy();
    } finally {
      // Restore on the parent's live status, not on anything this run believes.
      await signIn(page, FP.username, FP.password);
      const restore = new CustomerStatusPage(page);
      const now = await settled(restore, PARENT);
      console.log(`\n  restoring ${PARENT}: currently ${now}, should be ${parentBefore}`);
      if (now && parentBefore && now !== parentBefore) {
        await restore.act('confirm');
        const final = await settled(restore, PARENT, parentBefore);
        console.log(`  ${PARENT} is now ${final}`);
        expect(final, `${PARENT} could not be restored`).toBe(parentBefore);
      }
      console.log(`  ${BRANCH} is ${await statusOf(BRANCH)}`);
    }
  });
});
