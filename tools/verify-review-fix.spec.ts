import { expect } from '@playwright/test';
import { test } from '../src/fixtures/page.fixtures';
import { ReviewCustomerPage } from '../src/pages/customer-management/review-customer.page';
import { DbHelper } from '../src/helpers/db.helper';
import { TSM } from '../src/config/accounts';

/**
 * Does the corrected review walk actually hand the application on?
 *
 * The E2E chain builds its own application and holds the reference in a
 * module-level variable, so the review stage cannot be re-run on its own. This
 * drives ReviewCustomerPage against an application that is already sitting at
 * 102 and asserts the status moved — the one thing the fix has to achieve.
 *
 * It WRITES: a successful review moves the application to 105 and puts it in
 * the checker's queue. That is the application's normal forward path and the
 * same thing the E2E suite does, on a form this suite raised itself.
 *
 *   TOOLS=true ENV=qa PROBE_REFERENCE=1000514858 \
 *     npx playwright test --project=tools --grep "verify review fix"
 */

const REFERENCE = process.env.PROBE_REFERENCE ?? '1000514858';

async function statusOf(reference: string): Promise<number | null> {
  const rows = await DbHelper.query<{ Status: number }>(
    `SELECT TOP 1 Status FROM dbo.RawCustomerMaster WHERE ReferenceNo = @reference ORDER BY Id DESC`,
    { reference }
  );
  return rows[0]?.Status ?? null;
}

test.use({ storageState: { cookies: [], origins: [] } });

test.describe('Tools — probes @tools', () => {
  test('verify review fix', async ({ loginPage, dashboardPage, page }) => {
    test.setTimeout(6 * 60_000);
    test.skip(!TSM.password, 'Set TSM_PASS');

    const before = await statusOf(REFERENCE);
    console.log(`${REFERENCE} before review: status ${before}`);
    expect(before, `${REFERENCE} is not waiting for review`).toBe(102);

    await loginPage.navigate();
    await loginPage.login(TSM.username, TSM.password);
    await dashboardPage.assertDashboardLoaded();

    const review = new ReviewCustomerPage(page);
    const outcome = await review.review(REFERENCE);
    console.log(`walked ${outcome.steps} step(s); the screen said: "${outcome.message}"`);

    await page.waitForTimeout(3_000);
    const after = await statusOf(REFERENCE);
    console.log(`${REFERENCE} after review: status ${after}`);

    expect(
      after,
      `The review walked ${outcome.steps} step(s) and said "${outcome.message}", ` +
        `but the application is still at ${after}. 105 is the checker's queue; ` +
        `anything else means the review did not hand it on.`
    ).toBe(105);
  });
});
