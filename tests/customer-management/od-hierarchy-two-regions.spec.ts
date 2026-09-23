import { expect } from '@playwright/test';
import * as path from 'path';
import { test } from '../../src/fixtures/page.fixtures';
import { epic, feature, story, severity, description, owner } from 'allure-js-commons';
import { AddCustomerPage } from '../../src/pages/customer-management/add-customer.page';
import { DSA, TEST_OTP } from '../../src/config/accounts';
import { runTag } from '../../src/helpers/test-identity';

/**
 * Two OD customers in two regions, read by both regions' officers.
 *
 * This replaces an earlier design that needed a Fleet application as its control — to
 * prove the screen filters anybody before concluding that OD escapes the filter. That
 * control kept running dry: View Onboarding lists only its ten most recent
 * applications, and a suite that raises OD applications fills all ten.
 *
 * Two OD applications in different regions need no third party. Each is the other's
 * control, and both are OD, so nothing rests on how a different customer type is
 * treated:
 *
 *   an Ahmedabad OD (GJ_I, region 4)  must be visible to the Ahmedabad officers
 *                                     and invisible to the Kolkata ones
 *   a Kolkata OD (WB_NE, region 1)    the reverse
 *
 * If each trio sees only its own, the hierarchy holds and the change is correct: the
 * division level has stopped restricting OD while region and state still do. If both
 * trios see both, the location filter is not applied to OD at all — and the failure
 * cannot be explained by the screen being unscoped, because the same screen, in the
 * same run, excluded the other region's application from the same officer.
 *
 * The division admins are the interesting row. An OD application carries the dummy
 * division for its state (61 for GJ_I, 53 for WB_NE), not the admin's own division, so
 * a division admin must still see it — that is exactly what "remove the division
 * hierarchy from OD" asks for. They should be excluded by region and state only.
 *
 * Creates two real OD applications in QA, tagged AUTO<timestamp>.
 */

test.use({ storageState: { cookies: [], origins: [] } });
// Not serial. The two raise tests must run before the six visibility tests, which
// declaration order plus a single worker gives — but under serial the first officer to
// fail would stop the other five from ever running, and the whole point is the shape of
// the matrix across all six. Each visibility test asserts the fixtures exist first, so
// running this file with more than one worker fails loudly rather than silently.
//
//   ENV=qa npx playwright test --project=customer-management \
//     --grep "OD hierarchy across two regions" --workers=1
test.describe.configure({ mode: 'default' });

const UPLOAD = path.join(__dirname, '../../test-data/files/sample-doc.pdf');
const VIEW_ONBOARDING = '/Customer/CustomerOnboardingStatus';
const OFFICER_PASSWORD = process.env.OD_OFFICER_PASSWORD ?? 'Nayara@1';

/** The two places, and the dummy division each one's OD applications should carry. */
const PLACES = {
  ahmedabad: {
    label: 'Ahmedabad', state: 'GJ_I', businessStateId: 11, regionId: 4,
    pinCode: '380001', dummyDivision: 'OD Default - GJ_I',
  },
  kolkata: {
    label: 'Kolkata', state: 'WB_NE', businessStateId: 3, regionId: 1,
    pinCode: '700001', dummyDivision: 'OD Default - WB_NE',
  },
} as const;

type PlaceKey = keyof typeof PLACES;

/**
 * The six officers, and which of the two applications each should see.
 *
 * `sees` names the place whose application is inside this officer's scope; the other
 * place's application must not appear. Scopes are as supplied and were confirmed
 * against dbo.UserLocationMapping.
 */
const OFFICERS = [
  { level: 'Ahmedabad Region Admin', username: '9072986100', scope: 'region 4 (West)', sees: 'ahmedabad' },
  { level: 'Ahmedabad State Admin', username: '9073068501', scope: 'region 4, state 11 (GJ_I)', sees: 'ahmedabad' },
  { level: 'Ahmedabad I Division Admin', username: '9073139002', scope: 'region 4, state 11, division 1', sees: 'ahmedabad' },
  // Division 2 in the same state and zone as division 1. The pair is the tightest
  // control available for the division level: an OD application in GJ_I carries the
  // dummy division 61, which is neither 1 nor 2, so both admins must see it — that is
  // the change working. Anything that distinguishes them would mean the division is
  // still being matched against OD.
  { level: 'Ahmedabad II Division Admin', username: '9063600900', scope: 'region 4, state 11, division 2', sees: 'ahmedabad' },
  { level: 'Kolkata Region Admin', username: '9073209903', scope: 'region 1 (East)', sees: 'kolkata' },
  { level: 'Kolkata State Admin', username: '9073275904', scope: 'region 1, state 3 (WB_NE)', sees: 'kolkata' },
  { level: 'Kolkata Division Admin', username: '9073340105', scope: 'region 1, state 3, division 26', sees: 'kolkata' },
] as const satisfies readonly { level: string; username: string; scope: string; sees: PlaceKey }[];

