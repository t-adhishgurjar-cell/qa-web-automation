import { test } from '../src/fixtures/page.fixtures';

/**
 * Proves a one-mobile, two-role account can sign in as each of its roles.
 *
 * Built for the pair create-customer-and-branch-admin.spec.ts produces, where the cold
 * sign-in as the second role failed with "Unable to verify session. Please try again."
 * immediately after a successful sign-in as the first. Clearing cookies ends the session
 * in the browser and not on the server, so that message is the application objecting to a
 * session it still holds — a different thing entirely from a rejected password, and worth
 * separating before anyone concludes the Branch Admin credential does not work.
 *
 * So each role gets its own test, which means its own browser context, and the order is
 * deliberately the reverse of the tool's: Branch Admin first. If the password were the
 * problem, Branch Admin fails whichever way round it runs. If the session is the problem,
 * whichever role goes second is the one that fails.
 *
 *   CBA_MOBILE=9036339500 TOOLS=true ENV=qa npx playwright test --project=tools \
 *     --grep "verify dual admin login"
 */

const MOBILE = process.env.CBA_MOBILE ?? '9036339500';
const PASSWORD = process.env.CBA_PASSWORD ?? 'Nayara@1';

test.use({ storageState: { cookies: [], origins: [] } });

test.describe('Tools — verify dual admin login @tools', () => {
  test.describe.configure({ mode: 'serial' });

  for (const role of ['BRANCH_ADMIN', 'CUSTOMER_ADMIN'] as const) {
    test(`verify dual admin login — ${role}`, async ({ page, loginPage, dashboardPage }) => {
      test.setTimeout(5 * 60_000);

      await loginPage.navigate();
      await loginPage.login(MOBILE, PASSWORD, role);
      await dashboardPage.assertDashboardLoaded();
      console.log(`  ${role}: ${MOBILE} / ${PASSWORD} — signed in at ${page.url()}`);
    });
  }
});
