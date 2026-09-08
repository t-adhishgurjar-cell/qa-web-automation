import { Page } from '@playwright/test';
import { test as base } from './page.fixtures';
import { LoginPage } from '../pages/login.page';
import { DashboardPage } from '../pages/dashboard.page';

/**
 * One login per worker instead of one per test.
 *
 * Measured on a full matrix run: 53 tests, 53 logins, 23.6 seconds each — 20.9
 * minutes of a 40-minute run spent re-establishing a session that had not
 * changed.
 *
 * ── Why the session is held open rather than saved and restored ────────────
 * The obvious approach — log in once, save storageState, hand the file to every
 * test — does not work against FleetPlus. Cookies restored into a fresh context
 * are refused and the app serves the login screen again, so the session is bound
 * to more than the cookie jar. Instead one context stays open for the life of
 * the worker and every test drives the same page, which is what a real operator
 * does anyway.
 *
 * ── What this gives up ────────────────────────────────────────────────────
 * Per-test browser isolation. Tests in a worker now share cookies, storage and
 * history, so one that leaves the app somewhere unexpected affects the next.
 * That is tolerable here because every test in these suites navigates to its own
 * starting point rather than assuming where it landed, and because they run
 * serially within a worker. It would not be tolerable for tests that assert on a
 * clean first-visit state.
 *
 * ── Why per worker and not per run ────────────────────────────────────────
 * FleetPlus evicts other sessions for the same account — the
 * #profile-active-session-ok-btn dialog is the app doing exactly that. Sharing
 * one session across parallel workers would have them logging each other out.
 * Running several workers needs several accounts, not one shared session.
 *
 * Only suites that import from here are affected; auth.setup and the smoke tests
 * that exercise the login screen itself keep their own fresh contexts.
 */

const USER = process.env.FP_ADMIN_USER ?? 'loadtest_006';
const PASS = process.env.FP_ADMIN_PASS ?? 'Nayara@1';

type SessionFixtures = {
  /** A logged-in page, shared by every test in this worker. */
  sessionPage: Page;
};

/**
 * No test-scoped fixtures are added here — only the built-in `page` is
 * overridden. Record<string, never> would impose an index signature that types
 * every fixture as never, so the empty-key form is the one that leaves the
 * inherited fixtures alone.
 */
type NoAddedTestFixtures = Record<never, never>;

export const test = base.extend<NoAddedTestFixtures, SessionFixtures>({
  sessionPage: [
    async ({ browser }, use, workerInfo) => {
      // baseURL has to be passed explicitly: a context built here does not
      // inherit the project's `use` block the way the built-in page fixture
      // does, and without it every relative goto fails as an invalid URL.
      const baseURL = workerInfo.project.use.baseURL ?? process.env.BASE_URL;
      const context = await browser.newContext({
        baseURL,
        viewport: workerInfo.project.use.viewport ?? { width: 1280, height: 720 },
      });
      const page = await context.newPage();

      try {
        const loginPage = new LoginPage(page);
        const dashboardPage = new DashboardPage(page);
        await loginPage.navigate();
        await loginPage.login(USER, PASS);
        await dashboardPage.assertDashboardLoaded();
        await use(page);
      } finally {
        await context.close();
      }
    },
    { scope: 'worker' },
  ],

  page: async ({ sessionPage }, use) => {
    await use(sessionPage);
  },
});

export { expect } from '@playwright/test';
