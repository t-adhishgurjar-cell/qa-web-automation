import { test, expect } from '@playwright/test';
import { LoginPage } from '../src/pages/login.page';
import { DashboardPage } from '../src/pages/dashboard.page';
import { ChangePasswordPage } from '../src/pages/change-password.page';
import { DbHelper } from '../src/helpers/db.helper';

/**
 * Puts the six new officers onto a known password.
 *
 * An Office API officer arrives with a temporary password and is parked on
 * /Home/ChangePassword until it is changed, so none of them can be used by a
 * suite as created. This reads each temporary password from dbo.UserSMSLog —
 * where the activation SMS is logged, whether or not it was actually sent —
 * signs in with it, sets the target password through the UI, and then proves
 * the result by signing in again from scratch.
 *
 * The QA whitelist means these messages are recorded with
 * Status "Skipped — mobile not in whitelist". The row still holds the password.
 *
 *   TOOLS=true ENV=qa npx playwright test --project=tools --grep "set officer passwords"
 *
 * THIS CHANGES REAL CREDENTIALS. It is in tools/ so a normal run cannot reach it.
 */

const TARGET_PASSWORD = process.env.OFFICER_PASSWORD ?? 'Nayara@1';

const OFFICERS = [
  { mobile: '9072986100', label: 'Ahmedabad — Region Admin (West)' },
  { mobile: '9073068501', label: 'Ahmedabad — State Admin (GJ_I)' },
  { mobile: '9073139002', label: 'Ahmedabad I — Division Admin' },
  { mobile: '9073209903', label: 'Kolkata — Region Admin (East)' },
  { mobile: '9073275904', label: 'Kolkata — State Admin (WB_NE)' },
  { mobile: '9073340105', label: 'Kolkata — Division Admin' },
];

/** The temporary password, read out of the activation SMS. */
async function temporaryPassword(mobile: string): Promise<string | null> {
  const rows = await DbHelper.query<{ SMSText: string }>(
    `SELECT TOP 1 SMSText FROM dbo.UserSMSLog
      WHERE MobileNo = @mobile AND SMSText LIKE '%Temporary Password%'
      ORDER BY Id DESC`,
    { mobile }
  );
  return rows[0]?.SMSText?.match(/Temporary Password:\s*(\S+?)\.\s/)?.[1] ?? null;
}

test.use({ storageState: { cookies: [], origins: [] } });

test.describe('Tools — data building @tools', () => {
  for (const officer of OFFICERS) {
    test(`set officer passwords — ${officer.mobile}`, async ({ page }) => {
      test.setTimeout(5 * 60_000);

      const loginPage = new LoginPage(page);
      const dashboardPage = new DashboardPage(page);
      const changePage = new ChangePasswordPage(page);

      const temp = await temporaryPassword(officer.mobile);
      expect(temp, `No activation SMS with a temporary password for ${officer.mobile}`).toBeTruthy();

      await loginPage.navigate();
      await loginPage.login(officer.mobile, temp!);

      // Already changed on an earlier run? Then there is nothing to do, and
      // saying so beats failing on a screen that never appeared.
      if (!(await changePage.isShowing())) {
        console.log(`${officer.label}: not on the change screen (url ${page.url()}) — already changed?`);
        test.skip(true, `${officer.mobile} was not asked to change its password`);
        return;
      }

      const said = await changePage.change(temp!, TARGET_PASSWORD);
      console.log(`${officer.label} (${officer.mobile}): "${said || 'no message'}"`);

      // The application's word is not the proof. Sign in again, cold.
      await page.context().clearCookies();
      await loginPage.navigate();
      await loginPage.login(officer.mobile, TARGET_PASSWORD);
      await dashboardPage.assertDashboardLoaded();

      console.log(`${officer.label}: ${officer.mobile} / ${TARGET_PASSWORD} — verified at ${page.url()}`);
    });
  }
});
