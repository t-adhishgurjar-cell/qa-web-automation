import { test } from '../src/fixtures/page.fixtures';
import { DSA, TSM, BDA, ONBOARDING_MAKER } from '../src/config/accounts';

/**
 * Who can do what in the onboarding chain.
 *
 * The credentials workbook describes three hands — a DSA raises the form, a TSM
 * reviews it, a checker approves — while accounts.ts carries an unattributed
 * note saying DSA and TSM can open the wizard but not submit. Both cannot be
 * right, and the difference decides whether an end-to-end chain can exercise
 * four-eyes separation or merely simulate it.
 *
 * So this logs in as each and records, without asserting anything:
 *   - which modules the role's menu offers
 *   - whether /Customer/AddCustomer opens or is refused
 *   - which of the wizard's footer controls actually render
 *   - whether an approval queue is reachable
 *
 * Read-only throughout: it opens pages and reads controls. Nothing is filled
 * and nothing is submitted.
 *
 *   TOOLS=true ENV=qa npx playwright test --project=tools --grep "onboarding chain"
 */

const ROLES = [DSA, TSM, BDA, ONBOARDING_MAKER];

const PROBE_ROUTES = [
  { label: 'Add Customer (the wizard)', route: '/Customer/AddCustomer' },
  { label: 'View Onboarding (the list)', route: '/Customer/CustomerOnboarding' },
  { label: 'Approve Customer (checker)', route: '/Customer/ApproveCustomer' },
];

test.use({ storageState: { cookies: [], origins: [] } });

test.describe('Tools — probes @tools', () => {
  // Distinct accounts, but this application still evicts sessions freely.
  test.describe.configure({ mode: 'serial' });

  for (const account of ROLES) {
    test(`probe onboarding chain — ${account.role}`, async ({ loginPage, dashboardPage, page }) => {
      test.setTimeout(10 * 60_000);

      console.log(`\n########## ${account.role} — ${account.username} ##########`);

      const signedIn = await (async () => {
        try {
          await loginPage.navigate();
          await loginPage.login(account.username, account.password);
          await dashboardPage.assertDashboardLoaded();
          return await dashboardPage.signedInAs();
        } catch (e) {
          console.log(`LOGIN FAILED: ${(e as Error).message.split('\n')[0]}`);
          return '';
        }
      })();

      if (!signedIn) return;
      console.log(`signed in as: ${signedIn}`);

      const menu = await page.evaluate(() => {
        const seen = new Set<string>();
        const out: string[] = [];
        const sidebar = document.querySelector('#sidebarMenu') ?? document.body;
        for (const a of Array.from(sidebar.querySelectorAll('a[href]'))) {
          const href = (a.getAttribute('href') || '').trim();
          const label = (a.textContent || '').replace(/\s+/g, ' ').trim();
          if (!href || !label || href === '#' || href.startsWith('javascript')) continue;
          if (/logout/i.test(href) || seen.has(href)) continue;
          seen.add(href);
          out.push(`${label}  ->  ${href}`);
        }
        return out;
      });
      console.log(`menu: ${menu.length} entries`);
      for (const m of menu) console.log(`  ${m}`);

      for (const probe of PROBE_ROUTES) {
        await page.goto(probe.route, { waitUntil: 'domcontentloaded', timeout: 45_000 })
          .catch(() => undefined);
        await page.waitForTimeout(2_500);

        const seen = await page.evaluate(() => {
          const onScreen = (el: Element) => {
            const r = (el as HTMLElement).getBoundingClientRect();
            return r.width > 0 && r.height > 0;
          };
          const txt = (el: Element | null) => (el?.textContent || '').replace(/\s+/g, ' ').trim();

          const refused = /unauthorized access|do not have permission/i.test(
            document.body.innerText || ''
          );
          const title = txt(
            Array.from(document.querySelectorAll('p.box-head-title, .box-head-title')).find(onScreen) ?? null
          );

          // The footer controls are the whole question: a role that can open
          // the wizard but has no Submit is a reviewer, not a maker.
          const footer = Array.from(document.querySelectorAll('button'))
            .filter(onScreen)
            .map(b => txt(b))
            .filter(t => /submit|save as draft|next|previous|approve|reject|forward|review/i.test(t));

          return {
            refused,
            title,
            footer: [...new Set(footer)],
            fields: Array.from(document.querySelectorAll('input:not([type=hidden]), select, textarea')).filter(onScreen).length,
            rows: document.querySelectorAll('tbody tr').length,
          };
        });

        console.log(
          `  ${probe.label.padEnd(28)} ${seen.refused ? 'REFUSED' : 'open'}  ` +
            `"${seen.title}"  ${seen.fields} fields, ${seen.rows} row(s)`
        );
        if (seen.footer.length) console.log(`      controls: ${seen.footer.join(' | ')}`);
      }
    });
  }
});
