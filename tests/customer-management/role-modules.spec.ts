import { expect } from '@playwright/test';
import { test } from '../../src/fixtures/page.fixtures';
import { description, epic, feature, owner, parameter, severity, story } from 'allure-js-commons';
import { PARENT_ADMIN, BRANCH_ADMIN } from '../../src/config/accounts';
import { modulesFor, ModuleRole, RoleModule } from '../../src/data/role-modules.data';

/**
 * Every module a Parent Admin and a Branch Admin can reach, exercised.
 *
 * 39 modules for the parent, 25 for the branch, one test each. Built from a
 * walk of the live application rather than from the coverage note, so it covers
 * what these roles actually get — including the eleven Vehicle Management
 * screens and six Reports that no suite touched before.
 *
 * ── What each test asserts, and why that is more than "it loaded" ─────────
 * Four things, in the order they can fail:
 *
 *   1. the application did not refuse it — this app answers on the same URL
 *      with an "Unauthorized Access" page rather than redirecting, so a URL
 *      check alone reads a refusal as a success
 *   2. the page printed its own title, from p.box-head-title
 *   3. the working controls are present, against floors measured on the
 *      rendered page
 *   4. nothing on screen is reporting an error
 *
 * The third is the one that earns its keep. A FleetPlus screen that fails
 * server-side still answers 200 and still renders its chrome — sidebar, header,
 * title — with the form or grid simply absent. A "did the page load" check
 * calls that healthy. Asserting the control count catches it.
 *
 * Floors, not equalities: a screen that gains a field passes, a screen that
 * loses its form does not.
 *
 * ── Read-only ────────────────────────────────────────────────────────────
 * Navigates and reads. Nothing is filled, submitted, or clicked beyond what
 * loading a page does — these are live customer records.
 *
 * ── Serial ───────────────────────────────────────────────────────────────
 * Both roles are the same mobile and this application evicts an existing
 * session when the account signs in again, so the two describes cannot overlap.
 */

interface Reading {
  refused: boolean;
  title: string;
  fields: number;
  buttons: number;
  grids: number;
  errors: string[];
  url: string;
}

