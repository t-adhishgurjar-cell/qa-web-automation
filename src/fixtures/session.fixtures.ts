import { Browser, BrowserContext, Page } from '@playwright/test';
import { test as base } from './page.fixtures';
import { LoginPage } from '../pages/login.page';
import { DashboardPage } from '../pages/dashboard.page';
import { RoleSelector } from '../pages/user-type-selection.page';
import { Account, FP_ADMIN } from '../config/accounts';

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
 *
 * ── Choosing the account ──────────────────────────────────────────────────
 * The session signed in as FP_ADMIN and nothing else, which is why the suites
 * that need a parent admin, a DSA or a divisional officer kept logging in per
 * test and paid the 23.6 seconds every time. A spec now names its account:
 *
 *   test.use({ sessionAccount: PARENT_ADMIN });
 *
 * Specs that drive several accounts in one file take `sessionFor` instead and
 * ask for each one; the worker holds a session per account and reuses it.
 */

/** An account, plus the role card to pick when the login offers a choice. */
export type SessionAccount = Account & { roleCode?: RoleSelector };

type SessionOptions = {
  /** The account `sessionPage` signs in as. Override per spec with test.use(). */
  sessionAccount: SessionAccount;
};

type SessionFixtures = {
  /** A logged-in page for `sessionAccount`, shared by every test in this worker. */
  sessionPage: Page;
  /**
   * A logged-in page for any account, reused for the life of the worker.
   *
   * For specs that need more than one account. Asking twice for the same
   * account returns the same page rather than signing in again.
   */
  sessionFor: (account: SessionAccount) => Promise<Page>;
};

/** One open, signed-in context. */
interface HeldSession {
  context: BrowserContext;
  page: Page;
}

/** Distinguishes the two role cards behind a single mobile number. */
function keyFor(account: SessionAccount): string {
  return `${account.username}\u0000${account.roleCode ?? ''}`;
}

async function signIn(
  browser: Browser,
  account: SessionAccount,
  baseURL: string | undefined,
  viewport: { width: number; height: number }
): Promise<HeldSession> {
  const context = await browser.newContext({ baseURL, viewport });
  const page = await context.newPage();

  try {
    const loginPage = new LoginPage(page);
    await loginPage.navigate();
    await loginPage.login(account.username, account.password, account.roleCode);
    await new DashboardPage(page).assertDashboardLoaded();
  } catch (error) {
    await context.close();
    throw error;
  }

  return { context, page };
}

/**
 * No test-scoped fixtures are added here — only the built-in `page` is
 * overridden. Record<string, never> would impose an index signature that types
 * every fixture as never, so the empty-key form is the one that leaves the
 * inherited fixtures alone.
 */
type NoAddedTestFixtures = Record<never, never>;

export const test = base.extend<NoAddedTestFixtures, SessionOptions & SessionFixtures>({
  sessionAccount: [FP_ADMIN, { scope: 'worker', option: true }],

  sessionFor: [
    async ({ browser }, use, workerInfo) => {
      // baseURL has to be passed explicitly: a context built here does not
      // inherit the project's `use` block the way the built-in page fixture
      // does, and without it every relative goto fails as an invalid URL.
      const baseURL = workerInfo.project.use.baseURL ?? process.env.BASE_URL;
      const viewport = workerInfo.project.use.viewport ?? { width: 1280, height: 720 };
      const held = new Map<string, HeldSession>();

      await use(async (account) => {
        const key = keyFor(account);
        const existing = held.get(key);
        if (existing) return existing.page;

        // One live session per user, whichever role card was chosen: signing in
        // as a branch admin ends the parent admin's session on the same mobile.
        // Drop the page we hold for that user rather than hand back one the app
        // has already signed out from under us.
        for (const [otherKey, session] of held) {
          if (otherKey.startsWith(`${account.username}\u0000`)) {
            await session.context.close();
            held.delete(otherKey);
          }
        }

        const session = await signIn(browser, account, baseURL, viewport);
        held.set(key, session);
        return session.page;
      });

      for (const session of held.values()) {
        await session.context.close();
      }
    },
    { scope: 'worker' },
  ],

  sessionPage: [
    async ({ sessionFor, sessionAccount }, use) => {
      await use(await sessionFor(sessionAccount));
    },
    { scope: 'worker' },
  ],

  page: async ({ sessionPage }, use) => {
    await use(sessionPage);
  },
});

export { expect } from '@playwright/test';
