import { expect } from '@playwright/test';
import { test } from '../../src/fixtures/page.fixtures';
import { description, epic, feature, owner, parameter, severity, story } from 'allure-js-commons';
import { PARENT_ADMIN, BRANCH_ADMIN } from '../../src/config/accounts';

/**
 * Branch scoping, as enforced by the shape of each form.
 *
 * 9200000000 holds both a Customer Admin and seven Branch Admin logins. Walking
 * every module as each role showed the branch admin gets 25 of the parent's 39,
 * with no module of its own — and, more interestingly, that several *shared*
 * screens are not the same screen twice. The branch admin's copy has the branch
 * selector taken out:
 *
 *   Manage Customer Users   vcuBranchSelect          removed
 *   Manage Credit PIN       txtBranchUid             removed
 *   Credit Pin Logs         cplBranchLocationSelect  replaced by a readonly
 *   Add Vehicles            avBranchLocation         removed
 *   Block/Unblock Vehicle   mvBranchLocation         removed
 *   Transaction Details     wftAddCustomerScope      removed
 *
 * Credit Pin Logs is the clearest case: a branch *selector* for the parent
 * becomes a branch *readonly* for the branch admin. Same page, scope pinned.
 *
 * ── Why assert this at all ────────────────────────────────────────────────
 * Because it is a permission enforced by absence, and absence is fragile. It
 * holds exactly as long as the form keeps this shape; a field restored by a
 * later change, or re-enabled in a browser's devtools, leaves nothing between
 * one branch's administrator and another branch's data unless the server checks
 * independently. This suite pins the client-side half so a regression in it is
 * visible.
 *
 * ── What this suite deliberately does NOT do ──────────────────────────────
 * It does not test whether the *server* enforces the same scope. Doing that
 * means submitting another branch's id as a branch admin and seeing what
 * happens — and if the server does not enforce it, that submission writes to a
 * branch the account should never touch. That is a write against real data, so
 * it is out of scope here and needs an explicit decision before anyone runs it.
 *
 * Passing this suite therefore means "the client still hides it", not "the
 * boundary is enforced". The difference matters and is recorded on every test.
 *
 * ── Serial, and why ───────────────────────────────────────────────────────
 * Both roles are the same mobile, and this application evicts an existing
 * session when the account signs in again. Run in parallel and each login kills
 * the other's page mid-assertion.
 */

interface ScopedScreen {
  label: string;
  route: string;
  /** Controls the parent admin has and the branch admin must not. */
  parentOnly: string[];
  /** Controls that appear only for the branch admin, if any. */
  branchOnly: string[];
  /** What the removed control would have let the holder choose. */
  grants: string;
}

const SCOPED_SCREENS: ScopedScreen[] = [
  {
    label: 'Manage Customer Users',
    route: '/Customer/ViewCustomerUser',
    parentOnly: ['#vcuBranchSelect'],
    branchOnly: [],
    grants: 'listing the users of any branch, not only the signed-in one',
  },
  {
    label: 'Manage Credit PIN',
    route: '/Customer/CustomerCreditPinValidity',
    parentOnly: ['#txtBranchUid'],
    branchOnly: [],
    grants: "reading or changing another branch's credit PIN validity",
  },
  {
    label: 'Credit Pin Logs',
    route: '/Customer/CreditPinChangeLog',
    parentOnly: ['#cplBranchLocationSelect'],
    branchOnly: ['#cplBranchLocationReadonly'],
    grants: "reading another branch's credit PIN change history",
  },
  {
    label: 'Add Vehicles',
    route: '/Vehicle/AddVehicles',
    parentOnly: ['#avBranchLocation'],
    branchOnly: [],
    grants: 'adding a vehicle onto a branch other than the signed-in one',
  },
  {
    label: 'Block/Unblock Vehicle',
    route: '/Vehicle/VehicleBlockUnblock',
    parentOnly: ['#mvBranchLocation'],
    branchOnly: [],
    grants: "blocking or unblocking another branch's vehicles",
  },
];

