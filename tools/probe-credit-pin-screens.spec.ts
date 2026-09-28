import * as fs from 'fs';
import * as path from 'path';
import { test } from '../src/fixtures/page.fixtures';
import { BRANCH_ADMIN, PARENT_ADMIN } from '../src/config/accounts';

/**
 * Learns the three credit-PIN and product screens before anything is written
 * against them.
 *
 * COVERAGE.md lists four uncovered screens in this family and leaves the route
 * blank for all of them. The workbook fills in exactly one —
 * /Customer/CreditPinChangeLog, named in the Credit PIN Logs pre-conditions —
 * so the other two are still unknown and the menu, not a guess, should say
 * where they are.
 *
 * One of the four is not a Customer Management screen at all. Manage Customer
 * Credit Mapping is reached through Retail Outlet Management and its every case
 * is written for an RO Admin against RO Code 5049NA0100; we hold no RO Admin, so
 * it is left out of this probe rather than being probed as a customer screen.
 *
 * ── Why both admins ───────────────────────────────────────────────────────
 * The Customer Credit PIN Validity cases split by actor: a Customer Admin is
 * expected to see multiple branches, a Branch Admin only its own. That is a
 * difference in what the screen renders, so the probe signs in as each and
 * reports both rather than assuming the parent's view is the whole screen.
 *
 *   TOOLS=true ENV=qa npx playwright test --project=tools --grep "probe credit pin"
 */

test.use({ storageState: { cookies: [], origins: [] } });

/**
 * Established by the menu query on 25 September 2026 against webqa.fleetforc.com,
 * from dbo.MenuMaster — all three hang off ParentMenuId 2, the Customer menu:
 *
 *   MenuId 40  Manage Credit PIN                  Customer/CustomerCreditPinValidity
 *   MenuId 70  Credit Pin Logs                    Customer/CreditPinChangeLog
 *   MenuId 24  Manage Products and Transactions   Vehicle/EnableDisableProdTrans
 *
 * The third is worth reading twice: it sits under the Customer menu but is served
 * by the *Vehicle* controller. Every candidate route guessed before this query
 * assumed /Customer/, so none of them would have found it.
 *
 * Kept as a fallback only. The query below is the authority, and routes are built
 * from Controller and Action rather than written out, so a renamed action shows up
 * as a changed route instead of a 404 against a stale constant.
 */
const CANDIDATE_ROUTES = [
  '/Customer/CustomerCreditPinValidity',
  '/Customer/CreditPinChangeLog',
  '/Vehicle/EnableDisableProdTrans',
];

/** A customer to search on Manage Products & Transactions. */
const CUSTOMER = process.env.PIN_TEST_CUSTOMER ?? PARENT_ADMIN.ownCustomerId;

/** dbo.MenuMaster.ParentMenuId for the Customer menu — all three screens hang off it. */
const CUSTOMER_MENU_ID = 2;

interface MenuRow {
  MenuId: number;
  MenuName: string;
  Controller: string;
  Action: string;
  ParentMenuId: number;
  StatusFlag: boolean;
}

/**
 * Where the findings are written, as well as printed.
 *
 * A probe of three screens prints well over a thousand lines and the IDE's
 * terminal buffer does not hold them — the first run's output for the
 * credit-PIN screen had already scrolled out of reach by the time it was read,
 * which is the one screen it was run for. The file is the copy that survives.
 */
const REPORT = path.join(__dirname, '../scratchpad/probe-credit-pin.txt');

const lines: string[] = [];

/** Prints a finding and keeps it for the report. */
function say(line = ''): void {
  console.log(line);
  lines.push(line);
}

