import { test } from '../src/fixtures/page.fixtures';
import { AddCustomerPage } from '../src/pages/customer-management/add-customer.page';
import { DSA, TEST_OTP } from '../src/config/accounts';
import * as path from 'path';

/**
 * Why some OD applications get the dummy division and some get nothing.
 *
 * Dev's mechanism for this change is a dummy division per active business state —
 * the fifteen "OD Default - <state>" rows. It is being applied unevenly:
 *
 *   DSA 8527769693, mapped to four divisions in state 7   -> 57, OD Default - UP_UK
 *   DSA 9611200199, mapped to one division in state 4     -> 0, no division
 *   OD user 7000000187, no location mapping at all        -> 34, Noida, a REAL division
 *
 * All three are OD applications raised after the dummy divisions were created. The
 * two DSAs hold the same user type and the same role, so the difference is not
 * entitlement. Two candidates remain: the business state chosen on the form, or
 * something about the maker's own mapping.
 *
 * This separates them the only way that is conclusive — raise an application as the
 * DSA that gets 0, choosing the business state of the one that gets 57. If the
 * dummy appears, assignment follows the selected state and state 4 is the problem.
 * If it does not, the maker is.
 *
 *   TOOLS=true ENV=qa npx playwright test --project=tools --grep "probe od dummy by state"
 */

test.use({ storageState: { cookies: [], origins: [] } });

/** The state whose applications do get a dummy division, raised by a different DSA. */
const STATE_THAT_WORKS = process.env.OD_PROBE_STATE ?? 'UP_UK';
const EXPECTED_DUMMY = `OD Default - ${STATE_THAT_WORKS}`;
/** A pin code inside the chosen state, so state and address agree. */
const PIN = process.env.OD_PROBE_PIN ?? '226001';

test.describe('Tools — probes @tools', () => {
  test('probe od dummy by state', async ({ loginPage, dashboardPage, addCustomerPage, db }) => {
    test.setTimeout(420_000);

    await loginPage.navigate();
    await loginPage.login(DSA.username, DSA.password);
    await dashboardPage.assertDashboardLoaded();
    await addCustomerPage.gotoWizard();

    const reference = await addCustomerPage.referenceNo.inputValue();
    const tag = `PROBE${String(Date.now()).slice(-6)}`;
    console.log(`  maker ${DSA.username} (state 4, division 17), choosing state ${STATE_THAT_WORKS}`);
    console.log(`  reference ${reference}`);

    await addCustomerPage.fillOdBasicInformation({
      state: STATE_THAT_WORKS,
      pinCode: PIN,
      businessAddress: `${tag} address`,
      addressProofNumber: '1234567890',
      panNumber: AddCustomerPage.freshPan(),
      panDob: '1990-01-01',
      customerName: `${tag} OD State Probe`,
      customerEmail: `${tag.toLowerCase()}@example.com`,
      customerMobile: `9${String(Date.now()).slice(-9)}`,
      otp: TEST_OTP,
      bankName: 'HDFC',
      bankAccountHolder: `${tag} OD State Probe`,
      bankAccountNumber: '1234567890',
      ifscCode: 'HDFC0002048',
      uploadFile: path.join(__dirname, '../test-data/files/sample-doc.pdf'),
    });

    await addCustomerPage.saveAsDraft();
    await addCustomerPage.waitForDialog(5_000);
    await addCustomerPage.dismissValidationDialogs();
    await addCustomerPage.submitOd();

    const confirmed = await addCustomerPage.submissionSuccess
      .waitFor({ state: 'visible', timeout: 30_000 }).then(() => true).catch(() => false);
    console.log(`  submitted: ${confirmed}`);
    if (!confirmed) {
      console.log(`  dialogs: ${(await addCustomerPage.dismissValidationDialogs()).join(' | ')}`);
      console.log(`  inline: ${(await addCustomerPage.visibleFieldErrors()).join(' | ')}`);
    }

    const rows = await db.query(`
      SELECT r.ReferenceNo, r.Status, r.CustomerStateId, r.CustomerDivisionId,
             d.DivisionName, d.IsPlaceholder
      FROM dbo.RawCustomerMaster r
      LEFT JOIN dbo.DivisionMaster d ON d.DivisionId = r.CustomerDivisionId
      WHERE r.ReferenceNo = ${Number(reference)}`);
    console.log(`\n  stored: ${JSON.stringify(rows[0])}`);
    console.log(`  expected if assignment follows the SELECTED STATE: ${EXPECTED_DUMMY} (57)`);
    console.log(`  expected if the difference is the MAKER: 0, no division`);
  });
});
