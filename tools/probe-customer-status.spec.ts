import { test } from '../src/fixtures/page.fixtures';
import { FP_ADMIN } from '../src/config/accounts';

/**
 * Learns the Manage Customer Status screen before anything is written against it.
 *
 * The route was never confirmed — the coverage note leaves it blank — and this
 * application has a habit of keeping controls in the DOM while hiding them, so
 * guessing at selectors has cost several rounds already on other screens. This
 * finds the page from the navigation rather than assuming a URL, then reports
 * every control it actually renders.
 *
 *   TOOLS=true ENV=qa npx playwright test --project=tools --grep "probe customer status"
 */

test.use({ storageState: { cookies: [], origins: [] } });

/** An approved, Active customer — the Deactivate path. */
const ACTIVE_CUSTOMER = process.env.MCS_ACTIVE_CUSTOMER ?? 'NAYAFP3013400036';

/** A customer already switched off — the Activate path. */
const INACTIVE_CUSTOMER = process.env.MCS_INACTIVE_CUSTOMER ?? 'NAYAFP2107000197';

const CANDIDATE_ROUTES = [
  '/Customer/ManageCustomerStatus',
  '/Customer/CustomerStatus',
  '/Customer/ActivateDeactivateCustomer',
  '/Customer/ManageCustomer',
];

test.describe('Tools — probes @tools', () => {
  test('probe customer status — find the screen and read its controls', async ({
    loginPage, dashboardPage, page,
  }) => {
    test.setTimeout(300_000);

    await loginPage.navigate();
    await loginPage.login(FP_ADMIN.username, FP_ADMIN.password);
    await dashboardPage.assertDashboardLoaded();

    // The menu is the authority on where this lives; the candidate list below is
    // only a fallback for when the entitlement hides the link.
    const links = await page.evaluate(() =>
      Array.from(document.querySelectorAll('a[href]'))
        .map(a => ({
          text: (a.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 50),
          href: (a as HTMLAnchorElement).getAttribute('href') || '',
        }))
        .filter(l => /status|activate|deactivate/i.test(l.text) || /Status/i.test(l.href))
    );
    console.log('--- navigation links mentioning status/activate ---');
    for (const l of links) console.log(`  "${l.text}" -> ${l.href}`);

    const fromMenu = links.find(l => /manage customer status/i.test(l.text))?.href;
    const routes = fromMenu ? [fromMenu, ...CANDIDATE_ROUTES] : CANDIDATE_ROUTES;

    for (const route of routes) {
      const response = await page.goto(route, { waitUntil: 'domcontentloaded' })
        .catch(() => null);
      const status = response?.status() ?? 0;
      const title = (await page.title().catch(() => '')).trim();
      const onLogin = /login/i.test(page.url());
      console.log(`\n${route} -> HTTP ${status} title="${title}"${onLogin ? '  (bounced to login)' : ''}`);

      if (status !== 200 || onLogin) continue;

      await page.waitForTimeout(2000);

      const controls = await page.evaluate(() => {
        const visible = (el: Element): boolean => {
          const style = getComputedStyle(el);
          return style.display !== 'none' && style.visibility !== 'hidden' &&
            !!(el as HTMLElement).getClientRects().length;
        };
        const out: { kind: string; id: string; name: string; type: string; text: string; visible: boolean }[] = [];
        for (const el of Array.from(document.querySelectorAll('input, select, button, a.btn, table'))) {
          const node = el as HTMLInputElement;
          out.push({
            kind: node.tagName.toLowerCase(),
            id: node.id || '',
            name: node.getAttribute('name') || '',
            type: node.getAttribute('type') || '',
            text: (node.textContent || node.value || '').trim().replace(/\s+/g, ' ').slice(0, 40),
            visible: visible(el),
          });
        }
        return out;
      });

      console.log('  visible controls:');
      for (const c of controls.filter(c => c.visible)) {
        console.log(`    ${c.kind}${c.type ? `[${c.type}]` : ''} id="${c.id}" name="${c.name}" "${c.text}"`);
      }
      const hidden = controls.filter(c => !c.visible && c.id);
      if (hidden.length) {
        console.log(`  hidden but present (${hidden.length}): ${hidden.map(c => c.id).slice(0, 15).join(', ')}`);
      }

      // Search a real customer: the results block and the single-action button
      // are hidden until one is found, so their wording and behaviour cannot be
      // read from the empty page.
      for (const customerId of [ACTIVE_CUSTOMER, INACTIVE_CUSTOMER, '', 'NAYAFP0000000000']) {
        console.log(`\n  --- searching ${customerId} ---`);
        await page.fill('#searchInput', customerId);
        await page.click('#btnSearch');
        await page.waitForTimeout(3500);

        const after = await page.evaluate(() => {
          const vis = (el: Element): boolean => {
            const st = getComputedStyle(el);
            return st.display !== 'none' && st.visibility !== 'hidden' &&
              !!(el as HTMLElement).getClientRects().length;
          };
          const action = document.getElementById('btnSingleAction');
          const table = document.getElementById('mcsResultsTbl');
          const rows = table
            ? Array.from(table.querySelectorAll('tbody tr')).slice(0, 3).map(tr =>
                Array.from(tr.querySelectorAll('td'))
                  .map(td => (td.textContent || '').trim().replace(/\s+/g, ' '))
                  .join(' | '))
            : [];
          const headers = table
            ? Array.from(table.querySelectorAll('thead th')).map(th => (th.textContent || '').trim())
            : [];
          // Cast wide: the earlier selector found nothing for a blank search and
          // it is not yet known whether the app says nothing or says it somewhere
          // unexpected. Anything visible carrying text is reported.
          const messages = Array.from(document.querySelectorAll(
            '.modal, .toast, .alert, .invalid-feedback, .text-danger, .field-validation-error, ' +
            '[role=alert], .swal2-popup, .error, small, label.error, span[id$=_error]'))
            .filter(vis)
            .map(el => `${el.className || el.tagName}: ${(el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 100)}`)
            .filter(t => t.split(': ')[1]);
          const inputState = (() => {
            const i = document.getElementById('searchInput') as HTMLInputElement | null;
            return i ? { cls: i.className, validity: i.validationMessage, aria: i.getAttribute('aria-invalid') } : null;
          })();
          console.log('inputState', JSON.stringify(inputState));
          return {
            actionVisible: action ? vis(action) : false,
            actionText: action ? (action.textContent || '').trim() : '(absent)',
            tableVisible: table ? vis(table) : false,
            headers, rows, messages,
          };
        });

        console.log(`    searched      : ${JSON.stringify(customerId)}`);
        console.log(`    single action : visible=${after.actionVisible} text="${after.actionText}"`);
        console.log(`    results table : visible=${after.tableVisible}`);
        if (after.headers.length) console.log(`    headers       : ${after.headers.join(' | ')}`);
        for (const r of after.rows) console.log(`    row           : ${r}`);
        for (const m of after.messages) console.log(`    dialog        : ${m}`);
      }
      break;
    }
  });
});
