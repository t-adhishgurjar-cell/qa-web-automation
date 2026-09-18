import { test } from '@playwright/test';
import { LoginPage } from '../src/pages/login.page';
import { DashboardPage } from '../src/pages/dashboard.page';

/**
 * Did the "no mapping restrictions" change leak past its two activities?
 *
 * The CR is explicitly narrow: vehicle approval, and bulk mapping/de-mapping,
 * for registered vehicles — "not to all activities within Fleet Plus". The old
 * rule was that a Vahan-failed vehicle is mapped to the CUSTOMER's division
 * regardless of who added it, and only admins of that division could approve.
 *
 * Removing that in one place is the feature. Removing it everywhere is a
 * regression that looks exactly like the feature, and nothing in the existing
 * suite would catch it: each screen's tests pass on their own terms.
 *
 * So this asks one question of every vehicle screen an officer can reach:
 * do two officers in DISJOINT geographies (Gujarat vs West Bengal) see the same
 * data? Identical results on an in-scope screen is the change working.
 * Identical results on an out-of-scope screen is the leak.
 *
 *   TOOLS=true ENV=qa npx playwright test --project=tools --grep "scope leak"
 *
 * Read-only. It searches and counts; it approves, maps and de-maps nothing.
 */

const AHMEDABAD = { mobile: '9073068501', label: 'Ahmedabad State Admin (GJ_I)' };
const KOLKATA = { mobile: '9073275904', label: 'Kolkata State Admin (WB_NE)' };
const PASSWORD = process.env.OFFICER_PASSWORD ?? 'Nayara@1';

/** in-scope per the CR, so identical output is expected and correct. */
const IN_SCOPE = ['/Vehicle/VehicleApproval'];

const SCREENS = [
  '/Vehicle/VehicleApproval',
  '/Vehicle/AddVehicles',
  '/Vehicle/DeMapVehicle',
  '/Vehicle/VehicleBlockUnblock',
  '/Vehicle/VehicleLifecycle',
];

/** A fingerprint of what the screen shows, comparable between two officers. */
async function fingerprint(page: import('@playwright/test').Page, route: string) {
  await page.goto(route, { waitUntil: 'domcontentloaded', timeout: 45_000 }).catch(() => undefined);
  await page.waitForTimeout(3_000);

  return page.evaluate(() => {
    const onScreen = (el: Element) => {
      const r = (el as HTMLElement).getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    const body = document.body.innerText || '';
    const rows = Array.from(document.querySelectorAll('tbody tr')).filter(onScreen);
    return {
      refused: /unauthorized access|do not have permission/i.test(body),
      rowCount: rows.length,
      rows: rows.map(r =>
        Array.from(r.querySelectorAll('td'))
          .slice(0, 4)
          .map(td => (td.textContent || '').replace(/\s+/g, ' ').trim())
          .join('|')
      ),
      // A scoped screen usually pins scope with a readonly/absent selector; an
      // unscoped one offers a chooser. Recording it separates "sees everything"
      // from "can ask for everything".
      selectors: Array.from(document.querySelectorAll('select'))
        .filter(onScreen)
        .map(s => {
          const e = s as HTMLSelectElement;
          return `${e.id || e.name}[${e.options.length} opts]${e.disabled ? ' DISABLED' : ''}`;
        }),
    };
  });
}

test.use({ storageState: { cookies: [], origins: [] } });

test.describe('Tools — probes @tools', () => {
  test('scope leak', async ({ page }) => {
    test.setTimeout(10 * 60_000);

    const captured: Record<string, Record<string, Awaited<ReturnType<typeof fingerprint>>>> = {};

    for (const officer of [AHMEDABAD, KOLKATA]) {
      const loginPage = new LoginPage(page);
      const dashboardPage = new DashboardPage(page);
      await page.context().clearCookies();
      await loginPage.navigate();
      await loginPage.login(officer.mobile, PASSWORD);
      await dashboardPage.assertDashboardLoaded();

      captured[officer.label] = {};
      for (const route of SCREENS) {
        captured[officer.label][route] = await fingerprint(page, route);
      }
    }

    console.log(`\n${'='.repeat(104)}`);
    console.log(
      `${'screen'.padEnd(34)}${'in CR scope'.padEnd(13)}${'Ahmedabad'.padEnd(16)}${'Kolkata'.padEnd(16)}verdict`
    );
    console.log('='.repeat(104));

    for (const route of SCREENS) {
      const a = captured[AHMEDABAD.label][route];
      const k = captured[KOLKATA.label][route];
      const inScope = IN_SCOPE.includes(route);

      const describe = (f: typeof a) => (f.refused ? 'REFUSED' : `${f.rowCount} row(s)`);
      const same = JSON.stringify(a.rows) === JSON.stringify(k.rows) && a.refused === k.refused;

      let verdict: string;
      if (a.refused && k.refused) verdict = 'both refused — no signal';
      else if (a.rowCount === 0 && k.rowCount === 0) verdict = 'no data — inconclusive';
      else if (same && inScope) verdict = 'SAME — the change, as intended';
      else if (same && !inScope) verdict = '*** SAME BUT OUT OF SCOPE — possible leak ***';
      else verdict = 'different — still scoped';

      console.log(
        `${route.padEnd(34)}${(inScope ? 'yes' : 'no').padEnd(13)}${describe(a).padEnd(16)}${describe(k).padEnd(16)}${verdict}`
      );
      // Print the rows themselves. A "1 row" that is really "No records found."
      // reads as data in a count and is not — that mistake has already turned an
      // empty state into a reported defect once in this codebase.
      for (const [who, f] of [['A', a], ['K', k]] as const) {
        for (const r of f.rows.slice(0, 4)) console.log(`${''.padEnd(34)}${who} row: ${r}`);
      }
      if (a.selectors.length || k.selectors.length) {
        console.log(`${''.padEnd(34)}selectors  A: ${a.selectors.join(', ') || '-'}`);
        console.log(`${''.padEnd(34)}           K: ${k.selectors.join(', ') || '-'}`);
      }
    }
    console.log('='.repeat(104));
  });
});
