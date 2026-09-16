import { expect } from '@playwright/test';
import * as path from 'path';
import { test } from '../../src/fixtures/page.fixtures';
import { epic, feature, story, severity, description, owner, tms } from 'allure-js-commons';
import { AddCustomerPage } from '../../src/pages/customer-management/add-customer.page';
import { ONBOARDING_MAKER, TEST_OTP } from '../../src/config/accounts';
import { runTag } from '../../src/helpers/test-identity';

/**
 * Customer Onboarding — the full Add Customer journey.
 *
 * Basic Information -> Address -> Branch location -> Meeting Details -> Submit.
 *
 * This creates a real application in QA: it consumes a reference number and
 * enters the reviewer queue. Every record is therefore named so it is obvious
 * where it came from and can be found and cleaned up later.
 *
 * Requires an account entitled to onboard customers. DSA and TSM accounts can
 * open the wizard but the ones we hold do not render its footer controls, so the
 * account is configured separately rather than taken from the credentials sheet.
 */

test.use({ storageState: { cookies: [], origins: [] } });
test.describe.configure({ mode: 'serial' });

const { username: USER, password: PASS } = ONBOARDING_MAKER;
const OTP = TEST_OTP;
const UPLOAD = path.join(__dirname, '../../test-data/files/sample-doc.pdf');

/**
 * A mobile number unused by any previous run.
 *
 * The app rejects an already-registered number, and a fixed one works exactly
 * once. Override with CUSTOMER_TEST_MOBILE if QA reserves a range.
 */
function testMobile(): string {
  return process.env.CUSTOMER_TEST_MOBILE ?? `9${String(Date.now()).slice(-9)}`;
}

test.describe('Customer Onboarding @customer-management @regression', () => {
  test.beforeEach(async ({ loginPage, dashboardPage }) => {
    await epic('Customer Management');
    await feature('Add Customer');
    await owner('QA Team');

    await loginPage.navigate();
    await loginPage.login(USER, PASS);
    // The post-OTP redirect must finish before navigating, or the next request aborts.
    await dashboardPage.assertDashboardLoaded();
  });

  test('submits a complete customer onboarding application @sanity', async ({ addCustomerPage, page }) => {
    test.setTimeout(300_000);
    await tms('TC003-TC045', 'Customer Onboarding');
    await story('End-to-end onboarding');
    await severity('critical');
    await description(
      'Fills all four wizard steps and submits. Creates a real application in the ' +
        'reviewer queue, tagged AUTO<timestamp> for cleanup.'
    );

    const tag = runTag();
    await addCustomerPage.gotoWizard();

    const reference = await addCustomerPage.referenceNo.inputValue();
    console.log(`Reference No: ${reference}  tag: ${tag}`);
    expect(reference).toMatch(/\d{6,}/);

    await addCustomerPage.fillBasicInformation({
      customerType: 'Fleet',
      panNumber: AddCustomerPage.TEST_PAN,
      panDob: '1990-01-01',
      businessName: `${tag} Automation Co`,
      businessEmail: `${tag.toLowerCase()}@example.com`,
      customerName: `${tag} Customer`,
      customerEmail: `${tag.toLowerCase()}.cust@example.com`,
      customerMobile: testMobile(),
      otp: OTP,
      idProofNumber: AddCustomerPage.TEST_PAN,
      bankName: 'HDFC',
      bankAccountHolder: `${tag} Customer`,
      bankAccountNumber: '1234567890',
      ifscCode: 'HDFC0002048',
      uploadFile: UPLOAD,
    });

    await addCustomerPage.saveAsDraft();
    await addCustomerPage.goToAddressStep();

    await addCustomerPage.fillAddress({
      pinCode: '201304',
      businessAddress: `${tag} Test Address`,
      addressProofNumber: '1234567890',
      uploadFile: UPLOAD,
    });
    await addCustomerPage.goToBranchStep();

    await addCustomerPage.fillBranch({ pinCode: '201304', managerName: `${tag} Manager` });
    await addCustomerPage.saveBranch();
    await addCustomerPage.goToMeetingStep();

    const today = new Date().toISOString().slice(0, 10);
    await addCustomerPage.fillMeetingDetails(today);
    await addCustomerPage.submit();

    // Submitting does NOT leave the wizard. The application stays on the
    // Meeting Details step and opens a modal:
    //
    //   Success
    //   The customer form with Reference ID 1000514818 has been successfully
    //   submitted.
    //
    // with Previous, Save As Draft and Submit all still on screen behind it.
    // Waiting for the Submit button to disappear therefore fails on a
    // submission that worked — which is what this assertion did, reporting a
    // successful onboarding as a failure.
    //
    // The reference in that sentence is the real signal, and checking it
    // against the one read at the start of the run is worth more than any
    // visibility check: it proves the application that was submitted is the
    // application this test filled in, not a draft left over from another.
    const banner = page.locator('.modal.show').filter({ hasText: /successfully submitted/i }).first();

    await expect(
      banner,
      `The wizard did not confirm the submission. Expected a modal saying the ` +
        `form was successfully submitted; the page may still be reporting a ` +
        `validation problem on the Meeting Details step.`
    ).toBeVisible({ timeout: 30_000 });

    const confirmation = ((await banner.textContent()) ?? '').replace(/\s+/g, ' ').trim();
    expect(
      confirmation,
      `The confirmation names a different application than the one this test ` +
        `filled in. Expected reference ${reference}, and the screen said: ` +
        `"${confirmation}".`
    ).toContain(reference);

    console.log(`Submitted application ${reference} — "${confirmation}"`);
  });

  test('saves a partial application as draft', async ({ addCustomerPage }) => {
    test.setTimeout(240_000);
    await tms('TC008', 'Customer Onboarding');
    await story('Save As Draft');
    await severity('normal');
    await description('Basic Information can be saved as a draft without completing the wizard.');

    const tag = runTag();
    await addCustomerPage.gotoWizard();

    await addCustomerPage.fillBasicInformation({
      customerType: 'Fleet',
      panNumber: AddCustomerPage.TEST_PAN,
      panDob: '1990-01-01',
      businessName: `${tag} Draft Co`,
      businessEmail: `${tag.toLowerCase()}@example.com`,
      customerName: `${tag} Draft`,
      customerEmail: `${tag.toLowerCase()}.d@example.com`,
      customerMobile: testMobile(),
      otp: OTP,
      idProofNumber: AddCustomerPage.TEST_PAN,
      bankName: 'HDFC',
      bankAccountHolder: `${tag} Draft`,
      bankAccountNumber: '1234567890',
      ifscCode: 'HDFC0002048',
      uploadFile: UPLOAD,
    });

    await addCustomerPage.saveAsDraft();
    // Advancing proves the save was accepted; the app blocks Next otherwise.
    await addCustomerPage.goToAddressStep();
    await expect(addCustomerPage.addressPinCode).toBeVisible();
  });
});