async function readScreen(page: import('@playwright/test').Page): Promise<Reading> {
  return page.evaluate(() => {
    const onScreen = (el: Element) => {
      const r = (el as HTMLElement).getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    const text = (el: Element | null) => (el?.textContent || '').replace(/\s+/g, ' ').trim();

    // Visible only. This application parks its dialogs in the DOM permanently
    // and hidden, so an unfiltered count includes controls no user can reach.
    const visible = (selector: string) =>
      Array.from(document.querySelectorAll(selector)).filter(onScreen);

    const title = text(
      Array.from(document.querySelectorAll('p.box-head-title, .box-head-title, h1, h2, h3'))
        .find(onScreen) ?? null
    );

    const body = document.body.innerText || '';
    const refused = /unauthorized access|do not have permission/i.test(body);

    // An empty state is not an error, and this application announces both
    // through the same red modal. "Error No fuel vouchers found." is what a
    // customer with no vouchers sees on a perfectly healthy screen, so
    // treating every visible .modal.show as a fault fails working modules on
    // the strength of their own test data.
    const EMPTY_STATE = /no\s+\w+.*(found|available)|no record|no data|not available|0 record/i;

    const errors = Array.from(document.querySelectorAll('.alert-danger, .text-danger, .modal.show'))
      .filter(onScreen)
      .map(el => text(el))
      .filter(t => t.length > 3 && /[a-z]/i.test(t))
      .filter(t => !EMPTY_STATE.test(t));

    return {
      refused,
      title,
      fields: visible('input:not([type=hidden]), select, textarea').length,
      buttons: visible('button, input[type=submit], input[type=button]').length,
      grids: visible('table').length,
      errors,
      url: location.href,
    };
  });
}

function runModuleSuite(role: ModuleRole, account: typeof PARENT_ADMIN | typeof BRANCH_ADMIN) {
  const modules = modulesFor(role);
  const roleName = role === 'parent' ? 'Parent Admin' : 'Branch Admin';

  test.describe(`${roleName} modules @customer-management @regression`, () => {
    // Deliberately NOT serial. Serial skips every remaining test in the
    // describe once one fails, so a single module's empty state hid seven
    // unrelated screens on the first run — the opposite of what a per-module
    // inventory is for. These tests share a login but are otherwise
    // independent, and beforeEach signs in again if the session is gone.
    test.describe.configure({ mode: 'default' });

    test.beforeAll(async () => {
      test.skip(!account.password, `Set PARENT_ADMIN_PASS for ${account.username}`);
    });

    // One login for the whole set. Signing in per test would be 39 logins
    // against an application that evicts sessions, and would spend more time
    // authenticating than testing.
    let signedIn = false;

    test.beforeEach(async ({ loginPage, dashboardPage, page }) => {
      await epic('Customer Management');
      await feature(`${roleName} module access`);
      await owner('QA Team');
      await parameter('Account', account.username);
      await parameter('Role', account.roleCode);

      if (signedIn && (await page.locator('#sidebarMenu').isVisible().catch(() => false))) return;

      await loginPage.navigate();
      await loginPage.login(account.username, account.password, account.roleCode);
      await dashboardPage.assertDashboardLoaded();
      signedIn = true;
    });

    for (const module of modules) {
      test(`${module.section} — ${module.label} opens and renders its controls`, async ({ page }) => {
        await story(module.section);
        await severity(module.grids > 0 || module.fields > 2 ? 'normal' : 'minor');
        await description(
          `Opens ${module.route} as a ${roleName} and checks the screen came ` +
            `back whole: not refused, titled, and carrying at least ` +
            `${module.fields} field(s), ${module.buttons} button(s) and ` +
            `${module.grids} grid(s) — the counts measured on the working page. ` +
            `A server-side failure here still answers 200 and still renders the ` +
            `chrome, so the control count is what separates a working screen ` +
            `from an empty shell.`
        );

        await page.goto(module.route, { waitUntil: 'domcontentloaded', timeout: 45_000 });
        await page.waitForTimeout(2_500);

        const seen = await readScreen(page);

        expect(
          seen.refused,
          `${module.label} (${module.route}) answered with "Unauthorized Access" ` +
            `for a ${roleName}. This module is in this role's own menu, so ` +
            `either the entitlement was withdrawn or the menu is offering a ` +
            `screen the server will not serve.`
        ).toBe(false);

        expect(
          seen.title.length,
          `${module.label} (${module.route}) rendered no page title. The route ` +
            `answered and the chrome is present, but p.box-head-title is empty — ` +
            `which is how this application looks when the view failed behind a ` +
            `200. Landed on ${seen.url}.`
        ).toBeGreaterThan(0);

        expect(
          seen.fields,
          `${module.label} (${module.route}) rendered ${seen.fields} visible ` +
            `field(s); ${module.fields} were measured on the working screen. ` +
            `Titled "${seen.title}". A form that has lost its inputs is not a ` +
            `usable screen even though the page loaded.`
        ).toBeGreaterThanOrEqual(module.fields);

        expect(
          seen.buttons,
          `${module.label} (${module.route}) rendered ${seen.buttons} visible ` +
            `button(s); ${module.buttons} were measured. Titled "${seen.title}". ` +
            `Without its controls the screen can be read but not used.`
        ).toBeGreaterThanOrEqual(module.buttons);

        expect(
          seen.grids,
          `${module.label} (${module.route}) rendered ${seen.grids} grid(s); ` +
            `${module.grids} were measured. A missing table usually means the ` +
            `data call behind it failed while the page itself succeeded.`
        ).toBeGreaterThanOrEqual(module.grids);

        expect(
          seen.errors,
          `${module.label} (${module.route}) opened with an error on screen: ` +
            `${seen.errors.join(' | ')}`
        ).toEqual([]);
      });
    }
  });
}

test.use({ storageState: { cookies: [], origins: [] } });

runModuleSuite('parent', PARENT_ADMIN);
runModuleSuite('branch', BRANCH_ADMIN);
