import { test } from '@playwright/test';
import { LoginPage } from '../src/pages/login.page';
import { DashboardPage } from '../src/pages/dashboard.page';
import { PARENT_ADMIN } from '../src/config/accounts';

/**
 * Are those two screens really refused, or did the matcher misfire?
 *
 * checkScreen() calls a page refused when its body matches /unauthor|access denied|not permitted/i.
 * That is a text match, and a screen could contain such wording for another reason — so before filing
 * anything, read the status, the first of the body, and whether the sidebar even offers the menu item.
 *
 * The expectation being tested: Vehicle RO Mapping is granted to the Customer Admin role, which 51,468
 * active users hold, and this account is a Customer Admin. View Vehicles is granted to Admin, which
 * FP Admin accounts hold.
 *
 *   TOOLS=true ENV=qa npx playwright test --project=tools --grep "probe refused vehicle screens"
 */

const CASES = [
  { label: 'Customer Admin', username: PARENT_ADMIN.username, password: PARENT_ADMIN.password,
    roleCode: PARENT_ADMIN.roleCode, route: '/Vehicle/VehicleROMapping', menu: /RO Mapping/i },
  { label: 'FP Admin', username: 'loadtest_006', password: process.env.OFFICER_PASSWORD ?? 'Nayara@1',
    roleCode: undefined, route: '/Vehicle/ViewVehicles', menu: /View Vehicles/i },
];

test.describe('Tools — probes @tools', () => {
  for (const c of CASES) {
    test(`probe refused vehicle screens — ${c.label} ${c.route}`, async ({ page }) => {
      test.setTimeout(420_000);

      await new LoginPage(page).navigate();
      await new LoginPage(page).login(c.username, c.password, c.roleCode);
      await new DashboardPage(page).assertDashboardLoaded();

      // Does the sidebar offer it at all? That is the entitlement the role mapping describes.
      const inMenu = await page.locator('a[href]').filter({ hasText: c.menu }).count();
      const hrefs = await page.evaluate(() =>
        Array.from(document.querySelectorAll('a[href]'))
          .map(a => (a as HTMLAnchorElement).getAttribute('href') || '')
          .filter(h => /Vehicle\//i.test(h)));
      console.log(`  ${c.label}: menu item matching ${c.menu} present ${inMenu > 0}`);
      console.log(`  vehicle links in the sidebar: ${[...new Set(hrefs)].join(', ') || 'none'}`);

      const response = await page.goto(c.route, { waitUntil: 'domcontentloaded' }).catch(() => null);
      await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);
      const body = ((await page.locator('body').textContent().catch(() => '')) ?? '')
        .replace(/\s+/g, ' ').trim();

      console.log(`  http ${response?.status() ?? 0}, url ${page.url()}`);
      console.log(`  body starts: ${body.slice(0, 200)}`);
      console.log(`  matches the refusal wording: ${/unauthor|access denied|not permitted/i.test(body)}`);

      const controls = await page.evaluate(() =>
        Array.from(document.querySelectorAll('input,select,button,table'))
          .filter(e => e.id && !!(e as HTMLElement).offsetParent && e.id !== 'sidebarPinBtn')
          .map(e => `${e.tagName.toLowerCase()}#${e.id}`));
      console.log(`  controls: ${controls.join(', ') || 'none'}`);
    });
  }
});
