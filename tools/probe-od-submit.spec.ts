import { test } from '../src/fixtures/page.fixtures';
import { AddCustomerPage } from '../src/pages/customer-management/add-customer.page';
import { DSA, TEST_OTP } from '../src/config/accounts';
import * as path from 'path';

/**
 * Why the Submit on an OD enrolment does not confirm.
 *
 * The draft saves ("Customer data has been saved successfully") and the record
 * appears in RawCustomerMaster at status 103 with CustomerDivisionId = 0. The
 * Submit that follows produces no dialog, no confirmation and no status change —
 * which could be a click landing on the wrong control, a client-side validation
 * that reports inline, or a post the server rejects quietly.
 *
 * So this clicks it and records everything at once: what was posted, what came
 * back, what the page said, and what the record looks like afterwards.
 *
 *   TOOLS=true ENV=qa npx playwright test --project=tools --grep "probe od submit"
 */

test.use({ storageState: { cookies: [], origins: [] } });

test.describe('Tools — probes @tools', () => {
  test('probe od submit', async ({ loginPage, dashboardPage, addCustomerPage, page }) => {
    test.setTimeout(420_000);

    await loginPage.navigate();
    await loginPage.login(DSA.username, DSA.password);
    await dashboardPage.assertDashboardLoaded();
    await addCustomerPage.gotoWizard();

    const reference = await addCustomerPage.referenceNo.inputValue();
    const tag = `PROBE${String(Date.now()).slice(-6)}`;
    console.log(`  reference ${reference}`);

    await addCustomerPage.fillOdBasicInformation({
      state: 'HR_HP_PB',
      pinCode: '201304',
      businessAddress: `${tag} address`,
      addressProofNumber: '1234567890',
      panNumber: AddCustomerPage.freshPan(),
      panDob: '1990-01-01',
      customerName: `${tag} Customer`,
      customerEmail: `${tag.toLowerCase()}@example.com`,
      customerMobile: `9${String(Date.now()).slice(-9)}`,
      otp: TEST_OTP,
      bankName: 'HDFC',
      bankAccountHolder: `${tag} Customer`,
      bankAccountNumber: '1234567890',
      ifscCode: 'HDFC0002048',
      uploadFile: path.join(__dirname, '../test-data/files/sample-doc.pdf'),
    });

    page.on('request', r => {
      if (/\/Customer\//i.test(r.url()) && r.method() === 'POST') {
        console.log(`    -> POST ${r.url()}`);
      }
    });
    page.on('response', async r => {
      if (/\/Customer\//i.test(r.url()) && r.request().method() === 'POST') {
        console.log(`    <- ${r.status()} ${r.url().split('/').pop()}: ` +
          `${(await r.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 300)}`);
      }
    });

    await addCustomerPage.saveAsDraft();
    await addCustomerPage.waitForDialog(5_000);
    console.log(`  draft: ${(await addCustomerPage.dismissValidationDialogs()).join(' | ') || 'nothing said'}`);

    // What is actually on screen to click, by tag, class and text.
    const candidates = await page.evaluate(() =>
      Array.from(document.querySelectorAll('button, a.btn, input[type="submit"]'))
        .filter(e => !!(e as HTMLElement).offsetParent)
        .filter(e => /submit/i.test(e.textContent || '') || /submit/i.test((e as HTMLInputElement).value || ''))
        .map(e => `<${e.tagName.toLowerCase()} id="${e.id}" class="${e.className}"> "${(e.textContent || '').trim()}"`)
    );
    console.log(`  visible submit controls:`);
    for (const c of candidates) console.log(`    ${c}`);

    await addCustomerPage.submitOd();
    await addCustomerPage.settle();
    await addCustomerPage.waitForDialog(15_000);
    console.log(`  submit: ${(await addCustomerPage.dismissValidationDialogs()).join(' | ') || 'nothing said'}`);
    console.log(`  inline errors: ${(await addCustomerPage.visibleFieldErrors()).join(' | ') || 'none'}`);
    console.log(`  url now: ${page.url()}`);
    console.log(`\n  REFERENCE TO CHECK: ${reference}`);
  });
});
