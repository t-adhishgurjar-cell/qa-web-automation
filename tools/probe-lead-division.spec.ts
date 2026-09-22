import { test } from '../src/fixtures/page.fixtures';
import { FP_ADMIN } from '../src/config/accounts';

/**
 * The second enrolment path: Leads.
 *
 * Everything tested so far is Add Customer. dbo.LeadMaster is a separate entry
 * point with its own PinCode and DivisionId columns, and the menus name two
 * screens for it — "Leads Management" (/Lead/LeadList) and "Customer Referrals"
 * (/Lead/CustomerReferral). A lead carries a division derived from somewhere it is
 * not asked for: lead 47 has pin code 160019 (Chandigarh) and DivisionId 17
 * (Gurgaon), which looks exactly like the pin-code-basis-division rule the change
 * request wants removed, living in a second place.
 *
 * So this opens both screens and reports what they render — whether a lead can be
 * created here, and whether that form carries a division and a pin code.
 *
 *   TOOLS=true ENV=qa npx playwright test --project=tools --grep "probe lead division"
 */

test.use({ storageState: { cookies: [], origins: [] } });

const ROUTES = ['/Lead/LeadList', '/Lead/CustomerReferral'];

test.describe('Tools — probes @tools', () => {
  test('probe lead division', async ({ loginPage, dashboardPage, page }) => {
    test.setTimeout(300_000);

    await loginPage.navigate();
    await loginPage.login(FP_ADMIN.username, FP_ADMIN.password);
    await dashboardPage.assertDashboardLoaded();

    for (const route of ROUTES) {
      console.log(`\n=== ${route} ===`);
      const response = await page.goto(route, { waitUntil: 'domcontentloaded' }).catch(() => null);
      await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);
      console.log(`  http ${response?.status() ?? 0}, url now ${page.url()}`);

      const body = (await page.locator('body').textContent().catch(() => '')) ?? '';
      if (/unauthor|access denied/i.test(body)) {
        console.log('  REFUSED to this role');
        continue;
      }

      const fields = await page.evaluate(() =>
        Array.from(document.querySelectorAll('input,select,textarea'))
          .filter(e => (e as HTMLInputElement).type !== 'hidden' && e.id)
          .map(e => {
            const element = e as HTMLInputElement;
            return `${element.tagName.toLowerCase()}#${element.id}` +
              `${element.offsetParent ? '' : ' (hidden)'}` +
              `${/division|pin|state|city|district/i.test(element.id) ? '   <-- location' : ''}`;
          })
      );
      console.log(`  ${fields.length} field(s):`);
      for (const f of fields) console.log(`    ${f}`);

      const buttons = await page.evaluate(() =>
        Array.from(document.querySelectorAll('button, a.btn'))
          .filter(e => !!(e as HTMLElement).offsetParent)
          .map(e => `${e.id || '(no id)'} "${(e.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 30)}"`)
      );
      console.log(`  visible controls: ${buttons.join(' | ') || 'none'}`);
    }
  });
});
