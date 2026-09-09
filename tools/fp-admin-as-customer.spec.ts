import { test } from '../src/fixtures/page.fixtures';
import { MatrixDb } from '../src/helpers/matrix-db.helper';
import { CUSTOMER_ADMIN, TEST_OTP } from '../src/config/accounts';

/**
 * The reverse direction: can a mobile that already logs in as staff be
 * onboarded as a customer?
 *
 * Everything measured so far runs one way — Add User refusing a number because
 * of what CustomerMaster holds. usp_AddUser also has a Users check, and
 * FP_ADMIN is on its blocking list, so a mobile holding one is refused a second
 * user. The untested direction is whether Add Customer honours anything
 * equivalent.
 *
 * It matters because the two screens have already been shown to disagree:
 * 9876896688 was refused a new user and accepted for a new OD. If Add Customer
 * also accepts a number that belongs to a Nayara administrator, then the same
 * person can hold both a staff login and a customer account on one number, and
 * the block on the user side is protecting nothing.
 *
 * The fixture is chosen to make a refusal unambiguous: an active FP_ADMIN and
 * no customer, no in-flight application, no RO record. There are 1120 such
 * mobiles, so nothing scarce is being consumed. The probe stops once the app
 * has answered — it does not complete an onboarding.
 *
 *   TOOLS=true ENV=qa npx playwright test --project=tools --grep "FP_ADMIN as customer"
 */

test.use({ storageState: { cookies: [], origins: [] } });

const { username: USER, password: PASS } = CUSTOMER_ADMIN;

/** An active FP_ADMIN with nothing else attached. Override to try another. */
const MOBILE = process.env.FP_ADMIN_MOBILE ?? '9001000204';

/** Which customer type to attempt. FO/Fleet is the question as asked. */
const CUSTOMER_TYPE = process.env.FP_ADMIN_CUSTOMER_TYPE ?? 'Fleet';

test.describe('Tools — cross-flow checks @tools', () => {
  test('FP_ADMIN as customer — can a staff mobile be onboarded as FO', async ({
    loginPage, dashboardPage, addCustomerPage, page,
  }) => {
    test.setTimeout(300_000);

    const before = await MatrixDb.snapshot(MOBILE);
    console.log(MatrixDb.format(`BEFORE — ${MOBILE}`, before));

    const staff = before.users.filter(u => u.userTypeCode === 'FP_ADMIN' && u.isActive);
    if (!staff.length) {
      throw new Error(
        `${MOBILE} does not hold an active FP_ADMIN, so this probe would prove ` +
          `nothing. Pick another with FP_ADMIN_MOBILE.`
      );
    }
    if (before.customers.length) {
      throw new Error(
        `${MOBILE} already has ${before.customers.length} customer record(s). A ` +
          `refusal could then be the customer rule rather than the user rule.`
      );
    }
    console.log(`\nfixture is sound: active FP_ADMIN (id ${staff[0].userId}), no customer records\n`);

    await loginPage.navigate();
    await loginPage.login(USER, PASS);
    await dashboardPage.assertDashboardLoaded();

    await addCustomerPage.gotoWizard();
    const reference = await addCustomerPage.referenceNo.inputValue();
    console.log(`Reference No: ${reference}   attempting ${CUSTOMER_TYPE} on ${MOBILE}`);

    await addCustomerPage.selectDropdown('CustomerTypeID', { label: CUSTOMER_TYPE });
    await page.waitForTimeout(2500);

    // The number is validated server-side on blur, and again when the OTP is
    // requested. Both are read; neither is asserted, because the point is to
    // find out what the app does rather than to confirm a guess.
    const field = page.locator('#SaveCustomerModel_CustomerMobileNumber');
    await field.fill(MOBILE);
    await field.blur();
    await page.waitForTimeout(3000);
    const onBlur = await addCustomerPage.dismissValidationDialogs();
    console.log(`on blur: ${onBlur.length ? onBlur.join(' | ') : '(no dialog)'}`);

    await addCustomerPage.generateMobileOtp.click({ timeout: 15_000 }).catch(() => undefined);
    await page.waitForTimeout(3500);
    const afterSend = await addCustomerPage.dismissValidationDialogs();
    const otpAppeared = await page.locator('#MobileOTP')
      .waitFor({ state: 'visible', timeout: 15_000 }).then(() => true).catch(() => false);

    console.log(`after Generate OTP: ${afterSend.length ? afterSend.join(' | ') : '(no dialog)'}`);
    console.log(`OTP box: ${otpAppeared ? 'appeared' : 'never appeared'}`);

    if (!otpAppeared) {
      console.log(
        `\nRESULT: Add Customer REFUSED ${MOBILE} for a ${CUSTOMER_TYPE}. ` +
          `A mobile that already logs in as an FP_ADMIN cannot be onboarded as ` +
          `a customer — the two flows agree in this direction.`
      );
      return;
    }

    // Verifying the OTP is the last gate before the record is real. If it also
    // passes, the app has committed to the number rather than merely displayed
    // a box.
    await addCustomerPage.fillInput(page.locator('#MobileOTP'), TEST_OTP);
    await addCustomerPage.verifyMobileOtp.click({ timeout: 15_000 }).catch(() => undefined);
    await page.waitForTimeout(2500);
    const afterVerify = await addCustomerPage.dismissValidationDialogs();
    const verified = await addCustomerPage.verifyMobileOtp
      .textContent().then(t => /verified/i.test(t ?? '')).catch(() => false);

    console.log(`after Verify OTP: ${afterVerify.length ? afterVerify.join(' | ') : '(no dialog)'}`);
    console.log(
      `\nRESULT: Add Customer ACCEPTED ${MOBILE} for a ${CUSTOMER_TYPE} — OTP ` +
        `sent${verified ? ' and verified' : ', verification inconclusive'}. A ` +
        `Nayara administrator's own mobile can be enrolled as a customer, while ` +
        `the same number is refused a second staff user. The two flows do not ` +
        `share a rule.`
    );

    const after = await MatrixDb.snapshot(MOBILE);
    console.log(`\n${MatrixDb.format(`AFTER — ${MOBILE}`, after)}`);
  });
});
