import { test } from '@playwright/test';
import { LoginPage } from '../src/pages/login.page';
import { DashboardPage } from '../src/pages/dashboard.page';

/**
 * BASELINE for the "no mapping restrictions" change request.
 *
 * The CR removes mapping restrictions for two activities only — vehicle
 * approval, and bulk mapping/de-mapping — and for registered vehicles. It
 * explicitly does NOT apply to the rest of Fleet Plus, which makes the
 * before-picture the important artefact: without it there is no way to tell
 * "the restriction was lifted" from "the restriction was lifted everywhere",
 * and the second is a regression dressed up as the feature.
 *
 * So this records, per officer, exactly what each scope can see today.
 *
 * The six officers were created for this: two geographies, three levels each,
 * so a restriction shows up as Ahmedabad and Kolkata seeing different rows, and
 * its removal shows up as them seeing the same rows.
 *
 *   TOOLS=true ENV=qa npx playwright test --project=tools --grep "mapping scope"
 *
 * Read-only: it opens screens and counts what is listed. It approves nothing.
 */

const OFFICERS = [
  { mobile: '9072986100', label: 'Ahmedabad  Region Admin (West)' },
  { mobile: '9073068501', label: 'Ahmedabad  State Admin (GJ_I)' },
  { mobile: '9073139002', label: 'Ahmedabad  Division Admin (Ahd I)' },
  { mobile: '9073209903', label: 'Kolkata    Region Admin (East)' },
  { mobile: '9073275904', label: 'Kolkata    State Admin (WB_NE)' },
  { mobile: '9073340105', label: 'Kolkata    Division Admin' },
];

const PASSWORD = process.env.OFFICER_PASSWORD ?? 'Nayara@1';

/** The screens the CR names, plus the menu, so scope is read not assumed. */
const SCREENS = [
  // /Vehicle/VehicleApproval is the officers' approval screen, read off their own
  // menus. ManagePendingVehicle is the parent-admin equivalent and refuses an
  // officer outright — probing that one measured the wrong restriction entirely.
  { key: 'vehicle approval', route: '/Vehicle/VehicleApproval' },
  { key: 'generic veh req approval', route: '/Vehicle/GenericVehicleReqApproval' },
  { key: 'de-map vehicle', route: '/Vehicle/DeMapVehicle' },
];

test.use({ storageState: { cookies: [], origins: [] } });

test.describe('Tools — probes @tools', () => {
  for (const officer of OFFICERS) {
    test(`mapping scope — ${officer.label.trim()}`, async ({ page }) => {
      test.setTimeout(6 * 60_000);

      const loginPage = new LoginPage(page);
      const dashboardPage = new DashboardPage(page);

      await loginPage.navigate();
      await loginPage.login(officer.mobile, PASSWORD);
      await dashboardPage.assertDashboardLoaded();

      console.log(`\n${'#'.repeat(96)}\n# ${officer.label}  (${officer.mobile})\n${'#'.repeat(96)}`);

      // What this officer is even offered — the menu is the first restriction.
      const menu = await page.evaluate(() =>
        Array.from(document.querySelectorAll('a[href]'))
          .map(a => (a as HTMLAnchorElement).getAttribute('href') || '')
          .filter(h => h.startsWith('/') && h.length > 1)
          .filter((h, i, all) => all.indexOf(h) === i)
          .sort()
      );
      console.log(`  full menu (${menu.length}):`);
      for (const h of menu) console.log(`    ${h}`);
      const bulk = menu.filter(h => /bulk|mapping|demap|de-map/i.test(h));
      console.log(`  BULK / MAPPING entries: ${bulk.join(', ') || '(none)'}`);

      for (const screen of SCREENS) {
        await page.goto(screen.route, { waitUntil: 'domcontentloaded', timeout: 45_000 })
          .catch(() => undefined);
        await page.waitForTimeout(3_000);

        const seen = await page.evaluate(() => {
          const onScreen = (el: Element) => {
            const r = (el as HTMLElement).getBoundingClientRect();
            return r.width > 0 && r.height > 0;
          };
          const body = document.body.innerText || '';
          const rows = Array.from(document.querySelectorAll('tbody tr')).filter(onScreen);
          return {
            refused: /unauthorized access|do not have permission/i.test(body),
            notFound: /HTTP Error 404|Not Found/i.test(body),
            rowCount: rows.length,
            // The first cells of each row identify which customers/vehicles are
            // in scope — that is the whole question this probe exists to answer.
            sample: rows.slice(0, 40).map(r =>
              Array.from(r.querySelectorAll('td'))
                .slice(0, 5)
                .map(td => (td.textContent || '').replace(/\s+/g, ' ').trim())
                .join(' | ')
            ),
            filters: Array.from(document.querySelectorAll('select, input:not([type=hidden])'))
              .filter(onScreen)
              .map(f => (f as HTMLInputElement).id || (f as HTMLInputElement).name)
              .filter(Boolean),
          };
        });

        const verdict = seen.refused ? 'REFUSED' : seen.notFound ? '404' : `${seen.rowCount} row(s)`;
        console.log(`\n  ${screen.key.padEnd(26)} ${screen.route}  ->  ${verdict}`);
        if (seen.filters.length) console.log(`    filters: ${seen.filters.join(', ')}`);
        for (const s of seen.sample) console.log(`    row: ${s}`);
      }
    });
  }
});
