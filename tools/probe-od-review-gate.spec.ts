import { test } from '../src/fixtures/page.fixtures';
import { TSM } from '../src/config/accounts';

/**
 * What gates the "Reviewed" button on an OD review.
 *
 * With both document acknowledgements ticked and remarks filled, clicking #btnApprove
 * sends no request, opens no dialog and changes no status. The button is inert, which on
 * this application means a client-side precondition that fails silently — the checker
 * screen has exactly the same trap, where Approve does nothing until two Verify buttons
 * read "Verified", and nothing on screen says so.
 *
 * So read the page's own script rather than guessing at the precondition: find the
 * handler bound to btnApprove and the conditions it tests.
 *
 *   TOOLS=true ENV=qa npx playwright test --project=tools --grep "probe od review gate"
 */

test.use({ storageState: { cookies: [], origins: [] } });

const REFERENCE = process.env.OD_REVIEW_REF ?? '1000514990';

test.describe('Tools — probes @tools', () => {
  test('probe od review gate', async ({ loginPage, dashboardPage, page }) => {
    test.setTimeout(300_000);

    await loginPage.navigate();
    await loginPage.login(TSM.username, TSM.password);
    await dashboardPage.assertDashboardLoaded();

    await page.goto(`/Customer/ReviewCustomerDetails?ReferenceNo=${REFERENCE}`,
      { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);

    // The button first: on this application the review control is an anchor driven by
    // a delegated handler reading data-action, so its attributes are the contract.
    const button = await page.evaluate(() => {
      const element = document.querySelector('#btnApprove');
      if (!element) return null;
      return {
        outerHTML: element.outerHTML.slice(0, 400),
        attributes: Array.from(element.attributes).map(a => `${a.name}="${a.value}"`),
        tag: element.tagName,
        disabled: (element as HTMLButtonElement).disabled,
        classes: element.className,
      };
    });
    console.log(`  #btnApprove: ${JSON.stringify(button, null, 2)}`);

    const scripts = await page.evaluate(() =>
      Array.from(document.querySelectorAll('script[src]')).map(s => (s as HTMLScriptElement).src));
    console.log(`\n  all ${scripts.length} external script(s):`);
    for (const src of scripts) console.log(`    ${src.split('?')[0]}`);

    // The handler is delegated and keyed on data-action, not on the button's id, so
    // "ApproveCustomer" is what to search for.
    for (const src of scripts) {
      const body = await page.request.get(src).then(r => r.text()).catch(() => '');
      if (!/ApproveCustomer/.test(body)) continue;
      console.log(`\n--- ${src.split('/').pop()?.split('?')[0]} around ApproveCustomer ---`);
      const lines = body.split('\n');
      lines.forEach((line, i) => {
        if (/ApproveCustomer/.test(line)) {
          console.log(lines.slice(Math.max(0, i - 5), i + 40).map(l => `    ${l.trim().slice(0, 160)}`).join('\n'));
        }
      });
    }
  });
});