/** Modules the branch admin has no route to at all. */
const PARENT_ONLY_MODULES = [
  { label: 'Add Branch', route: '/Customer/AddBranch', why: 'creates company structure' },
  { label: 'Add Customer Bank Account', route: '/Financial/AddBankDetails', why: 'changes where money settles' },
  { label: 'Wallet Transfer', route: '/Financial/FundTransfer', why: 'moves money' },
  { label: 'Wallet Recharge By PG', route: '/PgRecharge/WalletRecharge', why: 'moves money' },
  { label: 'Redeem Fuel Voucher', route: '/FuelVoucher/RenderRedeemVoucherPage', why: 'redeems value' },
];

test.use({ storageState: { cookies: [], origins: [] } });

test.describe('Role scope @customer-management', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async () => {
    await epic('Customer Management');
    await feature('Role scope');
    await owner('QA Team');
    test.skip(!PARENT_ADMIN.password, 'Set PARENT_ADMIN_PASS for ' + PARENT_ADMIN.username);
  });

  test('a parent admin is offered the branch selector on every scoped screen', async ({
    loginPage,
    dashboardPage,
    page,
  }) => {
    await story('Branch scoping');
    await severity('normal');
    await parameter('Role', PARENT_ADMIN.roleCode);
    await description(
      'The control half of the pair. If the parent admin stopped seeing these ' +
        'selectors, the branch admin assertions below would pass for the wrong ' +
        'reason — absence proves nothing when the control is gone for everyone.'
    );

    await loginPage.navigate();
    await loginPage.login(PARENT_ADMIN.username, PARENT_ADMIN.password, PARENT_ADMIN.roleCode);
    await dashboardPage.assertDashboardLoaded();

    for (const screen of SCOPED_SCREENS) {
      await page.goto(screen.route, { waitUntil: 'domcontentloaded', timeout: 45_000 });
      await page.waitForTimeout(2_500);

      for (const selector of screen.parentOnly) {
        await expect(
          page.locator(selector).first(),
          `${screen.label} (${screen.route}) did not offer ${selector} to a parent ` +
            `admin. Either the screen changed or this role lost a capability it ` +
            `had; until that is resolved the branch-admin test for this screen ` +
            `proves nothing.`
        ).toBeVisible({ timeout: 15_000 });
      }
    }
  });

  test('a branch admin is not offered any branch selector', async ({
    loginPage,
    dashboardPage,
    page,
  }) => {
    await story('Branch scoping');
    await severity('critical');
    await parameter('Role', BRANCH_ADMIN.roleCode);
    await description(
      'Each of these screens is shared with the parent admin but rendered ' +
        'without its branch selector, which is what confines this role to its ' +
        'own branch. Asserts the absence only — whether the server enforces the ' +
        'same scope is untested, and would need a write to find out.'
    );

    await loginPage.navigate();
    await loginPage.login(BRANCH_ADMIN.username, BRANCH_ADMIN.password, BRANCH_ADMIN.roleCode);
    await dashboardPage.assertDashboardLoaded();

    for (const screen of SCOPED_SCREENS) {
      await page.goto(screen.route, { waitUntil: 'domcontentloaded', timeout: 45_000 });
      await page.waitForTimeout(2_500);

      for (const selector of screen.parentOnly) {
        expect(
          await page.locator(selector).first().isVisible().catch(() => false),
          `${screen.label} (${screen.route}) offered ${selector} to a branch ` +
            `admin. That control is what allows ${screen.grants}, and this role ` +
            `is confined to one branch precisely by not having it.`
        ).toBe(false);
      }

      for (const selector of screen.branchOnly) {
        await expect(
          page.locator(selector).first(),
          `${screen.label} did not render ${selector}, the readonly stand-in a ` +
            `branch admin gets in place of the selector. Without it the branch ` +
            `is neither shown nor chosen, which is a different screen from the ` +
            `one this expectation was written against.`
        ).toBeVisible({ timeout: 15_000 });
      }
    }
  });

  /**
   * TC_MCS_03, finally runnable.
   *
   * The workbook has always had this case and it has always been skipped for
   * want of an account without the entitlement. 9200000000 is one:
   * /Customer/ManageCustomerStatus appears in none of the 39 modules its menu
   * offers. It is the more valuable half of the access pair — that an FP Admin
   * can reach the screen says nothing about who else can — and the screen
   * activates and deactivates customers.
   */
  test('a Customer Admin is refused Manage Customer Status', async ({
    loginPage,
    dashboardPage,
    page,
  }) => {
    await story('Entitlement');
    await severity('critical');
    await parameter('Unentitled account', PARENT_ADMIN.username);
    await description(
      'Navigates directly rather than looking for a menu entry: a screen ' +
        'missing from the menu but still served on its URL is reachable by ' +
        'anyone who knows the path.'
    );

    await loginPage.navigate();
    await loginPage.login(PARENT_ADMIN.username, PARENT_ADMIN.password, PARENT_ADMIN.roleCode);
    await dashboardPage.assertDashboardLoaded();

    await page.goto('/Customer/ManageCustomerStatus', {
      waitUntil: 'domcontentloaded',
      timeout: 45_000,
    });
    await page.waitForTimeout(2_500);

    const refused = await page
      .locator('text=/unauthorized access|do not have permission/i')
      .first()
      .isVisible()
      .catch(() => false);

    const searchOffered = await page.locator('#searchInput').isVisible().catch(() => false);

    expect(
      searchOffered,
      `A Customer Admin (${PARENT_ADMIN.username}) was served ` +
        `/Customer/ManageCustomerStatus with its search box, despite the ` +
        `screen being absent from all 39 modules its own menu offers. This ` +
        `screen activates and deactivates customers, so a role that should ` +
        `not see it could change customer status by knowing the URL.`
    ).toBe(false);

    expect(
      refused,
      `The screen was not served, but it did not say why either — no ` +
        `"Unauthorized Access" message appeared. A silent refusal is hard to ` +
        `distinguish from a page that simply failed to render, which matters ` +
        `when this is what stands between a role and customer status.`
    ).toBe(true);
  });

  test('a branch admin cannot reach the parent-only modules', async ({
    loginPage,
    dashboardPage,
    page,
  }) => {
    await story('Entitlement');
    await severity('critical');
    await parameter('Role', BRANCH_ADMIN.roleCode);
    await description(
      'Fourteen of the parent admin’s 39 modules are absent from the branch ' +
        'admin’s menu. These five are the ones that create company structure or ' +
        'move money. Navigating directly rather than looking for a menu entry: ' +
        'a module missing from the menu but still served on its URL is reachable ' +
        'by anyone who knows the path.\n\n' +
        'Measured behaviour: the application answers on the same URL with an ' +
        '"Unauthorized Access" page naming the module. That is a real check, ' +
        'not merely a hidden link — unlike the branch selectors above, which are ' +
        'enforced only by absence from the form.'
    );

    await loginPage.navigate();
    await loginPage.login(BRANCH_ADMIN.username, BRANCH_ADMIN.password, BRANCH_ADMIN.roleCode);
    await dashboardPage.assertDashboardLoaded();

    const served: string[] = [];

    for (const module of PARENT_ONLY_MODULES) {
      await page.goto(module.route, { waitUntil: 'domcontentloaded', timeout: 45_000 })
        .catch(() => undefined);
      await page.waitForTimeout(2_500);

      // How this application refuses matters, and I had it backwards.
      //
      // It does NOT redirect. It answers on the same URL with a dedicated page:
      // a lock icon, the title "Unauthorized Access", and the text "You do not
      // have permission to access the <Module> page. Please contact your
      // administrator." Judging refusal by a change of URL therefore counts
      // every correctly-refused module as served, and reports a clean
      // entitlement boundary as five security holes.
      const refused = await page
        .locator('text=/unauthorized access|do not have permission/i')
        .first()
        .isVisible()
        .catch(() => false);

      const bouncedToLogin = /\/Home\/(Index|Login)|login/i.test(page.url());

      if (!refused && !bouncedToLogin) {
        served.push(`${module.label} (${module.route}) — ${module.why}`);
      }
    }

    expect(
      served,
      `A branch admin was served ${served.length} module(s) that are absent from ` +
        `its own menu:\n  ${served.join('\n  ')}\n\n` +
        `Hiding a link is not an entitlement. Anyone with the URL reaches these.`
    ).toEqual([]);
  });
});
