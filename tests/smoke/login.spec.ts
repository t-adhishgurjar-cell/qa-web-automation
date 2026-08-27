import { expect } from '@playwright/test';
import { test } from '../../src/fixtures/page.fixtures';
import { FleetPlusTestData } from '../../src/helpers/fleetplus-test-data.helper';
import { ACCOUNT_LOCKED, INVALID_CREDENTIALS } from '../../src/pages/login.page';
import { epic, feature, story, severity, description, owner } from 'allure-js-commons';

/**
 * Login — the first feature slice.
 *
 * Covers the four-stage journey (form -> role selection -> OTP -> dashboard) and
 * the two failure modes the app actually distinguishes: a rejected credential and
 * a locked account.
 *
 * Runs serially and without a stored session. FleetPlus blocks concurrent sessions,
 * so parallel logins fight each other; and these tests exist to verify login itself,
 * which a pre-authenticated storageState would bypass entirely.
 */

test.describe.configure({ mode: 'serial' });
test.use({ storageState: { cookies: [], origins: [] } });

/**
 * Username for the negative-login test.
 *
 * FleetPlus locks an account after 5 consecutive failures and — confirmed by
 * observation — applies that to usernames that do not exist as well as to real
 * ones. So any fixed value here locks itself after five runs, and the test then
 * fails on the lockout message instead of the credential check. The username
 * therefore rotates per run. Set NEGATIVE_LOGIN_USER to pin a throwaway account.
 */
function negativeLoginUser(): string {
  const pinned = process.env.NEGATIVE_LOGIN_USER?.trim();
  if (pinned) return pinned;
  return `98${String(Date.now()).slice(-8)}`;
}

const WRONG_PASSWORD = 'DefinitelyNotThePassword!1';

/**
 * A credential of the given role, falling back to the workbook's primary.
 *
 * Tests deliberately use *different* accounts. FleetPlus keeps one session per user
 * and prompts "already signed in on another device" when a second login arrives, so
 * several tests sharing one account interfere with each other — which is exactly how
 * the logout test started failing once every test used the same TSM row.
 */
function credentialFor(userType: string) {
  return FleetPlusTestData.getCredentialByUserType(userType)
    ?? FleetPlusTestData.getPrimaryCredential();
}

