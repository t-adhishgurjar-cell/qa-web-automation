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
 * The test is built around a control rather than an expectation. Each officer's
 * list is resolved against the database and split in two: the Fleet applications
 * they can see, and the OD applications they can see. If both are inside their
 * scope, the screen is scoped and there is nothing to report. If the Fleet rows
 * are inside it and the OD rows are not, then scoping works and OD is escaping it
 * — which no assertion about OD alone could establish, because a screen that
 * scopes nothing at all would look identical from the OD side.
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

/** Within an officer's reach: every level they are mapped to must agree. */
function inScope(application: Application, scope: Scope): boolean {
  if (scope.RegionId && application.RegionId !== scope.RegionId) return false;
  if (scope.BusinessStateId && application.CustomerStateId !== scope.BusinessStateId) return false;
  if (scope.DivisionId && application.CustomerDivisionId !== scope.DivisionId) return false;
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
        'Reads View Onboarding as this officer, resolves every row against the ' +
          'database, and checks the OD rows against the officer\'s own region, state ' +
          'and division. The Fleet rows on the same screen are the control: they ' +
          'establish that the screen is scoped at all.'
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
      const references = await page.evaluate(() => {
        const out: string[] = [];
        for (const row of Array.from(document.querySelectorAll('table tbody tr'))) {
          for (const cell of Array.from(row.querySelectorAll('td'))) {
            const text = (cell.textContent || '').trim();
            if (/^10005\d{5}$/.test(text)) out.push(text);
          }
        }
        return [...new Set(out)];
      });
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

      // The control first: if the non-OD rows are also out of scope, the screen is
      // simply unscoped and the OD result below carries no information.
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
        `${officer.level} is scoped to ${JSON.stringify(scope)} and every non-OD ` +
          `application on this screen respects that. These OD applications do not — ` +
          `they belong to other regions, states and divisions, and this officer can ` +
          `see them all. The scoping is applied to other customer types and not to OD.`
      ).toEqual([]);
    });
  }
});
