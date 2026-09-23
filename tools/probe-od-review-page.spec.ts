import { test } from '../src/fixtures/page.fixtures';
import { TSM } from '../src/config/accounts';

/**
 * What the reviewer screen renders for an OD application.
 *
 * ReviewCustomerPage.review() reported steps: 0 and "the page refused without a dialog"
 * against two OD applications at 102. Two readings, opposite conclusions:
 *
 *   the TSM cannot see them — review is division-scoped and these carry the dummy
 *   divisions 61 and 53, which no TSM is mapped to, so OD applications in those states
 *   would have no reviewer at all; or
 *
 *   the page is simply built differently for OD, as the Add Customer form is — 29
 *   fields against Fleet's 38, no Address or Branch step — in which case the reviewer
 *   page object is looking for controls that are not there.
 *
 * So this opens one and reports what it actually has: the reviewer queue's contents,
 * whether the detail page loads, and every control on it.
 *
 *   TOOLS=true ENV=qa npx playwright test --project=tools --grep "probe od review page"
 */

test.use({ storageState: { cookies: [], origins: [] } });

const REFERENCE = process.env.OD_REVIEW_REF ?? '1000514990';

test.describe('Tools — probes @tools', () => {
  test('probe od review page', async ({ loginPage, dashboardPage, page }) => {
    test.setTimeout(300_000);

    await loginPage.navigate();
    await loginPage.login(TSM.username, TSM.password);
    await dashboardPage.assertDashboardLoaded();

    // First: is it in this reviewer's queue at all?
    await page.goto('/Customer/CustomerOnboardingReviewer', { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);

    const queue = await page.evaluate(() => {
      const out: string[] = [];
      for (const row of Array.from(document.querySelectorAll('table tbody tr'))) {
        for (const cell of Array.from(row.querySelectorAll('td'))) {
          const text = (cell.textContent || '').trim();
          if (/^10005\d{5}$/.test(text)) out.push(text);
        }
      }
      return [...new Set(out)];
    });
    console.log(`  reviewer queue holds ${queue.length}: ${queue.join(', ') || 'nothing'}`);
    console.log(`  is ${REFERENCE} in it? ${queue.includes(REFERENCE)}`);

    // Then: open it directly, which is what review() does.
    const response = await page.goto(
      `/Customer/ReviewCustomerDetails?ReferenceNo=${REFERENCE}`,
      { waitUntil: 'domcontentloaded' }
    ).catch(() => null);
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);
    console.log(`\n  detail page: http ${response?.status() ?? 0}, url ${page.url()}`);

    const body = (await page.locator('body').textContent().catch(() => '')) ?? '';
    console.log(`  refused? ${/unauthor|access denied|not permitted/i.test(body)}`);

    const fields = await page.evaluate(() =>
      Array.from(document.querySelectorAll('input,select,textarea'))
        .filter(e => e.id)
        .map(e => {
          const element = e as HTMLInputElement;
          return `${element.tagName.toLowerCase()}#${element.id}` +
            ` type=${element.type}` +
            `${element.offsetParent ? '' : ' (hidden)'}`;
        })
    );
    console.log(`\n  ${fields.length} field(s):`);
    for (const f of fields) console.log(`    ${f}`);

    const controls = await page.evaluate(() =>
      Array.from(document.querySelectorAll('button, a.btn, input[type="submit"]'))
        .map(e => ({
          id: e.id || '(no id)',
          text: (e.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 30),
          visible: !!(e as HTMLElement).offsetParent,
        }))
    );
    console.log(`\n  visible controls:`);
    for (const c of controls.filter(c => c.visible)) console.log(`    ${c.id} "${c.text}"`);
    console.log(`  (${controls.filter(c => !c.visible).length} hidden)`);
  });
});
