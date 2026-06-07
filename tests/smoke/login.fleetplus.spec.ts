import { test } from '../../src/fixtures/page.fixtures';
import { FleetPlusTestData } from '../../src/helpers/fleetplus-test-data.helper';
import {
  buildLoginTestContext,
  runLoginTestCase,
  runMultiUserLogin,
} from '../../src/helpers/login-test.executor';
import { epic, feature, story, severity, description, owner } from 'allure-js-commons';

// ─── Load data from Excel sheets ───────────────────────────────────────────────
// Credentials: test-data/FleetPlusUsercredentials.xlsx
// Test cases:  test-data/FleetPlusMasterTestCases.xlsx → Login sheet

const credentials = FleetPlusTestData.getCredentials();
const primaryUser = credentials.length > 0 ? FleetPlusTestData.getPrimaryCredential() : null;
const loginTestCases = FleetPlusTestData.getAutomatableLoginTestCases();
const webAutomatableIds = FleetPlusTestData.getWebAutomatableTcIds();

// ─── Suite 1: One login test per Ready credential from the credentials sheet ───

test.describe('FleetPlus Login — Credentials Sheet @smoke @login', () => {
  test.beforeEach(async ({ loginPage }) => {
    await epic('Authentication');
    await feature('Login');
    await owner('QA Team');
    await loginPage.navigate();
    await loginPage.assertLoginPageLoaded();
  });

  for (const cred of credentials) {
    test(`Login as ${cred.userType} [${cred.mobile}]`, async ({ loginPage, dashboardPage, page }) => {
      await story(cred.userType);
      await severity('critical');
      await description(
        `Verifies successful login for ${cred.userType} using mobile ${cred.mobile} from FleetPlus_TestCredentials sheet`
      );

      await runMultiUserLogin(cred, loginPage, dashboardPage, page);
    });
  }
});

// ─── Suite 2: Master test cases from Login sheet (Automate = Yes) ──────────────

test.describe('FleetPlus Login — Master Test Cases @smoke @login', () => {
  test.beforeEach(async ({ loginPage }) => {
    await epic('Authentication');
    await feature('Login');
    await owner('QA Team');
    await loginPage.navigate();
    await loginPage.assertLoginPageLoaded();
  });

  for (const tc of loginTestCases) {
    const isWebReady = webAutomatableIds.has(tc.tcId);

    test(`${tc.tcId}: ${tc.scenario}`, async ({ loginPage, dashboardPage, page }) => {
      test.skip(!primaryUser, 'No Ready credentials in FleetPlus_TestCredentials (1).xlsx');
      test.skip(!isWebReady, `Web automation not implemented for ${tc.tcId} (${tc.subModule})`);

      await story(tc.subModule || tc.module);
      await severity(tc.severity.toLowerCase() as 'critical' | 'normal' | 'minor' | 'blocker' | 'trivial');
      await description(
        `Steps: ${tc.steps}\n\nExpected: ${tc.expectedResult}\n\nTest Data: ${tc.testData}`
      );

      const ctx = buildLoginTestContext(page, loginPage, dashboardPage, credentials, primaryUser!);
      await runLoginTestCase(tc, ctx);
    });
  }
});

// ─── Suite 3: Role-based login — one dashboard check per user type ───────────

test.describe('FleetPlus Login — Role-Based Dashboard @smoke @login', () => {
  test.beforeEach(async ({ loginPage }) => {
    await epic('Authentication');
    await feature('Login');
    await owner('QA Team');
    await loginPage.navigate();
    await loginPage.assertLoginPageLoaded();
  });

  for (const cred of credentials) {
    test(`LOG-001 [${cred.userType} - ${cred.mobile}]: lands on role dashboard`, async ({ loginPage, dashboardPage, page }) => {
      await story('Role-Based Dashboard After Login');
      await severity('critical');
      await description(`Verifies ${cred.userType} reaches dashboard after login + 2FA`);

      await loginPage.login(cred.mobile, cred.password);
      await dashboardPage.assertDashboardLoaded();
      await dashboardPage.logout();
    });
  }
});
