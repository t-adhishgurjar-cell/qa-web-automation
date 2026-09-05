import { expect } from '@playwright/test';
import * as path from 'path';
import { test } from '../../src/fixtures/page.fixtures';
import {
  attachment, description, epic, feature, owner, parameter, severity, story, tms,
} from 'allure-js-commons';
import { MatrixDb } from '../../src/helpers/matrix-db.helper';
import { Evidence } from '../../src/helpers/evidence.helper';
import { MOBILE_ALREADY_REGISTERED } from '../../src/pages/user-management/add-user.page';
import { AddCustomerPage } from '../../src/pages/customer-management/add-customer.page';

/**
 * UserType × CustomerType matrix — verified end to end, through the UI, against
 * the database.
 *
 * Traces to FleetPlus_UserType_Matrix_TestCases.xlsx. That workbook states each
 * of its 117 cells as a precondition on database state and an outcome, so a test
 * that only drives the UI proves half of it: it can show the app refused
 * something, but not that the precondition held, nor that nothing was written.
 *
 * Each test here therefore does four things, and attaches all four to the report:
 *
 *   1. snapshot the database for the mobile      -> "before"
 *   2. act through the UI
 *   3. snapshot again                            -> "after"
 *   4. assert on the difference, not on the message
 *
 * ── Every step is also photographed ───────────────────────────────────────
 * Each UI action and each database read is recorded through Evidence, which
 * writes both into Allure and into visual-evidence/ for the standalone visual
 * report. The two are interleaved deliberately: a screenshot of the submitted
 * form followed by the row it produced is the argument the test is making, and
 * splitting them into separate galleries would lose it.
 *
 * ── Why the customer is created first ─────────────────────────────────────
 * The matrix's preconditions are things like "this mobile is already a Fleet
 * customer". Existing mobiles cannot be used to set that up: the application
 * masks customer mobiles in its own grids, and — verified against the database —
 * every customer already holds a user account, so any mobile picked from
 * CustomerMaster trips the Users check too and the cell under test is never
 * isolated. Onboarding a customer ourselves is the only way to arm exactly one
 * precondition and nothing else.
 *
 * ── This writes to QA ─────────────────────────────────────────────────────
 * A real customer application is submitted and enters the reviewer queue. Every
 * record is tagged AUTO<timestamp> so it can be found and removed.
 */

const USER = process.env.FP_ADMIN_USER ?? 'loadtest_006';
const PASS = process.env.FP_ADMIN_PASS ?? 'Nayara@1';
const OTP = process.env.TEST_OTP ?? '123456';
const UPLOAD = path.join(__dirname, '../../test-data/files/sample-doc.pdf');

/** Marks every record this suite creates so QA can find and remove them. */
function runTag(): string {
  return `AUTO${String(Date.now()).slice(-8)}`;
}

/**
 * The mobile this run works on.
 *
 * MATRIX_TEST_MOBILE reuses a mobile a previous run already prepared, which
 * skips the customer onboarding entirely. Without it a fresh number is minted
 * and a real application is submitted — so the variable is the difference
 * between re-running this test freely and adding to the reviewer queue every
 * time. The number is printed on every run so it can be fed back in.
 */
function testMobile(): string {
  return process.env.MATRIX_TEST_MOBILE?.trim() || `9${String(Date.now()).slice(-9)}`;
}

/**
 * A mobile for the Allowed path, which must be clean everywhere.
 *
 * Never reuses MATRIX_TEST_MOBILE: that one is deliberately prepared with a
 * customer record, which is the opposite of what this needs.
 */
function freshUnusedMobile(): string {
  return `9${String(Date.now() + 7).slice(-9)}`;
}

test.use({ storageState: { cookies: [], origins: [] } });

