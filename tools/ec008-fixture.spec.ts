import * as path from 'path';
import { test } from '../src/fixtures/page.fixtures';
import { AddCustomerPage } from '../src/pages/customer-management/add-customer.page';
import { ConsentPage } from '../src/pages/customer-management/consent.page';
import { ApproveCustomerPage } from '../src/pages/customer-management/approve-customer.page';
import { MatrixDb } from '../src/helpers/matrix-db.helper';
import { DbHelper } from '../src/helpers/db.helper';
import { CUSTOMER_ADMIN, TEST_OTP } from '../src/config/accounts';

/**
 * Manufactures the state EC-008 needs, because no mobile in QA has it.
 *
 * EC-008 asks what Add User does when a mobile carries an *active OD* alongside
 * an *inactive non-OD*. That shape exists nowhere in the environment — checked
 * against the whole table, not a sample: 14 mobiles carry both an OD and a
 * non-OD and all 27 of their non-OD records are Active, while the only 7
 * inactive customers in the database share a number with no OD at all.
 *
 * A probe established the first thing worth knowing on its own: Add Customer
 * *will* send an OTP to a number whose only record is an inactive FO. So the two
 * flows do not share a duplicate-mobile rule — Add User refuses this exact
 * number while Add Customer accepts it — and the fixture is buildable.
 *
 * This spec builds it, in the order the product enforces:
 *   1. onboard an OD on the inactive FO's mobile
 *   2. give consent with the token the app SMSes (read from UserSMSLog)
 *   3. approve it, which is what makes the customer Active
 * and then reports the resulting shape so EC-008 can be pointed at it.
 *
 * Not part of the signoff suite. It lives under tools/ rather than tests/
 * because it WRITES REAL RECORDS into the environment — a customer that stays
 * there afterwards — and a data-creating script sitting in the test tree is one
 * broad --grep away from running unintentionally. Run deliberately:
 *   TOOLS=true ENV=qa npx playwright test --project=tools
 */

test.use({ storageState: { cookies: [], origins: [] } });
test.describe.configure({ mode: 'serial' });

const { username: USER, password: PASS } = CUSTOMER_ADMIN;
const OTP = TEST_OTP;
const UPLOAD = path.join(__dirname, '../../test-data/files/sample-doc.pdf');

/**
 * A mobile whose only customer record is an inactive FO.
 *
 * One of the three that qualify. The other four inactive customers sit on
 * numbers that also carry an *active* FO, which would block for a reason having
 * nothing to do with the inactive record and would prove nothing.
 */
const MOBILE = process.env.EC008_MOBILE ?? '9876896688';

