import { test, expect } from '@playwright/test';
import { LoginPage } from '../src/pages/login.page';
import { DashboardPage } from '../src/pages/dashboard.page';
import { CustomerStatusPage } from '../src/pages/customer-management/customer-status.page';
import type { Page } from '@playwright/test';

/**
 * NFP-1913 — a pending vehicle can no longer be approved for an inactive customer.
 *
 * Verifies the fix for the defect this suite raised: adding a vehicle was refused for an inactive
 * customer, but approving one already queued was not, so a vehicle could go live against a
 * customer that had been switched off. The fix is claimed as two messages:
 *
 *   "Customer is Inactive. Vehicle cannot be approved."
 *   "Parent customer is Inactive. Vehicle cannot be approved."
 *
 * ── Two accounts, because no single one can do both halves ────────────────
 * Manage Customer Status does not render for the Kolkata State Admin — #searchInput never appears,
 * so that role is not entitled to it. The status change therefore runs as FP Admin and the approval
 * attempt as the officer. That split is closer to the real thing anyway: the person who deactivates
 * a customer is not the person sitting in the approval queue, which is exactly why the queue has to
 * re-check rather than trust what was true at submit.
 *
 * The approver is deliberately an officer from another region. Since the mapping change any state
 * or division admin can act on any row, and none of them has context on a customer in a geography
 * they have never dealt with — so "is this customer still active?" is precisely the judgement the
 * system should not be leaving to them.
 *
 * ── Why it reads the screen rather than the database ──────────────────────
 * Written while the database was unreachable (VPN down, ECONNRESET) and kept that way, because
 * every claim in the ticket is visible on screen: the message is text, the customer's status is on
 * Manage Customer Status, and "the vehicle stays pending" shows as the row still being in the queue.
 * That makes this runnable during an outage, which is when a fix most often needs checking.
 *
 * The weaker half, named rather than hidden: queue membership is not the same as reading 411 from
 * VehicleDetails. Re-run probe-va29b-deactivated-after-queue.spec.ts for that once the database is
 * back.
 *
 *   TOOLS=true ENV=qa npx playwright test --project=tools --grep "nfp1913"
 */

/** This suite's own customer, created by the onboarding E2E chain. Never someone else's. */
const CUSTOMER = process.env.VERIFY_CUSTOMER ?? 'NAYAFP2023400255';
const APPROVER = { label: 'Kolkata State Admin (WB_NE / East)', mobile: '9073275904' };
const PASSWORD = process.env.OFFICER_PASSWORD ?? 'Nayara@1';

/**
 * Who changes the customer's status.
 *
 * Not FP Admin: that account's password has expired — sign-in reports "Password expired. Reset
 * required." — so it cannot be used until someone resets it. The Ahmedabad officers are tried in
 * order of scope instead, narrowest last, and the first that can open Manage Customer Status is
 * used. Worth reporting separately: the account this suite treats as its administrator is unusable.
 */
const STATUS_CHANGERS = [
  // FP Admin first: the role mapping grants Activate / Deactivate Customer only to FP_ADMIN and
  // HO_ADMIN, and none of the officer accounts this suite holds has it. Its username is not a
  // mobile number, which is why these are `username` rather than `mobile`.
  { label: 'FP Admin', username: process.env.VERIFY_STATUS_USER ?? 'loadtest_006',
    password: process.env.VERIFY_STATUS_PASS ?? PASSWORD },
  { label: 'Ahmedabad State Admin', username: '9073068501', password: PASSWORD },
  { label: 'Ahmedabad I Division Admin', username: '9073139002', password: PASSWORD },
];


const CUSTOMER_INACTIVE = /customer\s+is\s+inactive/i;
const PARENT_INACTIVE = /parent\s+customer\s+is\s+inactive/i;
const APPROVED = /approved\s+successfully/i;

async function signIn(page: Page, username: string, password: string): Promise<void> {
  await page.context().clearCookies();
  const login = new LoginPage(page);
  const dashboard = new DashboardPage(page);
  await login.navigate();
  await login.login(username, password);
  await dashboard.assertDashboardLoaded();
}

/** Everything the page chose to say, with the required-field asterisks filtered out. */
/**
 * The customer's status, read after the grid has actually refreshed.
 *
 * A single search() then currentStatus() returns the previous value: the status change posts, the
 * grid reloads asynchronously, and a read taken straight afterwards sees the old row. That reported
 * a successful deactivation as "still Active", which then skipped the restore and left the customer
 * switched off — the one kind of damage this test must not do. So the read is polled.
 */
