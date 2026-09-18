import { test } from '../src/fixtures/page.fixtures';
import { ReviewCustomerPage } from '../src/pages/customer-management/review-customer.page';
import { TSM } from '../src/config/accounts';

/**
 * What happens after "Reviewed" is clicked.
 *
 * The corrected walk now finds #btnApprove and clicks it, and the application
 * stays at 102 with no message. So the click is not the end of the flow. This
 * clicks it and then prints every modal in the document — shown or not, with
 * its classes and its buttons in DOM order — because dismissDialog() picks
 * `button.btn-close, .btn-primary, button:has-text("OK")` with .first(), and on
 * a confirmation dialog the first of those in DOM order is the × that CANCELS.
 *
 *   TOOLS=true ENV=qa PROBE_REFERENCE=... npx playwright test --project=tools --grep "review approve"
 */

const REFERENCE = process.env.PROBE_REFERENCE ?? '1000514858';

test.use({ storageState: { cookies: [], origins: [] } });

test.describe('Tools — probes @tools', () => {
  test('probe review approve', async ({ loginPage, dashboardPage, page }) => {
    test.setTimeout(8 * 60_000);
    test.skip(!TSM.password, 'Set TSM_PASS');

    page.on('dialog', d => {
      console.log(`NATIVE DIALOG: ${d.type()} "${d.message()}"`);
      d.accept().catch(() => undefined);
    });
    page.on('console', m => {
      if (m.type() === 'error') console.log(`  page console error: ${m.text().slice(0, 200)}`);
    });
    // Every failure, not only the interesting-looking URLs. A 404 on the script
    // that binds #btnApprove would leave the control inert with no modal and no
    // request — exactly what was measured.
    page.on('response', r => {
      if (r.status() >= 400) console.log(`  HTTP ${r.status()} ${r.url()}`);
      else if (/\/Customer\/(Review|Approve)/i.test(r.url())) console.log(`  OK ${r.status()} ${r.url()}`);
    });
    page.on('requestfailed', r => console.log(`  REQ FAILED ${r.url()} — ${r.failure()?.errorText}`));
    page.on('pageerror', e => console.log(`  PAGE ERROR: ${String(e).slice(0, 300)}`));

    await loginPage.navigate();
    await loginPage.login(TSM.username, TSM.password);
    await dashboardPage.assertDashboardLoaded();

    const review = new ReviewCustomerPage(page);
    await review.open(REFERENCE);

    // Walk to the last tab exactly as review() does, but stop before finishing.
    for (let i = 0; i < 6; i += 1) {
      await review.acknowledgeDocuments();
      const next = page
        .locator('button:visible:has-text("Next"), a:visible:has-text("Next")')
        .filter({ hasNotText: /previous/i })
        .first();
      if (!(await next.isVisible().catch(() => false))) break;
      await next.click({ timeout: 10_000 }).catch(() => undefined);
      await page.waitForTimeout(2_000);
    }

    const modals = async (when: string) => {
      const found = await page.evaluate(() =>
        Array.from(document.querySelectorAll('.modal, [role=dialog]')).map(el => {
          const e = el as HTMLElement;
          const r = e.getBoundingClientRect();
          return {
            id: e.id || '(no id)',
            cls: (e.className || '').toString().replace(/\s+/g, ' ').trim(),
            shown: e.classList.contains('show'),
            size: `${Math.round(r.width)}x${Math.round(r.height)}`,
            text: (e.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 200),
            // DOM order matters: this is what .first() would pick.
            buttons: Array.from(e.querySelectorAll('button, a.btn')).map(
              b =>
                `<${b.tagName.toLowerCase()}>${(b as HTMLElement).id || '-'}` +
                `.${((b as HTMLElement).className || '').toString().split(/\s+/).join('.')}` +
                `:"${(b.textContent || '').replace(/\s+/g, ' ').trim()}"`
            ),
          };
        })
      );
      console.log(`\n=== modals ${when} ===`);
      for (const m of found.filter(x => x.shown || x.size !== '0x0')) {
        console.log(`  VISIBLE id=${m.id} cls=${m.cls}\n    text: "${m.text}"`);
        for (const b of m.buttons) console.log(`      ${b}`);
      }
      console.log(`  (${found.length} modal element(s) in the DOM, ${found.filter(x => x.shown).length} shown)`);
    };

    await modals('before clicking Reviewed');

    const signature = () =>
      page.evaluate(() =>
        Array.from(document.querySelectorAll('body *'))
          .filter(el => {
            const r = (el as HTMLElement).getBoundingClientRect();
            return r.width > 0 && r.height > 0 && getComputedStyle(el as HTMLElement).visibility !== 'hidden';
          })
          .map(el => {
            const e = el as HTMLElement;
            return `${e.tagName.toLowerCase()}#${e.id || '-'}.${(e.className || '').toString().trim().replace(/\s+/g, '.')}`;
          })
      );
    const beforeSig = new Set(await signature());

    // What the anchor actually is, and whether anything is listening.
    console.log(JSON.stringify(await page.evaluate(() => {
      const a = document.querySelector('#btnApprove') as HTMLAnchorElement | null;
      if (!a) return { found: false };
      const pane = a.closest('.tab-pane');
      return {
        found: true,
        outerHTML: a.outerHTML.slice(0, 400),
        href: a.getAttribute('href'),
        onclick: a.getAttribute('onclick'),
        pane: pane ? `${pane.id || '?'}${pane.classList.contains('active') ? ' [ACTIVE]' : ''}` : '(none)',
        visible: a.getBoundingClientRect().width > 0,
      };
    }), null, 1));

    await page.locator('#btnApprove').click({ timeout: 10_000 }).catch(e => console.log(`click failed: ${e}`));
    await page.waitForTimeout(3_000);
    const appeared = [...new Set((await signature()).filter(sig => !beforeSig.has(sig)))];
    await modals('after clicking Reviewed');

    // Whatever appeared, of any markup. A custom confirmation container matches
    // neither .modal nor [role=dialog], so scanning for those alone cannot tell
    // "nothing happened" from "something happened that I did not query".
    console.log('\n=== what became visible after the click ===');
    for (const line of appeared) console.log(`  ${line}`);
  });
});