test.describe('Tools — probes @tools', () => {
  /**
   * Written out even when the probe fails part way. A probe that dies on the
   * third screen has still learned the first two, and that is the whole point of
   * running it — the first run's findings for the credit-PIN screen were lost
   * only because they existed nowhere but a terminal buffer.
   */
  test.afterEach(() => {
    fs.mkdirSync(path.dirname(REPORT), { recursive: true });
    fs.writeFileSync(REPORT, lines.join('\n') + '\n', 'utf8');
    console.log(`\n--- findings written to ${REPORT} (${lines.length} lines) ---`);
  });

  test('probe credit pin — find the screens and read their controls', async ({
    loginPage, dashboardPage, page, db,
  }) => {
    test.setTimeout(600_000);

    test.skip(
      !PARENT_ADMIN.password,
      'No Parent Admin password is configured. Set PARENT_ADMIN_PASS (or ' +
        'TEST_PASSWORD) to the password for ' + PARENT_ADMIN.username + '.'
    );

    // ── What the application itself thinks these screens are ────────────────
    const menus = await db.query<MenuRow>(`
      SELECT MenuId, MenuName, Controller, Action, ParentMenuId, StatusFlag
      FROM dbo.MenuMaster
      WHERE MenuName LIKE '%PIN%' OR MenuName LIKE '%Product%'
         OR Action LIKE '%CreditPin%' OR Action LIKE '%Product%'
      ORDER BY MenuName`);
    say(`\n--- menu rows for PIN / product screens (${menus.length}) ---`);
    for (const row of menus) say('  ' + JSON.stringify(row));

    // The screens we are here for: live, and under the Customer menu — which is
    // how Manage Products and Transactions is caught despite its Vehicle
    // controller, and how Manage RO PIN is left out despite matching on name.
    const menuRoutes = menus
      .filter(m => m.StatusFlag && m.ParentMenuId === CUSTOMER_MENU_ID)
      .map(m => `/${m.Controller}/${m.Action}`);
    say(`\n--- routes under the Customer menu (${menuRoutes.length}) ---`);
    for (const route of menuRoutes) say('  ' + route);

    // dbo.Roles names the column RoleName, not Name — probe-customer-menus.spec.ts
    // carried the same mistake and would have failed the same way.
    const mappings = await db.query(`
      SELECT m.MenuName, r.RoleName
      FROM dbo.RoleMenuMappings rmm
      JOIN dbo.MenuMaster m ON m.MenuId = rmm.MenuId
      JOIN dbo.Roles r ON r.Id = rmm.RoleId
      WHERE (m.MenuName LIKE '%PIN%' OR m.MenuName LIKE '%Product%')
        AND rmm.StatusFlag = 1
      ORDER BY m.MenuName, r.RoleName`);
    say(`\n--- which roles are entitled (${mappings.length}) ---`);
    for (const row of mappings) say('  ' + JSON.stringify(row));

    for (const account of [PARENT_ADMIN, BRANCH_ADMIN]) {
      say(`\n\n==================== as ${account.role} (${account.username}, ${account.roleCode}) ====================`);

      await page.context().clearCookies();
      await loginPage.navigate();
      await loginPage.login(account.username, account.password, account.roleCode);
      await dashboardPage.assertDashboardLoaded();

      // Deliberately narrow. Matching /pin|product|transaction/ swept in
      // Transaction Details and Vehicle–Retail Outlet Mapping, which are neither
      // of the three screens this probe is for: the run spent its budget reading
      // them and then died on one of their read-only fields before reaching the
      // credit-PIN screen it was written to find.
      const links = await page.evaluate(() =>
        Array.from(document.querySelectorAll('a[href]'))
          .map(a => ({
            text: (a.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 60),
            href: (a as HTMLAnchorElement).getAttribute('href') || '',
          }))
          .filter(l => /credit\s*pin|products?\s*(and|&)\s*transaction/i.test(l.text) ||
            /CreditPin|ProdTrans/i.test(l.href))
      );
      say('--- navigation links for the credit-PIN / product screens ---');
      if (!links.length) say('  (none — this role is not entitled to any of them)');
      for (const l of links) say(`  "${l.text}" -> ${l.href}`);

      // Menu routes first: they come from the database and are the authority.
      const routes = [...new Set([
        ...menuRoutes,
        ...links.map(l => l.href),
        ...CANDIDATE_ROUTES,
      ])].filter(r => r.startsWith('/'));

      for (const route of routes) {
        const response = await page.goto(route, { waitUntil: 'domcontentloaded' })
          .catch(() => null);
        const status = response?.status() ?? 0;
        const title = (await page.title().catch(() => '')).trim();
        const bounced = /login/i.test(page.url());
        say(`\n${route} -> HTTP ${status} title="${title}"${bounced ? '  (bounced to login)' : ''}`);

        if (status !== 200 || bounced) continue;

        await page.waitForLoadState('networkidle').catch(() => undefined);

        const surface = await page.evaluate(() => {
          const visible = (el: Element): boolean => {
            const style = getComputedStyle(el);
            return style.display !== 'none' && style.visibility !== 'hidden' &&
              !!(el as HTMLElement).getClientRects().length;
          };

          const controls: string[] = [];
          const hidden: string[] = [];
          for (const el of Array.from(document.querySelectorAll('input, select, button, a.btn'))) {
            const node = el as HTMLInputElement;
            // This screen holds live credit PINs in password inputs. Their
            // values are what a branch transacts on, and the probe's report is
            // a file on disk, so report the shape and never the secret.
            const raw = node.type === 'password'
              ? `(${node.value.length}-char secret)`
              : (node.textContent || node.value || '');
            const line = `${node.tagName.toLowerCase()}${node.type ? `[${node.type}]` : ''} ` +
              `id="${node.id || ''}" name="${node.getAttribute('name') || ''}" ` +
              `"${raw.trim().replace(/\s+/g, ' ').slice(0, 40)}"`;
            (visible(el) ? controls : hidden).push(node.id ? line : line + ' (no id)');
          }

          // Every table, with its headers and first rows: these screens are
          // grids, and the column set is what the assertions will be about.
          const tables = Array.from(document.querySelectorAll('table'))
            .filter(visible)
            .map(t => ({
              id: t.id || '(no id)',
              headers: Array.from(t.querySelectorAll('thead th'))
                .map(th => (th.textContent || '').trim().replace(/\s+/g, ' ')),
              rows: Array.from(t.querySelectorAll('tbody tr')).slice(0, 3).map(tr =>
                Array.from(tr.querySelectorAll('td'))
                  .map(td => (td.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 30))
                  .join(' | ')),
            }));

          // Tabs matter on Manage Products & Transactions: the cases speak of a
          // Customer tab and a Vehicle tab holding different fields.
          const tabs = Array.from(document.querySelectorAll('[role=tab], .nav-link, .nav-tabs a'))
            .filter(visible)
            .map(el => (el.textContent || '').trim().replace(/\s+/g, ' '))
            .filter(Boolean);

          const headings = Array.from(document.querySelectorAll('h1, h2, h3, h4, .page-title, .card-title'))
            .filter(visible)
            .map(el => (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 60))
            .filter(Boolean);

          return { controls, hidden, tables, tabs, headings };
        });

        say(`  headings: ${surface.headings.join(' / ') || '(none)'}`);
        if (surface.tabs.length) say(`  tabs    : ${surface.tabs.join(' | ')}`);
        say('  visible controls:');
        for (const c of surface.controls) say(`    ${c}`);
        if (surface.hidden.length) {
          say(`  hidden but present (${surface.hidden.length}):`);
          for (const h of surface.hidden.slice(0, 20)) say(`    ${h}`);
        }
        for (const t of surface.tables) {
          say(`  table id="${t.id}"`);
          say(`    headers: ${t.headers.join(' | ') || '(none)'}`);
          for (const r of t.rows) say(`    row    : ${r}`);
          if (!t.rows.length) say('    row    : (empty grid)');
        }

        // Manage Products & Transactions is driven by a customer search, so an
        // empty grid says nothing about the columns it renders when populated.
        const searchBox = page.locator(
          'input#CustomerId, input#customerId, input#searchInput, input[name*="Customer" i]'
        ).first();
        // Several of these screens prefill the customer from the session and mark
        // the field readonly — #vrmCustomerId is one. fill() then retries for its
        // full timeout and fails the probe, so editability is checked rather than
        // assumed, and a short timeout keeps a surprise cheap.
        const editable = await searchBox.count()
          ? await searchBox.isEditable({ timeout: 2_000 }).catch(() => false)
          : false;
        if (editable) {
          say(`\n  --- searching ${CUSTOMER} ---`);
          await searchBox.fill(CUSTOMER, { timeout: 5_000 }).catch(
            (error: Error) => say(`    could not fill: ${error.message.split('\n')[0]}`));
          const searchButton = page.locator(
            'button#btnSearch, button#search, button:has-text("Search"), input[type=submit][value*="Search" i]'
          ).first();
          if (await searchButton.count()) {
            await searchButton.click().catch(() => undefined);
            await page.waitForLoadState('networkidle').catch(() => undefined);

            const after = await page.evaluate(() => {
              const vis = (el: Element): boolean => {
                const st = getComputedStyle(el);
                return st.display !== 'none' && st.visibility !== 'hidden' &&
                  !!(el as HTMLElement).getClientRects().length;
              };
              const tables = Array.from(document.querySelectorAll('table')).filter(vis).map(t => ({
                id: t.id || '(no id)',
                headers: Array.from(t.querySelectorAll('thead th')).map(th => (th.textContent || '').trim()),
                rows: Array.from(t.querySelectorAll('tbody tr')).slice(0, 5).map(tr =>
                  Array.from(tr.querySelectorAll('td'))
                    .map(td => (td.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 30))
                    .join(' | ')),
              }));
              const messages = Array.from(document.querySelectorAll(
                '.modal, .toast, .alert, .invalid-feedback, .text-danger, [role=alert], .swal2-popup'))
                .filter(vis)
                .map(el => (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 120))
                .filter(Boolean);
              return { tables, messages };
            });

            for (const t of after.tables) {
              say(`    table id="${t.id}" headers: ${t.headers.join(' | ')}`);
              for (const r of t.rows) say(`      row: ${r}`);
            }
            for (const m of after.messages) say(`    message: ${m}`);
          }
        }
      }
    }
  });
});