test.describe('EC-008 fixture @user-management @fixture', () => {
  test('EC-008 fixture — onboard an OD onto an inactive FO’s mobile', async ({
    loginPage, dashboardPage, addCustomerPage, page,
  }) => {
    test.setTimeout(600_000);

    const before = await MatrixDb.snapshot(MOBILE);
    console.log(MatrixDb.format(`BEFORE — ${MOBILE}`, before));

    await loginPage.navigate();
    await loginPage.login(USER, PASS);
    await dashboardPage.assertDashboardLoaded();

    await addCustomerPage.gotoWizard();
    const reference = await addCustomerPage.referenceNo.inputValue();
    const tag = `AUTO${String(Date.now()).slice(-8)}`;
    console.log(`Reference No: ${reference}   tag: ${tag}   mobile: ${MOBILE}`);

    // ── The OD form ─────────────────────────────────────────────────────────
    // OD renders a different field set from Fleet: one page, address inline, and
    // no Business Name, GST block, ID proof or segment fields. Driving the Fleet
    // sequence here dies on a hidden Business Name box, which is what the first
    // attempt at this did.
    await addCustomerPage.selectDropdown('CustomerTypeID', { label: 'OD' });
    await page.waitForTimeout(2500);
    await addCustomerPage.selectDropdown('CustomerSubTypeID', {});
    await addCustomerPage.selectDropdown('CustStateID', {});
    await addCustomerPage.selectDropdown('CustDivisionID', {});
    await addCustomerPage.setRelatedParty(false);

    await addCustomerPage.enterAddressPinCode('201304');
    await page.waitForTimeout(2000);
    await addCustomerPage.fillInput(addCustomerPage.businessAddress, `${tag} EC008 Address`);
    await addCustomerPage.selectDropdown('AddressProofType', { avoid: /^others$/i });
    await addCustomerPage.fillInput(page.locator('#AddressProofNo'), '1234567890');
    await addCustomerPage.uploadAddressProof(UPLOAD);

    await addCustomerPage.fillInput(addCustomerPage.customerName, `${tag} EC008`);
    await addCustomerPage.selectDropdown('CustomerLanguagePreference', {});
    await addCustomerPage.fillInput(addCustomerPage.customerEmail, `${tag.toLowerCase()}@example.com`);

    // There is no Type Of Business selector on the OD form, so the PAN entity
    // rule that governs the Fleet wizard does not apply here; the individual
    // 'P' PAN is the right shape.
    await page.locator('#SaveCustomerModel_PanDOB').fill('1990-01-01');
    await addCustomerPage.fillInput(addCustomerPage.panNumber, AddCustomerPage.TEST_PAN);
    await addCustomerPage.panNumber.blur();
    await page.waitForTimeout(1500);
    console.log(`after PAN: ${(await addCustomerPage.dismissValidationDialogs()).join(' | ') || '(no dialog)'}`);
    await addCustomerPage.uploadPanCard(UPLOAD);

    await addCustomerPage.verifyCustomerMobile(MOBILE, OTP);

    await addCustomerPage.fillInput(addCustomerPage.bankName, 'HDFC');
    await addCustomerPage.fillInput(addCustomerPage.bankAccountHolder, `${tag} EC008`);
    await addCustomerPage.fillInput(addCustomerPage.bankAccountNumber, '1234567890');
    await addCustomerPage.fillInput(addCustomerPage.ifscCode, 'HDFC0002048');
    await addCustomerPage.uploadBankProof(UPLOAD);

    // ── Submit ──────────────────────────────────────────────────────────────
    // #btnAdd is the Fleet wizard's submit and does not exist on the OD form, so
    // the control is found rather than assumed. Everything the form offers is
    // logged first: a wrong guess here looks exactly like a rejected submission.
    const buttons = await page.evaluate(() => {
      const out: { tag: string; id: string; text: string; visible: boolean }[] = [];
      for (const el of Array.from(document.querySelectorAll('button, input[type=submit], a.btn'))) {
        const node = el as HTMLElement;
        const style = getComputedStyle(node);
        out.push({
          tag: node.tagName.toLowerCase(),
          id: node.id || '(no id)',
          text: (node.textContent || (node as HTMLInputElement).value || '').trim().slice(0, 40),
          visible: style.display !== 'none' && !!node.getClientRects().length,
        });
      }
      return out.filter(b => b.visible);
    });
    console.log('\n--- visible controls on the OD form ---');
    for (const b of buttons) console.log(`  ${b.tag}#${b.id}  "${b.text}"`);

    // The OD form carries a hidden #btnAdd *and* a visible unlabelled Submit.
    // Matching on id alone finds the hidden one and waits out the timeout
    // looking like a rejected submission, so visibility is part of the selector.
    const submit = page
      .locator('button:visible')
      .filter({ hasText: /^\s*Submit\s*$/ })
      .first();
    await submit.click({ timeout: 20_000 });
    await page.waitForTimeout(4000);
    const said = await addCustomerPage.dismissValidationDialogs();
    console.log(`submit said: ${said.join(' | ') || '(nothing)'}`);

    // The form validates client-side and returns silently when a required field
    // is unfilled, so a still-visible Submit is the signal that nothing was sent.
    const stillOnForm = await addCustomerPage.submitButton.isVisible().catch(() => false);
    const missing = await page.evaluate(() => {
      const out: string[] = [];
      for (const el of Array.from(document.querySelectorAll('[data-val-required]'))) {
        const input = el as HTMLInputElement;
        const style = getComputedStyle(input);
        const visible = style.display !== 'none' && !!input.getClientRects().length;
        if (visible && !(input.value || '').trim()) out.push(input.id || input.name);
      }
      return out;
    });
    console.log(`still on the form: ${stillOnForm}`);
    console.log(`unfilled required fields: ${missing.join(', ') || '(none)'}`);

    const raw = await DbHelper.query(
      `SELECT ReferenceNo, MobileNo, Status, CustomerType
         FROM dbo.RawCustomerMaster WHERE MobileNo = '${MOBILE}' ORDER BY ReferenceNo DESC`
    );
    console.log('\n--- onboarding rows on that mobile now ---');
    for (const r of raw) console.log(' ', JSON.stringify(r));

    const after = await MatrixDb.snapshot(MOBILE);
    console.log(`\n${MatrixDb.format(`AFTER — ${MOBILE}`, after)}`);
  });

  /**
   * Carries the application the rest of the way to Active.
   *
   * Submission leaves it at 107 (Consent Pending); consent moves it to 105
   * (Pending for Approval) and only approval makes it 101. EC-008 needs the OD
   * *active*, so a record parked at 107 would not arm the case — it would sit in
   * RawCustomerMaster, which the procedure's first check ignores entirely.
   *
   * Split from the onboarding test so a failure here does not obscure whether
   * the application was created, and so it can be re-run against an application
   * that already exists via EC008_REFERENCE.
   */
  test('EC-008 fixture — consent and approve the OD application', async ({
    loginPage, dashboardPage, page,
  }) => {
    test.setTimeout(600_000);

    const pending = await DbHelper.query<{ ReferenceNo: number; Status: number }>(
      `SELECT TOP 1 rcm.ReferenceNo, rcm.Status
         FROM dbo.RawCustomerMaster rcm
         JOIN dbo.CustomerTypeMaster ctm ON ctm.Id = rcm.CustomerType
        WHERE rcm.MobileNo = '${MOBILE}' AND ctm.CustomerTypeCode = 1004
        ORDER BY rcm.ReferenceNo DESC`
    );
    const reference = process.env.EC008_REFERENCE ?? String(pending[0]?.ReferenceNo ?? '');
    if (!reference) throw new Error(`No OD application exists on ${MOBILE} to approve.`);
    console.log(`application ${reference}, currently at status ${pending[0]?.Status}`);

    // ── Consent ─────────────────────────────────────────────────────────────
    // The link is SMSed to the customer; the token is read from UserSMSLog
    // because no phone is involved. The QA message names the UAT host, but the
    // token itself is host-agnostic, so it is opened against the configured one.
    // Consent is a one-way step: once given, the application leaves 107 and the
    // link stops rendering, so re-running this blindly fails on a missing
    // Continue button and looks like a broken consent page rather than a step
    // that is already done. The status decides whether it still needs doing.
    if (pending[0]?.Status === 107) {
      const consent = new ConsentPage(page);
      const token = await ConsentPage.tokenFor(MOBILE);
      console.log(`consent token: ${token.slice(0, 12)}…`);
      await consent.open(token);
      await consent.give(OTP);

      const afterConsent = await DbHelper.query(
        `SELECT ReferenceNo, Status FROM dbo.RawCustomerMaster WHERE ReferenceNo = ${reference}`
      );
      console.log(`after consent: ${JSON.stringify(afterConsent)}`);
    } else {
      console.log(`consent already given — application is at ${pending[0]?.Status}, skipping.`);
    }

    // ── Approval ────────────────────────────────────────────────────────────
    await loginPage.navigate();
    await loginPage.login(USER, PASS);
    await dashboardPage.assertDashboardLoaded();

    const approveCustomerPage = new ApproveCustomerPage(page);
    await approveCustomerPage.openQueue();
    await approveCustomerPage.openReview(reference);
    const outcome = await approveCustomerPage.approve(reference, {
      pan: AddCustomerPage.TEST_PAN,
      bankAccountNumber: '1234567890',
      remarks: 'Automated EC-008 fixture build.',
    });
    console.log(`approval: approved=${outcome.approved} message="${outcome.message}"`);

    // The database decides, not the dialog — an empty message once read as
    // success while the record sat untouched.
    const final = await MatrixDb.snapshot(MOBILE);
    console.log(`\n${MatrixDb.format(`FINAL — ${MOBILE}`, final)}`);

    const od = final.customers.filter(c => c.customerTypeCode === 1004 && c.status === 101);
    const inactiveNonOd = final.customers.filter(c => c.customerTypeCode !== 1004 && c.status === 104);
    console.log(
      od.length && inactiveNonOd.length
        ? `\nRESULT: ${MOBILE} now carries an ACTIVE OD (${od[0].customerId}) alongside an ` +
            `INACTIVE ${inactiveNonOd[0].customerTypeCode} (${inactiveNonOd[0].customerId}). ` +
            `This is EC-008's shape. Run the case with ` +
            `MATRIX_FIXTURES_OD_ACTIVE_FLEET_INACTIVE=${MOBILE}`
        : `\nRESULT: the shape is not yet in place — active OD: ${od.length}, ` +
            `inactive non-OD: ${inactiveNonOd.length}. EC-008 cannot run against ` +
            `this mobile until both are true.`
    );
  });
});