async function settledStatus(
  status: CustomerStatusPage,
  customer: string,
  expected?: 'Active' | 'Inactive'
): Promise<'Active' | 'Inactive' | null> {
  let last: 'Active' | 'Inactive' | null = null;
  for (let attempt = 0; attempt < 8; attempt++) {
    await status.open();
    await status.search(customer);
    last = await status.currentStatus();
    if (!expected || last === expected) return last;
  }
  return last;
}

async function whatItSaid(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    for (const sel of ['.modal.show', '.toast.show', '#error-mess-text', '#failer-mess-text',
                       '#succ-mess-text', '.text-danger', '.field-validation-error']) {
      for (const el of Array.from(document.querySelectorAll(sel))) {
        const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
        if (t && !/^[*\s]+$/.test(t) && !!(el as HTMLElement).offsetParent) out.push(t.slice(0, 240));
      }
    }
    return [...new Set(out)];
  });
}

/** Rows in the approval queue mentioning a customer, with the registration in each. */
async function pendingFor(page: Page, customer: string): Promise<string[]> {
  await page.goto('/Vehicle/VehicleApproval', { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);
  return page.evaluate(id =>
    Array.from(document.querySelectorAll('table tbody tr'))
      .map(tr => Array.from(tr.querySelectorAll('td')).map(td => (td.textContent || '').trim()))
      .filter(cells => cells.includes(id))
      // A registration, not the customer id. NAYAFP2023400255 also matches a loose
      // two-letters-then-alphanumerics pattern, which is how an earlier run reported the customer
      // id as the vehicle and then could not find a row for it.
      .map(cells => cells.find(c => /^[A-Z]{2}\d{1,2}[A-Z]{1,3}\d{1,4}$/.test(c)) ?? '(no registration cell)')
  , customer);
}

test.describe('Tools — verification @tools', () => {
  test('nfp1913 — an inactive customer blocks vehicle approval', async ({ page }) => {
    test.setTimeout(600_000);

    // ── Is there anything to act on?
    await signIn(page, APPROVER.mobile, PASSWORD);
    const queued = await pendingFor(page, CUSTOMER);
    console.log(`  ${CUSTOMER} has ${queued.length} vehicle(s) pending: ${queued.join(', ') || 'none'}`);

    if (!queued.length) {
      console.log(
        `\n  Nothing pending for ${CUSTOMER}, so the fix cannot be exercised. Seed one with\n` +
        `  tools/seed-approval-queue.spec.ts — a vehicle whose Vahan verification fails lands\n` +
        `  at 411 — then re-run this.`
      );
      return;
    }
    const registration = queued[0];

    // ── Deactivate, as the first account that can reach the screen.
    const status = new CustomerStatusPage(page);
    let changer: { label: string; username: string; password: string } | null = null;
    for (const candidate of STATUS_CHANGERS) {
      const signedIn = await signIn(page, candidate.username, candidate.password)
        .then(() => true)
        .catch(e => { console.log(`  ${candidate.label} could not sign in: ${String(e).split('\n')[0]}`); return false; });
      if (!signedIn) continue;
      const reachable = await status.open().then(() => true).catch(() => false);
      console.log(`  ${candidate.label} (${candidate.username}) can open Manage Customer Status: ${reachable}`);
      if (reachable) { changer = candidate; break; }
    }
    expect(changer, 'No available account can open Manage Customer Status').toBeTruthy();

    await status.search(CUSTOMER);
    const before = await status.currentStatus();
    console.log(`\n  ${CUSTOMER} is ${before}`);

    let switchedOff = false;
    try {
      if (before === 'Active') {
        console.log(`  action offered: ${await status.availableAction()}`);
        // The status change posts to UpdateCustomerStatus, which answers
        // {"status":1,"reason":"… successfully."} — but the page renders nothing, so an empty
        // message here is normal and is not evidence that the change failed.
        console.log(`  deactivating: ${JSON.stringify(await status.act('confirm'))}`);
        const now = await settledStatus(status, CUSTOMER, 'Inactive');
        console.log(`  ${CUSTOMER} is now ${now}`);
        switchedOff = now === 'Inactive';
      } else if (before === 'Inactive') {
        console.log('  already inactive — nothing to change');
        switchedOff = true;
      }

      expect(switchedOff, `${CUSTOMER} is not Inactive, so the fix cannot be exercised`).toBeTruthy();

      // ── Attempt the approval, as the officer, on the row for this registration.
      await signIn(page, APPROVER.mobile, PASSWORD);
      await page.goto('/Vehicle/VehicleApproval', { waitUntil: 'domcontentloaded' });
      await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);

      // Scoped to the matched row. There is no page-level Approve — every row carries its own
      // control, so acting on "the first Approve on the page" approves row one, which is how the
      // wrong vehicle was approved here once.
      const row = page.locator('table tbody tr').filter({ hasText: registration }).first();
      await expect(row, `${registration} is no longer listed in the approval queue`).toBeVisible();
      console.log(`\n  acting on: ${(await row.textContent())?.replace(/\s+/g, ' ').trim().slice(0, 150)}`);

      await row.locator('.btn-approve-vahan').first().click();

      // Answer the confirmation. This is not optional and its absence is why an earlier run
      // reported "the application said nothing": Approve raises "Approve vehicle <reg>? Cancel |
      // Yes", and without answering it no request is sent at all — so the vehicle stayed pending
      // for the wrong reason and the fix looked silent when it was simply never invoked.
      const confirm = page.locator('.modal.show').first();
      if (await confirm.waitFor({ state: 'visible', timeout: 10_000 }).then(() => true).catch(() => false)) {
        console.log(`  confirmation: ${((await confirm.textContent()) ?? '').replace(/\s+/g, ' ').trim().slice(0, 120)}`);
        const yes = confirm.locator('button:visible, .btn:visible')
          .filter({ hasText: /^\s*(yes|confirm|ok|approve)/i })
          .filter({ hasNotText: /^\s*(no|cancel|close)/i }).first();
        await expect(yes, 'The approval confirmation offered nothing to accept').toBeVisible();
        await yes.click();
      } else {
        throw new Error(
          'Approve raised no confirmation dialog, so nothing was submitted. The outcome below ' +
          'would say nothing about the fix.'
        );
      }

      await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);
      await page.waitForTimeout(2_000);

      const said = await whatItSaid(page);
      const text = said.join(' ');
      console.log(`\n  the application said: ${said.join('  ||  ') || 'nothing'}`);
      console.log(`    matched "Customer is Inactive…":        ${CUSTOMER_INACTIVE.test(text)}`);
      console.log(`    matched "Parent customer is Inactive…": ${PARENT_INACTIVE.test(text)}`);
      console.log(`    reported a successful approval:          ${APPROVED.test(text)}`);

      expect(
        APPROVED.test(text),
        `NFP-1913 has not held. ${CUSTOMER} is Inactive and the approval of ${registration} was ` +
          `reported successful. The application said: ${said.join(' || ') || 'nothing'}`
      ).toBeFalsy();

      expect(
        CUSTOMER_INACTIVE.test(text) || PARENT_INACTIVE.test(text),
        `The approval was not reported successful, but neither did the application say the ` +
          `customer is inactive. It said: ${said.join(' || ') || 'nothing at all'}. A silent ` +
          `refusal is an improvement on approving it and is still not what the ticket claims.`
      ).toBeTruthy();

      // ── And it must still be pending.
      const after = await pendingFor(page, CUSTOMER);
      console.log(`\n  still pending for ${CUSTOMER}: ${after.join(', ') || 'none'}`);
      expect(
        after,
        `${registration} left the approval queue even though the approval was refused.`
      ).toContain(registration);
    } finally {
      // Reactivate whatever was switched off, whatever happened above. Leaving a customer
      // deactivated stops it transacting — damage a test must not do.
      // Restore on what the customer's status actually is now, not on what this run believes it
      // did. An earlier version keyed the restore off its own flag, a stale read set that flag
      // wrong, and the customer was left deactivated — so the condition is the live status and the
      // target is whatever it was at the start.
      if (changer && before) {
        await signIn(page, changer.username, changer.password);
        const restore = new CustomerStatusPage(page);
        const actual = await settledStatus(restore, CUSTOMER);
        console.log(`\n  restoring: ${CUSTOMER} is ${actual}, should be ${before}`);
        if (actual && actual !== before) {
          console.log(`  ${JSON.stringify(await restore.act('confirm'))}`);
          const final = await settledStatus(restore, CUSTOMER, before);
          console.log(`  ${CUSTOMER} is now ${final}`);
          expect(final, `${CUSTOMER} could not be restored to ${before}`).toBe(before);
        } else {
          console.log('  nothing to restore');
        }
      }
    }
  });
});