/**
 * The references are looked up from the database, not remembered between tests.
 *
 * A module-level variable was tried first and does not survive: Playwright restarts the
 * worker after a test fails, so the moment the first officer's assertion failed the
 * other five reported "the fixture applications were not raised" and measured nothing.
 * The whole value of this file is the shape of the matrix across all six officers, so
 * one failure must not blank the rest.
 *
 * Reading the newest OD application for a business state is also a truer question than
 * "what did the variable say": if the fixture did not run, the query returns an older
 * application in the same state and the test still measures something real.
 */
async function newestOdApplication(
  db: { query: <T>(sql: string) => Promise<T[]> },
  businessStateId: number
): Promise<{ ReferenceNo: number; CustomerDivisionId: number; DivisionName: string | null } | undefined> {
  const rows = await db.query<{
    ReferenceNo: number; CustomerDivisionId: number; DivisionName: string | null;
  }>(`
    SELECT TOP 1 r.ReferenceNo, r.CustomerDivisionId, d.DivisionName
    FROM dbo.RawCustomerMaster r
    JOIN dbo.CustomerTypeMaster t ON t.Id = r.CustomerType
    LEFT JOIN dbo.DivisionMaster d ON d.DivisionId = r.CustomerDivisionId
    WHERE t.CustomerTypeCode = 1004 AND r.CustomerStateId = ${businessStateId}
    ORDER BY r.CreatedOn DESC`);
  return rows[0];
}