test.describe('Login @smoke @auth', () => {
  test.beforeEach(async ({ loginPage }) => {
    await epic('Authentication');
    await feature('Login');
    await owner('QA Team');
    await loginPage.navigate();
    await loginPage.assertLoginPageLoaded();
  });

  test('valid credentials reach the dashboard @sanity', async ({ loginPage, dashboardPage, page }) => {
    await story('Successful login');
    await severity('critical');
    await description('Form -> role selection (if offered) -> OTP -> dashboard.');

    const { mobile, password } = FleetPlusTestData.getPrimaryCredential();
    await loginPage.login(mobile, password);

    // Name the interstitial rather than letting it surface as "no sidebar". A forced
    // password change is an account problem, not a login defect, and every workbook
    // account is currently sitting behind one.
    await expect(
      page,
      'Login landed on the forced password-change screen. Complete the change for ' +
        'this account and update the workbook, or pin a working account with ' +
        'PRIMARY_CREDENTIAL_MOBILE.'
    ).not.toHaveURL(/ChangePassword/i);

    await dashboardPage.assertDashboardLoaded();
  });

  test('invalid password is rejected with an error @sanity', async ({ loginPage }) => {
    await story('Rejected credentials');
    await severity('critical');
    await description('An unknown user with a wrong password gets an error, not a session.');

    const username = negativeLoginUser();
    await loginPage.login(username, WRONG_PASSWORD);

    // A locked account also shows an error, so a bare "some error appeared" check
    // would pass while testing nothing at all.
    if (await loginPage.isAccountLocked()) {
      throw new Error(
        `Could not test credential rejection: ${username} is locked out. ` +
          `Unset NEGATIVE_LOGIN_USER to rotate the username per run, or point it at ` +
          `a freshly unlocked account.`
      );
    }

    await loginPage.assertErrorContains(INVALID_CREDENTIALS);
  });

  test('logout returns to the login form', async ({ loginPage, dashboardPage }) => {
    await story('Logout');
    await severity('normal');

    const { mobile, password } = credentialFor('dsa');
    await loginPage.login(mobile, password);
    await dashboardPage.assertDashboardLoaded();

    await dashboardPage.logout();
    await loginPage.assertLoginPageLoaded();
  });

  test('multi-role account is offered its roles', async ({ loginPage, userTypeSelectionPage }) => {
    await story('Role selection');
    await severity('normal');
    await description('Accounts holding several roles must choose one before 2FA.');

    // Named explicitly rather than taken from getPrimaryCredential(): most accounts
    // hold a single role and skip this step entirely, so the primary would silently
    // skip the test. Customer Admin (FO) is the one account with several roles.
    const multiRole = FleetPlusTestData.getCredentialByUserType('customer admin');
    test.skip(!multiRole, 'No multi-role account marked Ready in the credentials workbook.');

    await loginPage.signIn(multiRole!.mobile, multiRole!.password);

    test.skip(
      !(await userTypeSelectionPage.isPresent()),
      'This account holds a single role, so the app skips the selection step.'
    );

    const roles = await userTypeSelectionPage.availableRoles();
    expect(roles.length).toBeGreaterThan(0);

    // Every card must carry the attributes the page object selects on — this is what
    // makes role selection robust rather than text-matched.
    for (const role of roles) {
      expect(role.code, `role card without a data-code: ${JSON.stringify(role)}`).not.toBe('');
      expect(role.userId, `role card without a data-userid: ${role.code}`).not.toBe('');
    }
  });

  test('locked account reports the lockout distinctly', async ({ loginPage }) => {
    await story('Account lockout');
    await severity('normal');
    await description(
      'A locked account must be reported as locked, not as a rejected credential — ' +
        'they need different remedies.'
    );

    const locked = process.env.LOCKED_TEST_USER?.trim();
    test.skip(!locked, 'Set LOCKED_TEST_USER to a known-locked account to run this.');

    const { password } = FleetPlusTestData.getPrimaryCredential();
    await loginPage.login(locked as string, password);
    await loginPage.assertErrorContains(ACCOUNT_LOCKED);
  });
});

/**
 * Every credential in the workbook, one test each.
 *
 * The suite above proves the login *mechanism* with a couple of accounts; this
 * proves the *accounts* — each row in the sheet is a real user with its own role,
 * region and password, and any of them can be locked or expire independently. One
 * test per row means a broken account is named in the report instead of silently
 * never being exercised.
 *
 * Loaded at module scope, so a missing workbook must not crash collection.
 */
const allCredentials = (() => {
  try {
    return FleetPlusTestData.getCredentials();
  } catch (error) {
    console.warn(`Could not read credentials workbook: ${(error as Error).message}`);
    return [];
  }
})();

test.describe('Login — every credential in the workbook @regression @roles', () => {
  test.skip(
    allCredentials.length === 0,
    'No credentials could be read from the workbook — see the warning logged at collection.'
  );

  for (const cred of allCredentials) {
    const label = [cred.userType, cred.mobile, cred.region].filter(Boolean).join(' · ');

    test(`${label} can sign in`, async ({ loginPage, dashboardPage, page }) => {
      await epic('Authentication');
      await feature('Login');
      await story(`Role: ${cred.userType || 'unspecified'}`);
      await owner('QA Team');
      await severity('critical');
      await description(
        `Signs in as ${cred.mobile} (${cred.userType || 'role unspecified'}` +
          `${cred.region ? `, ${cred.region}` : ''}) and confirms a dashboard.`
      );

      await loginPage.navigate();
      await loginPage.login(cred.mobile, cred.password);

      await expect(
        page,
        `${cred.mobile} landed on the forced password-change screen. Reset it in ` +
          `FleetPlus and update the workbook.`
      ).not.toHaveURL(/ChangePassword/i);

      await dashboardPage.assertDashboardLoaded();

      // Log out so the account is left clean; FleetPlus keeps one session per user
      // and an abandoned one prompts "already signed in" on the next run.
      await dashboardPage.logout();
    });
  }
});
