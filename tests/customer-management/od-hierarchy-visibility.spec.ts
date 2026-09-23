import { expect } from '@playwright/test';
import { test } from '../../src/fixtures/page.fixtures';
import { epic, feature, story, severity, description, owner } from 'allure-js-commons';

/**
 * Is an OD application scoped to the officer hierarchy the way other types are?
 *
 * Officer scope in FleetPlus is a prefix of region -> state -> division, held in
 * dbo.UserLocationMapping:
 *
 *   REGION_ADMIN     RegionId only
 *   STATE_ADMIN      RegionId + BusinessStateId
 *   DIVISION_ADMIN   all three
 *   TERRITORY_ADMIN  all three
 *
 * The screen is "View Onboarding" (/Customer/CustomerOnboardingStatus), which the
 * menu tables map to these roles — not the Add Customer list, which is the maker's
 * own and shows an admin nothing at all.
 *
 * The change request removes the DIVISION level for OD, and only that level. So an
 * OD customer carries no division — CustomerDivisionId is 0 by design — and a
 * division admin should still see the OD customers in their own state. Region and
 * state were never part of the ask.
 *
 * That makes this a test of how far the removal went. Each officer's list is
 * resolved against the database and split in two: the OD applications they can see,
 * judged by region and state only, and the non-OD applications they can see, judged
 * by all three levels. The second group is the control — it establishes that the
 * screen is scoped at all, so an OD result means something. If OD rows appear from
 * other regions and states, the removal took the whole hierarchy rather than the
 * division level the client asked for.
 *
 * Read-only: signs in, reads a list, and queries the database.
 */

test.use({ storageState: { cookies: [], origins: [] } });

const VIEW_ONBOARDING = '/Customer/CustomerOnboardingStatus';

const OFFICERS = [
  {
    level: 'Territory admin (Gurgaon)',
    username: process.env.OD_TERRITORY_ADMIN ?? '9612200200',
    password: process.env.TSM_PASS ?? 'Thinkpad@1',
  },
  {
    level: 'Division admin (Ahmedabad I)',
    username: process.env.OD_DIVISION_ADMIN ?? '9073139002',
    password: process.env.OD_OFFICER_PASSWORD ?? 'Nayara@1',
  },
] as const;

interface Scope { RegionId: number | null; BusinessStateId: number | null; DivisionId: number | null }
interface Application {
  ReferenceNo: number; Status: number; CustomerStateId: number;
  CustomerDivisionId: number; RegionId: number | null; CustomerTypeName: string;
}

/**
 * Within an officer's reach.
 *
 * Two rules, because the change request removes one level of the hierarchy and not
 * the others. "No mapping restrictions ... remove division hierarchy from OD" means
 * an OD customer has no division — it is stored as 0 deliberately — so a division
 * admin must NOT be excluded from an OD customer in their own state merely because
 * they hold a division and the customer holds none. Region and state were not part
 * of the ask and still apply.
 *
 * For every other customer type all three levels apply, unchanged. That pair is
 * what the tests below compare: OD judged by region and state, other types judged by
 * region, state and division.
 */
function inScope(application: Application, scope: Scope): boolean {
  if (scope.RegionId && application.RegionId !== scope.RegionId) return false;
  if (scope.BusinessStateId && application.CustomerStateId !== scope.BusinessStateId) return false;
  const divisionApplies = application.CustomerTypeName !== 'OD';
  if (divisionApplies && scope.DivisionId && application.CustomerDivisionId !== scope.DivisionId) {
    return false;
  }
  return true;
}