test.describe('OD hierarchy across two regions @customer-management @regression', () => {
  for (const key of Object.keys(PLACES) as PlaceKey[]) {
    const place = PLACES[key];

    test(`raises an OD application in ${place.label} (${place.state})`, async ({
      loginPage, dashboardPage, addCustomerPage, db,
    }) => {
      test.setTimeout(420_000);
      await epic('Customer Management');
      await feature('OD enrolment');
      await owner('QA Team');
      await story('Officer hierarchy across regions');
      await severity('critical');
      await description(
        `Raises an OD application with business state ${place.state}, so that the ` +
          `${place.label} officers have something inside their scope and the other ` +
          `region's officers have something outside theirs. Confirms it was stored ` +
          `against the dummy division for that state before any visibility is judged — ` +
          `an application stored against the wrong division would make every later ` +
          `assertion mean something different.`
      );

      await loginPage.navigate();
      await loginPage.login(DSA.username, DSA.password);
      await dashboardPage.assertDashboardLoaded();
      await addCustomerPage.gotoWizard();

      const tag = runTag();
      const reference = await addCustomerPage.referenceNo.inputValue();
      console.log(`${place.label}: reference ${reference}, tag ${tag}`);

      await addCustomerPage.fillOdBasicInformation({
        state: place.state,
        pinCode: place.pinCode,
        businessAddress: `${tag} ${place.label} address`,
        addressProofNumber: '1234567890',
        panNumber: AddCustomerPage.freshPan(),
        panDob: '1990-01-01',
        customerName: `${tag} OD ${place.label}`,
        customerEmail: `${tag.toLowerCase()}@example.com`,
        customerMobile: `9${String(Date.now()).slice(-9)}`,
        otp: TEST_OTP,
        bankName: 'HDFC',
        bankAccountHolder: `${tag} OD ${place.label}`,
        bankAccountNumber: '1234567890',
        ifscCode: 'HDFC0002048',
        uploadFile: UPLOAD,
      });

      await addCustomerPage.saveAsDraft();
      await addCustomerPage.waitForDialog(5_000);
      await addCustomerPage.dismissValidationDialogs();
      await addCustomerPage.submitOd();

      const confirmed = await addCustomerPage.submissionSuccess
        .waitFor({ state: 'visible', timeout: 30_000 }).then(() => true).catch(() => false);
      if (!confirmed) {
        const dialogs = await addCustomerPage.dismissValidationDialogs();
        const inline = await addCustomerPage.visibleFieldErrors();
        throw new Error(
          `The ${place.label} OD application was not submitted.\n` +
            `  dialogs: ${dialogs.join(' | ') || 'none'}\n` +
            `  inline errors: ${inline.join(' | ') || 'none'}`
        );
      }

      const rows = await db.query<{
        Status: number; CustomerStateId: number; CustomerDivisionId: number;
        DivisionName: string | null; IsPlaceholder: boolean | null; RegionId: number | null;
      }>(`
        SELECT r.Status, r.CustomerStateId, r.CustomerDivisionId, d.DivisionName,
               d.IsPlaceholder, d.RegionId
        FROM dbo.RawCustomerMaster r
        LEFT JOIN dbo.DivisionMaster d ON d.DivisionId = r.CustomerDivisionId
        WHERE r.ReferenceNo = ${Number(reference)}`);
      expect(rows, `application ${reference} was not stored`).toHaveLength(1);
      console.log(`${place.label} stored as: ${JSON.stringify(rows[0])}`);

      expect(
        rows[0].CustomerStateId,
        `The application was stored against business state ${rows[0].CustomerStateId}, ` +
          `not ${place.businessStateId} (${place.state}) as the form was given. The ` +
          `visibility tests depend on this being right.`
      ).toBe(place.businessStateId);

      expect(
        rows[0].DivisionName,
        `Stored against "${rows[0].DivisionName}" rather than the dummy division for ` +
          `${place.state}. If this is division 0, the environment is on a build where ` +
          `the dummy rows exist but nothing assigns them.`
      ).toBe(place.dummyDivision);

      console.log(`${place.label} ready for the visibility tests: ${reference}`);
    });
  }

  for (const officer of OFFICERS) {
    test(`${officer.level} sees only their own region's OD application`, async ({
      loginPage, dashboardPage, page, db,
    }) => {
      test.setTimeout(300_000);
      await epic('Customer Management');
      await feature('OD enrolment');
      await owner('QA Team');
      await story('Officer hierarchy across regions');
      await severity('blocker');

      const mine = PLACES[officer.sees];
      const theirs = PLACES[(officer.sees === 'ahmedabad' ? 'kolkata' : 'ahmedabad') as PlaceKey];

      const mineRow = await newestOdApplication(db, mine.businessStateId);
      const theirsRow = await newestOdApplication(db, theirs.businessStateId);
      const mineRef = mineRow ? String(mineRow.ReferenceNo) : undefined;
      const theirsRef = theirsRow ? String(theirsRow.ReferenceNo) : undefined;

      await description(
        `${officer.username} is scoped to ${officer.scope}. It should see the ` +
          `${mine.label} application and not the ${theirs.label} one. The second half ` +
          `is the control: it establishes that this screen filters by location at all, ` +
          `so the first half means something.`
      );

      expect(
        mineRef,
        `No OD application exists in ${mine.label} (business state ` +
          `${mine.businessStateId}) for this officer to see. Run the two raise tests in ` +
          `this file first.`
      ).toBeTruthy();
      expect(
        theirsRef,
        `No OD application exists in ${theirs.label} (business state ` +
          `${theirs.businessStateId}) to act as the control.`
      ).toBeTruthy();
      console.log(
        `  ${mine.label} ${mineRef} on ${mineRow?.DivisionName}, ` +
        `${theirs.label} ${theirsRef} on ${theirsRow?.DivisionName}`
      );

      await loginPage.navigate();
      await loginPage.login(officer.username, OFFICER_PASSWORD);
      await dashboardPage.assertDashboardLoaded();

      await page.goto(VIEW_ONBOARDING, { waitUntil: 'domcontentloaded' });
      await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);

      // Cell by cell: the grid renders cells with no separator, so a row reads
      // "11000514939OD..." and any match anchored on a word boundary finds nothing.
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

      const seesMine = references.includes(mineRef!);
      const seesTheirs = references.includes(theirsRef!);
      console.log(
        `${officer.level}: own ${mine.label} ${mineRef} ${seesMine ? 'VISIBLE' : 'not visible'}, ` +
        `other-region ${theirs.label} ${theirsRef} ${seesTheirs ? 'VISIBLE' : 'not visible'} ` +
        `(${references.length} rows listed)`
      );

      // Both applications are among the most recent, so neither can be missing merely
      // for being old — the screen lists its ten newest and these are two of them.
      expect(
        seesMine,
        `${officer.level} (${officer.scope}) cannot see OD application ${mineRef}, ` +
          `raised in ${mine.label} — inside their own region and state. It carries the ` +
          `dummy division for ${mine.state}, not this officer's division, so if the ` +
          `division is still being matched then the change has not removed the ` +
          `division hierarchy from OD after all.`
      ).toBe(true);

      expect(
        seesTheirs,
        `${officer.level} (${officer.scope}) can see OD application ${theirsRef}, ` +
          `raised in ${theirs.label} — region ${theirs.regionId}, state ` +
          `${theirs.businessStateId}, which this officer has no claim to. The change ` +
          `removed the division level from OD; region and state were not part of it. ` +
          `This officer did see their own region's application in the same run, so the ` +
          `screen is not simply unfiltered.`
      ).toBe(false);
    });
  }
});
