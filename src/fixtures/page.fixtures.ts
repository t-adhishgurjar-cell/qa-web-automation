import { test as base } from '@playwright/test';
import { LoginPage } from '../pages/login.page';
import { DashboardPage } from '../pages/dashboard.page';
import { CustomerOnboardingPage } from '../pages/customer-onboarding.page';
import { OtpPage } from '../pages/otp.page';
import { UserTypeSelectionPage } from '../pages/user-type-selection.page';
import { ApiHelper } from '../helpers/api.helper';
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