test.describe('UserType × CustomerType matrix', () => {
  // Not serial: each test uses its own mobile and shares no state, so a failure
  // in one must not hide the others.
  test.describe.configure({ mode: 'default' });

  test.beforeEach(async ({ loginPage, dashboardPage }) => {
    await loginPage.navigate();
    await loginPage.login(USER, PASS);
    // The post-login redirect must finish before navigating, or the next
    // request is aborted mid-flight.
    await dashboardPage.assertDashboardLoaded();
  });

  test(
    'TC-UAM-003 a Fleet customer’s mobile cannot become an FP_ADMIN',
    { tag: ['@regression', '@user-management', '@matrix', '@smoke'] },
    async ({ addCustomerPage, addUserPage, dashboardPage, page, db }) => {
      test.setTimeout(600_000);

      await epic('User Management');
      await feature('Add User');
      await story('UserType × CustomerType conflict');
      await owner('QA Team');
      await tms('TC-UAM-003');
      await severity('critical');
      await description(
        'The matrix cell FP_ADMIN × Fleet. Onboards a Fleet customer through the ' +
          'UI so the precondition is created rather than assumed, then attempts an ' +
          'FP_ADMIN on that same mobile and asserts the database gained no user.\n\n' +
          'Asserted on rows, not on wording: the application returns one generic ' +
          'message for all three of the procedure’s conflict checks, so matching ' +
          'text would not distinguish this cell from any other blocked one.'
      );

      const tag = runTag();
      const mobile = testMobile();
      console.log(`Matrix mobile: ${mobile}  (reuse with MATRIX_TEST_MOBILE=${mobile})`);
      await parameter('Mobile under test', mobile);
      await parameter('Run tag', tag);
      await parameter('New user type', 'FP_ADMIN');
      await parameter('Existing state', 'Fleet customer (CustomerTypeCode 1001)');

      const ev = new Evidence('TC-UAM-003 — a Fleet customer’s mobile cannot become an FP_ADMIN', 'tc-uam-003');
      ev.fact('Test case', 'TC-UAM-003');
      ev.fact('Mobile under test', mobile);
      ev.fact('Run tag', tag);
      ev.fact('New user type', 'FP_ADMIN');
      ev.fact('Existing state', 'Fleet customer (CustomerTypeCode 1001)');
      ev.fact('Signed in as', USER);
      let status: 'passed' | 'failed' | 'skipped' = 'passed';

      try {
        await ev.ui(page, 'Signed in as FP Admin', `Dashboard for ${USER}, the account this run acts as.`);

        // ── 1. Before anything ──────────────────────────────────────────────
        const before = await MatrixDb.snapshot(mobile);
        await ev.db(
          'Database before: nothing exists for this mobile',
          'Every table usp_AddUser inspects, read before a single click. This is the baseline the whole test is measured against.',
          MatrixDb.format('BEFORE', before)
        );

        // Whatever happens, no user may exist yet — the whole point is to show one
        // is not created, and a pre-existing one would make that unprovable.
        expect(
          before.users.filter(u => u.mobile === mobile),
          `${mobile} already holds a user, so "no user was created" cannot be shown. ` +
            `Unset MATRIX_TEST_MOBILE to mint a fresh number.`
        ).toHaveLength(0);

        // ── 2. Create the precondition, unless a previous run already did ──
        const alreadyPrepared =
          before.customers.length > 0 || before.pendingApplications.length > 0;

        if (alreadyPrepared) {
          console.log(`${mobile} already has a customer record — skipping onboarding`);
          await ev.note(
            'Customer onboarding skipped',
            'A previous run already prepared this mobile, so no second application was submitted.',
            [
              ...before.customers.map(
                c => `  CustomerMaster    ${c.customerId} type=${c.customerTypeCode} status=${c.status}`
              ),
              ...before.pendingApplications.map(
                a => `  RawCustomerMaster ref=${a.referenceNo} status=${a.status} (awaiting approval)`
              ),
            ].join('\n')
          );
        } else {
          await addCustomerPage.gotoWizard();
          const reference = await addCustomerPage.referenceNo.inputValue();
          await parameter('Customer reference no', reference);
          ev.fact('Customer reference no', reference);
          await ev.ui(
            page,
            'Add Customer wizard, step 1 of 4',
            `The wizard opens with reference ${reference} already allocated. Reached by clicking through the customer list — going straight to the URL renders the form without its footer.`
          );

          await addCustomerPage.fillBasicInformation({
            customerType: 'Fleet',
            panNumber: AddCustomerPage.TEST_PAN,
            panDob: '1990-01-01',
            businessName: `${tag} Matrix Co`,
            businessEmail: `${tag.toLowerCase()}@example.com`,
            customerName: `${tag} Matrix Customer`,
            customerEmail: `${tag.toLowerCase()}.cust@example.com`,
            customerMobile: mobile,
            otp: OTP,
            idProofNumber: AddCustomerPage.TEST_PAN,
            bankName: 'HDFC',
            bankAccountHolder: `${tag} Matrix Customer`,
            bankAccountNumber: '1234567890',
            ifscCode: 'HDFC0002048',
            uploadFile: UPLOAD,
          });
          await ev.ui(
            page,
            'Basic Information filled, mobile verified by OTP',
            `Customer type Fleet — the precondition this cell needs — and mobile ${mobile}, confirmed through the OTP the form demands before it will accept the number.`
          );

          // Checked explicitly, because the wizard does not reliably stop on its
          // own: with a PAN whose fourth character does not suit the selected
          // Type Of Business it sometimes blocks with a modal and sometimes
          // files the application anyway — confirmed by SQL, a flagged PAN
          // reached RawCustomerMaster unchanged. So a returned reference number
          // is not evidence the data was accepted, and this is what makes it so.
          const invalid = await addCustomerPage.validationErrors();
          if (invalid.length) {
            console.log(`Wizard is flagging: ${invalid.join(' | ')}`);
            await ev.note(
              'The form is flagging errors',
              'The wizard will sometimes submit over these, so the test stops here instead.',
              invalid.join('\n')
            );
          }
          expect(
            invalid,
            'Basic Information is showing validation errors, and the wizard may still ' +
              'submit — the application would then be filed with the flagged values.'
          ).toEqual([]);

          await addCustomerPage.saveAsDraft();
          await addCustomerPage.goToAddressStep();
          await addCustomerPage.fillAddress({
            pinCode: '201304',
            businessAddress: `${tag} Matrix Address`,
            addressProofNumber: '1234567890',
            uploadFile: UPLOAD,
          });
          await ev.ui(page, 'Address, step 2 of 4', 'Registered address and its proof document.');

          await addCustomerPage.goToBranchStep();
          await addCustomerPage.fillBranch({ pinCode: '201304', managerName: `${tag} Manager` });
          await addCustomerPage.saveBranch();
          await ev.ui(page, 'Branch location, step 3 of 4', 'One branch with a manager — the minimum the wizard accepts.');

          await addCustomerPage.goToMeetingStep();
          await addCustomerPage.fillMeetingDetails(new Date().toISOString().slice(0, 10));
          await ev.ui(page, 'Meeting details, step 4 of 4', 'The last step before submission. Submit is now live.');

          await addCustomerPage.submit();

          // The wizard stays on screen and raises a Success dialog over it rather
          // than navigating, so the dialog — not the button disappearing — is the
          // signal.
          const submitted = await addCustomerPage.submittedReference();
          await ev.ui(
            page,
            'Application submitted',
            `The wizard confirms reference ${submitted}. It stays on screen and raises this dialog over itself rather than navigating away.`
          );
          expect(submitted, 'the wizard did not confirm the submission').not.toBe('');
          console.log(`Submitted customer application: ${submitted}`);
        }

        // ── 3. The precondition, as the database now holds it ──────────────
        const withCustomer = await MatrixDb.snapshot(mobile);
        await ev.db(
          'Database after the customer exists',
          'The same four tables, read again. Note which one the application actually landed in.',
          MatrixDb.format('AFTER CUSTOMER CREATED', withCustomer)
        );
        await ev.db(
          'What creating the customer changed',
          'The before/after difference, so the new row is visible without reading two full snapshots side by side.',
          MatrixDb.diff(before, withCustomer)
        );

        const predicted = MatrixDb.predictedBlocks(withCustomer);
        await ev.db(
          'Which of usp_AddUser’s checks this state should trip',
          'Derived from the database rather than from the app’s answer, so a disagreement between the two is visible instead of invisible.',
          predicted.length ? predicted.join('\n') : 'none — creation would be allowed'
        );

        // Confirmed against the database: onboarding as a maker writes to
        // RawCustomerMaster with status 107, and the record is only promoted into
        // CustomerMaster once a checker approves it. The matrix's "existing state"
        // columns describe CustomerMaster, which holds approved customers only — so
        // submitting an application does not arm the CustomerMaster check at all.
        //
        // Skipped with that explanation rather than failed: nothing is broken, the
        // precondition simply cannot be reached by a maker alone, and saying so is
        // more use than a red test with a misleading message.
        const pending = withCustomer.pendingApplications
          .map(a => `ref=${a.referenceNo} status=${a.status}`)
          .join('; ');
        const unreachable = predicted.length === 0;
        const skipReason =
          `The application is in RawCustomerMaster (${pending || 'no rows'}) and not in ` +
          `CustomerMaster, so usp_AddUser's Check 1 cannot fire — it only counts ` +
          `CustomerMaster rows in status 101 or 104. This cell needs the customer ` +
          `approved through maker-checker first, which needs a checker account. ` +
          `Set MATRIX_TEST_MOBILE to an already-approved customer's mobile to run it.`;

        if (unreachable) {
          status = 'skipped';
          await ev.note('Precondition cannot be armed by a maker alone', 'Why the remaining steps did not run.', skipReason);
          ev.finish(status);
        }
        test.skip(unreachable, skipReason);

        // ── 4. Attempt the user the matrix says must be refused ────────────
        await addUserPage.open();
        await ev.ui(
          page,
          'Add User form, opened from Manage Users',
          'Opened by clicking through the list. Direct navigation renders this form without its Add button, which is why the assertion below exists.'
        );
        await expect(
          addUserPage.addButton,
          'Add User rendered without its action footer — it must be opened via the list'
        ).toBeVisible();

        await addUserPage.enterMobile(mobile);
        await addUserPage.fillIdentity({
          mobile,
          firstName: tag,
          lastName: 'MatrixProbe',
          email: `${tag.toLowerCase()}.user@example.com`,
          userType: 'FP_ADMIN',
        });
        await addUserPage.selectUserType('FP_ADMIN');
        await ev.ui(
          page,
          'Form completed as FP_ADMIN, ready to submit',
          `Mobile ${mobile} — the number now held by a Fleet customer — being submitted as an FP_ADMIN. The matrix requires this to be refused.`
        );

        const outcome = await addUserPage.submit();
        await ev.ui(
          page,
          'What the application answered',
          outcome.created
            ? 'The application reported the user as created.'
            : `The application refused: “${outcome.message || 'no message shown'}”.`
        );
        await ev.note(
          'Add User outcome, as the server reported it',
          'Read from the response body rather than the rendered text, because the same wording is used for all three conflict checks.',
          [
            `created              : ${outcome.created}`,
            `message              : ${outcome.message || '(none)'}`,
            `final url            : ${outcome.finalUrl}`,
            `deferred to locations: ${outcome.wentToLocationMapping}`,
          ].join('\n')
        );

        // ── 5. After the attempt ──────────────────────────────────────────
        const after = await MatrixDb.snapshot(mobile);
        await ev.db(
          'Database after the Add User attempt',
          'The proof the refusal was real: an application can show an error and still have written a row.',
          MatrixDb.format('AFTER USER ATTEMPT', after)
        );
        await ev.db(
          'What the Add User attempt changed',
          'Expected to be nothing. This is the assertion the test actually makes.',
          MatrixDb.diff(withCustomer, after)
        );

        // The assertion that matters: the database gained no user.
        expect(
          after.users.filter(u => u.mobile === mobile).length,
          `usp_AddUser created a user for ${mobile}, which is a Fleet customer. ` +
            `Matrix cell FP_ADMIN × Fleet requires this to be refused by the ` +
            `CustomerMaster check.`
        ).toBe(0);
        expect(outcome.created, 'the application reported the user as created').toBe(false);
        expect(outcome.message, 'the refusal was not explained to the user')
          .toMatch(MOBILE_ALREADY_REGISTERED);
      } catch (error) {
        if (status !== 'skipped') status = 'failed';
        throw error;
      } finally {
        if (status !== 'skipped') ev.finish(status);
      }
    }
  );


  test(
    'TC-UAM-001 an unused mobile can be created as an FP_ADMIN',
    { tag: ['@regression', '@user-management', '@matrix', '@smoke'] },
    async ({ addUserPage, page, db }) => {
      test.setTimeout(300_000);

      await epic('User Management');
      await feature('Add User');
      await story('UserType × CustomerType conflict');
      await owner('QA Team');
      await tms('TC-UAM-001');
      await severity('critical');
      await description(
        'The matrix cell FP_ADMIN × no existing record — the Allowed half of the ' +
          'rule, and the only one that proves the block is discriminating rather ' +
          'than blanket. A suite that only demonstrates refusals cannot tell a ' +
          'working conflict check from an application that refuses everything.\n\n' +
          '**This creates a real FP_ADMIN user in QA.** It is named AUTO<timestamp> ' +
          'so it can be found and removed, and the mobile is minted fresh so no ' +
          'existing account is touched.'
      );

      const tag = runTag();
      const mobile = freshUnusedMobile();
      console.log(`Creating FP_ADMIN on ${mobile}`);
      await parameter('Mobile under test', mobile);
      await parameter('Run tag', tag);
      await parameter('New user type', 'FP_ADMIN');
      await parameter('Existing state', 'no record anywhere');

      const ev = new Evidence('TC-UAM-001 — an unused mobile can be created as an FP_ADMIN', 'tc-uam-001');
      ev.fact('Test case', 'TC-UAM-001');
      ev.fact('Mobile under test', mobile);
      ev.fact('Run tag', tag);
      ev.fact('New user type', 'FP_ADMIN');
      ev.fact('Existing state', 'no record anywhere');
      ev.fact('Signed in as', USER);
      let status: 'passed' | 'failed' | 'skipped' = 'passed';

      try {
        await ev.ui(page, 'Signed in as FP Admin', `Dashboard for ${USER}, the account this run acts as.`);

        // ── Before ────────────────────────────────────────────────────────
        const before = await MatrixDb.snapshot(mobile);
        await ev.db(
          'Database before: the mobile is clean',
          `Nothing anywhere for ${mobile}. This is what makes it the Allowed cell rather than a blocked one.`,
          MatrixDb.format('BEFORE', before)
        );

        expect(before.users, `${mobile} already holds a user`).toHaveLength(0);
        expect(before.customers, `${mobile} is already a customer`).toHaveLength(0);
        expect(
          MatrixDb.predictedBlocks(before),
          'this mobile is not clean, so the Allowed path is not what would be tested'
        ).toEqual([]);

        // ── Act ───────────────────────────────────────────────────────────
        await addUserPage.open();
        await ev.ui(
          page,
          'Add User form, opened from Manage Users',
          'Opened by clicking through the list, which is the only route that renders the Add button.'
        );

        await addUserPage.enterMobile(mobile);
        await ev.ui(
          page,
          'Mobile entered, lookup returned nothing',
          `Typing a known number prefills the holder’s name and email. Nothing was prefilled for ${mobile}, which is the app agreeing with the snapshot above.`
        );

        await addUserPage.fillIdentity({
          mobile,
          firstName: tag,
          lastName: 'MatrixProbe',
          email: `${tag.toLowerCase()}.newuser@example.com`,
          userType: 'FP_ADMIN',
        });
        await addUserPage.selectUserType('FP_ADMIN');
        await ev.ui(
          page,
          'Form completed as FP_ADMIN, ready to submit',
          'Identity filled and the user type set. Choosing FP_ADMIN auto-fills the role — for three of the five selectable types it does not, and the Add button is then silently inert.'
        );

        const outcome = await addUserPage.submit();
        await ev.ui(
          page,
          'What the application answered',
          outcome.created
            ? 'The application reported the user as created. The database check below is what makes that claim true or false.'
            : `The application refused: “${outcome.message || 'no message shown'}”.`
        );
        await ev.note(
          'Add User outcome, as the server reported it',
          'Read from the response body, not the rendered text.',
          [
            `created              : ${outcome.created}`,
            `message              : ${outcome.message || '(none)'}`,
            `final url            : ${outcome.finalUrl}`,
            `deferred to locations: ${outcome.wentToLocationMapping}`,
          ].join('\n')
        );

        // ── After ─────────────────────────────────────────────────────────
        const after = await MatrixDb.snapshot(mobile);
        await ev.db(
          'Database after: the user row exists',
          'Independent confirmation. The assertions below check the flags usp_AddUser derives, not just that a row appeared.',
          MatrixDb.format('AFTER USER CREATED', after)
        );
        await ev.db(
          'What changed',
          'One row added to Users, and nothing else touched.',
          MatrixDb.diff(before, after)
        );

        const created = after.users.filter(u => u.mobile === mobile);
        expect(
          created,
          `The application reported "${outcome.message}" but no user row exists for ` +
            `${mobile}. Matrix cell FP_ADMIN × no existing record requires one.`
        ).toHaveLength(1);

        // The flags usp_AddUser derives, checked against what it documents.
        const user = created[0];
        ev.fact('User id created', String(user.userId));
        expect(user.userTypeCode, 'the user was created as the wrong type').toBe('FP_ADMIN');
        expect(user.isActive, 'a newly created user should be active').toBe(true);
        expect(
          user.isSystemUser,
          'FP_ADMIN is an admin/system code, so IsSystemUser must be set (NFP-1683)'
        ).toBe(true);
        expect(
          user.isParentUser,
          'no user existed for this mobile, so IsParentUser must be 1'
        ).toBe(true);
      } catch (error) {
        status = 'failed';
        throw error;
      } finally {
        ev.finish(status);
      }
    }
  );

  test(
    'the Add User screen offers only five of the thirteen user types',
    { tag: ['@regression', '@user-management', '@matrix'] },
    async ({ addUserPage, page }) => {
      await epic('User Management');
      await feature('Add User');
      await story('Reachable user types');
      await owner('QA Team');
      await severity('normal');
      await description(
        'Scope check for the matrix, not a defect in itself. The workbook has 13 ' +
          'user-type rows; this screen offers 5, so 72 of its 117 cells are not ' +
          'reachable here and must be covered by another entry point or at the ' +
          'stored procedure directly. Recorded as a test so the gap is visible in ' +
          'the report rather than living in a review comment.'
      );

      const ev = new Evidence('Reachable user types — the Add User screen offers five of thirteen', 'user-type-scope');
      ev.fact('Test case', 'Matrix scope check');
      ev.fact('Types in workbook', '13');
      ev.fact('Types offered by the UI', '5');
      let status: 'passed' | 'failed' | 'skipped' = 'passed';

      try {
        await addUserPage.open();
        const offered = await addUserPage.offeredUserTypes();
        await attachment('User types offered', offered.join('\n'), 'text/plain');
        await ev.ui(
          page,
          'The Add User screen',
          'The user-type dropdown is the whole subject of this test — what it offers bounds how much of the matrix this entry point can cover at all.'
        );
        await ev.note(
          'The user types this screen offers',
          'Read from the dropdown, not assumed. CUSTOMER_ADMIN and BRANCH_ADMIN — 83% of all users in the database — are absent, so they are created by some other route.',
          offered.join('\n')
        );

        expect(offered.sort()).toEqual(
          ['FP_ADMIN', 'HO', 'HO_ADMIN', 'OTHER_NAYARA', 'OTHER_NON'].sort()
        );
      } catch (error) {
        status = 'failed';
        throw error;
      } finally {
        ev.finish(status);
      }
    }
  );
});
