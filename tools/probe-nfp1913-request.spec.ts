import { test, expect } from '@playwright/test';
import { LoginPage } from '../src/pages/login.page';
import { DashboardPage } from '../src/pages/dashboard.page';
import { CustomerStatusPage } from '../src/pages/customer-management/customer-status.page';
import type { Page } from '@playwright/test';

/**
 * Did the server refuse the approval, or did the click never land?
 *
 * With the customer inactive, the approval of DL4CNB1474 was not reported successful and the vehicle
 * stayed at 411 with ApprovedBy null — which is the outcome NFP-1913 wants. But the application
 * displayed nothing at all, and "nothing happened" has two very different causes:
 *
 *   the request was sent and the server refused  -> the fix works; only the message is missing
 *   no request was sent                          -> the click did nothing and the run proves nothing
 *
 * This watches the network across the click, so the two are told apart. It also answers the same
 * question for an ACTIVE customer immediately afterwards, because a click that sends nothing either
 * way would be a broken button rather than a working guard.
 *
 *   TOOLS=true ENV=qa npx playwright test --project=tools --grep "probe nfp1913 request"
 */

const CUSTOMER = 'NAYAFP2023400255';
const REGISTRATION = process.env.VERIFY_VEHICLE ?? 'DL4CNB1474';
const FP = { username: 'loadtest_006', password: process.env.OFFICER_PASSWORD ?? 'Nayara@1' };
const APPROVER = { username: '9073275904', password: process.env.OFFICER_PASSWORD ?? 'Nayara@1' };

async function signIn(page: Page, username: string, password: string): Promise<void> {
  await page.context().clearCookies();
  await new LoginPage(page).navigate();
  await new LoginPage(page).login(username, password);
  await new DashboardPage(page).assertDashboardLoaded();
}

async function settledStatus(status: CustomerStatusPage, want?: 'Active' | 'Inactive') {
  let last: 'Active' | 'Inactive' | null = null;
  for (let i = 0; i < 8; i++) {
    await status.open();
    await status.search(CUSTOMER);
    last = await status.currentStatus();
    if (!want || last === want) return last;
  }
  return last;
}

/** Clicks Approve on the row for one registration and reports every request it caused. */
async function attemptApproval(page: Page): Promise<{ posts: string[]; said: string[] }> {
  const posts: string[] = [];
  const listener = async (response: { request: () => { method: () => string }; url: () => string; status: () => number; text: () => Promise<string> }) => {
    if (response.request().method() !== 'POST') return;
    const url = response.url();
    if (!/vehicle|approv/i.test(url)) return;
    posts.push(`${response.status()} ${url.split('/').pop()?.split('?')[0]}: ` +
      `${(await response.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 220)}`);
  };
  page.on('response', listener);

  await page.goto('/Vehicle/VehicleApproval', { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);

  const row = page.locator('table tbody tr').filter({ hasText: REGISTRATION }).first();
  await expect(row, `${REGISTRATION} is not in the approval queue`).toBeVisible({ timeout: 20_000 });
  await row.locator('.btn-approve-vahan').first().click();

  // Any confirmation the action raises, answered explicitly — "Yes"/"Confirm"/"OK", never the
  // first button in the dialog, which on this application is as often Cancel or the close cross.
  const dialog = page.locator('.modal.show').first();
  if (await dialog.waitFor({ state: 'visible', timeout: 8_000 }).then(() => true).catch(() => false)) {
    const text = ((await dialog.textContent()) ?? '').replace(/\s+/g, ' ').trim();
    console.log(`    a dialog appeared: ${text.slice(0, 200)}`);
    const yes = dialog.locator('button:visible, .btn:visible')
      .filter({ hasText: /^\s*(yes|confirm|ok|approve)/i })
      .filter({ hasNotText: /^\s*(no|cancel|close)/i }).first();
    if (await yes.isVisible().catch(() => false)) {
      console.log(`    answering "${((await yes.textContent()) ?? '').trim()}"`);
      await yes.click();
    }
  } else {
    console.log('    no dialog appeared');
  }
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);
  await page.waitForTimeout(2_000);

  const said = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.modal.show, .toast.show, #error-mess-text, #failer-mess-text, #succ-mess-text'))
      .filter(e => !!(e as HTMLElement).offsetParent)
      .map(e => (e.textContent || '').replace(/\s+/g, ' ').trim())
      .filter(t => t.length > 2));
  page.off('response', listener);
  return { posts, said: [...new Set(said)] };
}

test.describe('Tools — probes @tools', () => {
  test('probe nfp1913 request', async ({ page }) => {
    test.setTimeout(600_000);

    // ── With the customer inactive.
    await signIn(page, FP.username, FP.password);
    const status = new CustomerStatusPage(page);
    const before = await settledStatus(status);
    console.log(`  ${CUSTOMER} starts ${before}`);

    try {
      if (before === 'Active') {
        await status.act('confirm');
        console.log(`  deactivated -> ${await settledStatus(status, 'Inactive')}`);
      }

      await signIn(page, APPROVER.username, APPROVER.password);
      console.log(`\n  attempting approval of ${REGISTRATION} while the customer is INACTIVE`);
      const inactive = await attemptApproval(page);
      console.log(`    requests: ${inactive.posts.join('  ||  ') || 'NONE — the click sent nothing'}`);
      console.log(`    on screen: ${inactive.said.join('  ||  ') || 'nothing'}`);
    } finally {
      await signIn(page, FP.username, FP.password);
      const restore = new CustomerStatusPage(page);
      const now = await settledStatus(restore);
      if (now && before && now !== before) {
        await restore.act('confirm');
        console.log(`\n  restored -> ${await settledStatus(restore, before)}`);
      }
    }

    // ── And with the customer active, as the control.
    await signIn(page, APPROVER.username, APPROVER.password);
    console.log(`\n  attempting approval of ${REGISTRATION} while the customer is ACTIVE (control)`);
    const active = await attemptApproval(page);
    console.log(`    requests: ${active.posts.join('  ||  ') || 'NONE — the click sent nothing'}`);
    console.log(`    on screen: ${active.said.join('  ||  ') || 'nothing'}`);
    console.log(
      '\n  NOTE: if this control approved the vehicle, that is correct behaviour for an active\n' +
      '  customer — and it consumes DL4CNB1474, so a further run needs a newly queued vehicle.'
    );
  });
});
