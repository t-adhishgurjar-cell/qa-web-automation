import { test as base } from '@playwright/test';
import { LoginPage } from '../pages/login.page';
import { DashboardPage } from '../pages/dashboard.page';
import { CustomerOnboardingPage } from '../pages/customer-onboarding.page';
import { OtpPage } from '../pages/otp.page';
import { UserTypeSelectionPage } from '../pages/user-type-selection.page';
import { ApiHelper } from '../helpers/api.helper';
import { DbHelper } from '../helpers/db.helper';
import { Logger } from '../helpers/logger.helper';

// ─── Define custom fixture types ──────────────────────────────────────────────
type PageFixtures = {
  loginPage: LoginPage;
  otpPage: OtpPage;
  userTypeSelectionPage: UserTypeSelectionPage;
  dashboardPage: DashboardPage;
  customerOnboardingPage: CustomerOnboardingPage;
  apiHelper: ApiHelper;
};

type WorkerFixtures = {
  logger: Logger;
  /**
   * Read-only database access, shared across every test in a worker.
   *
   * Worker-scoped on purpose: the connection pool is expensive to build and the
   * queries are reads, so there is nothing per-test to isolate. The pool is
   * closed when the worker finishes.
   */
  db: typeof DbHelper;
};

// ─── Extend base test with custom fixtures ────────────────────────────────────
export const test = base.extend<PageFixtures, WorkerFixtures>({
  // Worker-scoped logger (shared across tests in the same worker)
  logger: [
    // eslint-disable-next-line no-empty-pattern
    async ({}, use) => {
      const logger = new Logger('TestRunner');
      await use(logger);
    },
    { scope: 'worker' },
  ],

  db: [
    // eslint-disable-next-line no-empty-pattern
    async ({}, use) => {
      await use(DbHelper);
      await DbHelper.close();
    },
    { scope: 'worker' },
  ],

  // Page-scoped page object fixtures
  loginPage: async ({ page }, use) => {
    await use(new LoginPage(page));
  },

  otpPage: async ({ page }, use) => {
    await use(new OtpPage(page));
  },

  // Exposed so tests can assert on the role cards directly — LoginPage.login()
  // clears this step on its own when a test does not care about it.
  userTypeSelectionPage: async ({ page }, use) => {
    await use(new UserTypeSelectionPage(page));
  },

  dashboardPage: async ({ page }, use) => {
    await use(new DashboardPage(page));
  },

  customerOnboardingPage: async ({ page }, use) => {
    await use(new CustomerOnboardingPage(page));
  },

  // API helper fixture — pre-authenticated with env credentials
  apiHelper: async ({ request }, use) => {
    const api = new ApiHelper(request);
    await api.loginWithEnvCredentials();
    await use(api);
  },
});

export { expect } from '@playwright/test';