test.describe('OD hierarchy visibility @customer-management @regression', () => {
  for (const officer of OFFICERS) {
    test(`${officer.level} sees only OD applications inside their hierarchy`, async ({
      loginPage, dashboardPage, page, db,
    }) => {
      test.setTimeout(300_000);
      await epic('Customer Management');
      await feature('OD enrolment');
      await owner('QA Team');
      await story('Officer hierarchy');
      await severity('blocker');
      await description(
        'Reads View Onboarding as this officer and resolves every row against the ' +
          'database. OD rows are checked against region and state only, since the ' +
          'change request removes the division level for OD deliberately. Non-OD rows ' +
          'are checked against all three levels and are the control: they establish ' +
          'that the screen is scoped at all.'
      );

      const scopes = await db.query<Scope>(`
        SELECT m.RegionId, m.BusinessStateId, m.DivisionId
        FROM dbo.Users u JOIN dbo.UserLocationMapping m ON m.UserId = u.Id
        WHERE u.UserName = '${officer.username}'`);
      expect(scopes, `${officer.username} has no location mapping`).not.toHaveLength(0);
      const scope = scopes[0];
      console.log(`${officer.level} (${officer.username}) scope: ${JSON.stringify(scope)}`);

      await loginPage.navigate();
      await loginPage.login(officer.username, officer.password);
      await dashboardPage.assertDashboardLoaded();

      await page.goto(VIEW_ONBOARDING, { waitUntil: 'domcontentloaded' });
      await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);

      // Cell by cell. The grid renders cells with no separator, so a row reads
      // "11000514939OD..." — the serial number runs into the reference — and any
      // match anchored on a word boundary finds nothing at all.
      const readPage = async (): Promise<string[]> =>
        page.evaluate(() => {
          const out: string[] = [];
          for (const row of Array.from(document.querySelectorAll('table tbody tr'))) {
            for (const cell of Array.from(row.querySelectorAll('td'))) {
              const text = (cell.textContent || '').trim();
              if (/^10005\d{5}$/.test(text)) out.push(text);
            }
          }
          return out;
        });

      // Read across pages, not just the first.
      //
      // The grid shows ten rows newest first, and this suite raises OD applications —
      // so on a busy day page one is entirely OD and the non-OD control below has
      // nothing in it. A control that passes on an empty set is worse than one that
      // fails: it makes the OD conclusion look supported when nothing was compared
      // against it. Bounded at ten pages, and stops as soon as a page adds nothing
      // new, so a pagination control that silently does not advance ends the loop
      // instead of spinning.
      const seen = new Set<string>();
      const next = page.locator('a.page-link, .paginate_button').filter({ hasText: /^›$|^next$/i }).first();

      for (let pageNumber = 1; pageNumber <= 10; pageNumber++) {
        const before = seen.size;
        for (const reference of await readPage()) seen.add(reference);
        if (seen.size === before && pageNumber > 1) break;
        if (!(await next.isVisible().catch(() => false))) break;
        const enabled = await next.evaluate(element =>
          !element.classList.contains('disabled') &&
          !element.parentElement?.classList.contains('disabled')).catch(() => false);
        if (!enabled) break;
        await next.click().catch(() => undefined);
        await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);
      }
      const references = [...seen];
      console.log(`  read ${references.length} reference(s) across the grid's pages`);
      expect(
        references.length,
        `View Onboarding listed nothing for ${officer.level}, so there is nothing to ` +
          `judge. Either the screen is empty for this role or the grid had not drawn.`
      ).toBeGreaterThan(0);

      const applications = await db.query<Application>(`
        SELECT DISTINCT r.ReferenceNo, r.Status, r.CustomerStateId, r.CustomerDivisionId,
               s.RegionId, t.CustomerTypeName
        FROM dbo.RawCustomerMaster r
        LEFT JOIN dbo.BusinessStateMaster s ON s.BusinessStateId = r.CustomerStateId
        LEFT JOIN dbo.CustomerTypeMaster t ON t.Id = r.CustomerType
        WHERE r.ReferenceNo IN (${references.map(Number).join(',')})`);

      const od = applications.filter(a => a.CustomerTypeName === 'OD');
      const other = applications.filter(a => a.CustomerTypeName !== 'OD');

      const odOutside = od.filter(a => !inScope(a, scope));
      const otherOutside = other.filter(a => !inScope(a, scope));

      console.log(`  ${applications.length} application(s): ${od.length} OD, ${other.length} other`);
      console.log(`  outside this officer's scope — OD: ${odOutside.length}, other: ${otherOutside.length}`);
      for (const a of odOutside) console.log(`    leaked OD ${a.ReferenceNo}: ${JSON.stringify(a)}`);

      // The control has to exist before it can control anything.
      expect(
        other.length,
        `Not one non-OD application is on screen for ${officer.level}, so there is ` +
          `nothing to establish that this screen scopes anybody. Without that, an OD ` +
          `row from another state proves only that the row is there — not that it ` +
          `should have been filtered. Widen the grid's page length or the date range ` +
          `until at least one non-OD application is listed, then read the result.`
      ).toBeGreaterThan(0);

      // Then the control itself: if the non-OD rows are also out of scope, the screen
      // is simply unscoped and the OD result below carries no information.
      expect(
        otherOutside,
        `Non-OD applications are also outside this officer's scope ` +
          `(${otherOutside.map(a => a.ReferenceNo).join(', ')}), so View Onboarding ` +
          `appears not to be scoped for anyone. That is a wider defect than OD, and ` +
          `it makes the OD comparison meaningless — fix or explain this first.`
      ).toEqual([]);

      expect(
        odOutside.map(a =>
          `${a.ReferenceNo} (region ${a.RegionId}, state ${a.CustomerStateId}, ` +
          `division ${a.CustomerDivisionId})`),
        `${officer.level} is scoped to ${JSON.stringify(scope)}. These OD ` +
          `applications are outside that officer's REGION or STATE — the division is ` +
          `not being counted against them, which is correct and is what the change ` +
          `asked for. The change asked to remove the division level from OD, not the ` +
          `region and state above it, and every non-OD application on this same ` +
          `screen still respects all three. So the removal went further than the ` +
          `request: an OD customer is now visible to officers with no claim to its ` +
          `region or state at all.`
      ).toEqual([]);
    });
  }
});
