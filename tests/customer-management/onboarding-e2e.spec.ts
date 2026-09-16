import { expect } from '@playwright/test';
import { test } from '../../src/fixtures/page.fixtures';
import { description, epic, feature, owner, parameter, severity, story, tms } from 'allure-js-commons';
import { AddCustomerPage } from '../../src/pages/customer-management/add-customer.page';
import { ApproveCustomerPage } from '../../src/pages/customer-management/approve-customer.page';
import { ConsentPage } from '../../src/pages/customer-management/consent.page';
import { ReviewCustomerPage } from '../../src/pages/customer-management/review-customer.page';
import { DbHelper } from '../../src/helpers/db.helper';
import { runTag, freshMobile } from '../../src/helpers/test-identity';
import { DSA, TSM, FP_ADMIN, TEST_OTP } from '../../src/config/accounts';
import * as path from 'path';

/**
 * A customer, from a DSA's form to a usable account.
 *
 * Every other suite here tests one screen against customers that already
 * existed. This follows one customer the whole way, which is the only thing
 * that catches a customer that onboards cleanly and is then unusable — the
 * defect no single-screen test can see.
 *
 * ── Three hands, deliberately ─────────────────────────────────────────────
 * The credentials workbook describes onboarding as a three-stage chain: a DSA
 * raises the form, a TSM reviews it, and only then does a checker approve.
 * Running it with three separate accounts is the point — with one account the
 * chain still completes, but four-eyes separation is never exercised and the
 * suite cannot tell a working control from an absent one.
 *
 *   DSA   9611200199   maker      5 menu entries; onboarding only
 *   TSM   9612200200   reviewer   28 entries; also owns Retail Outlet
 *   FP    loadtest_006 checker    109 entries
 *
 * ── The status walk ───────────────────────────────────────────────────────
 * Consent comes BEFORE approval, which is the reverse of what the screens
 * suggest:
 *
 *   submit   -> 107  Consent Pending
 *   consent  -> 105  Pending for Approval
 *   approve  -> 101  Active, and a CustomerMaster row exists
 *
 * Each hop is asserted against the database rather than against a toast,
 * because this application's success messages have proved unreliable narrators
 * — /Customer/ValidatePanNumber answers "message":"Success" for a PAN it
 * rejects.
 *
 * ── This writes, and the records are real ─────────────────────────────────
 * It creates a genuine customer in QA and moves it through a genuine approval
 * queue. Every record carries a runTag so it can be found and cleaned up.
 */

const UPLOAD = path.join(__dirname, '../../test-data/files/sample-doc.pdf');

/**
 * The division whose TSM we hold credentials for, and its state.
 *
 * Review is hierarchical: a form is reviewable by a TSM of the same division.
 * TSMDivisionMapping maps all 50 divisions, so this is not about finding one
 * with a reviewer — it is about choosing the one whose reviewer we can sign in
 * as. 9612200200 reviewed reference 1000513752 in division 17, Gurgaon.
 */
const REVIEW_DIVISION = process.env.E2E_DIVISION ?? 'Gurgaon';
// The state list holds region codes, not state names: HR_HP_PB is
// Haryana/Himachal/Punjab, and it is what filters the division list down to
// Gurgaon, Ludhiana and Solan. Asking for "Haryana" matches nothing.
const REVIEW_STATE = process.env.E2E_STATE ?? 'HR_HP_PB';

interface RawRow {
  ReferenceNo: string;
  Status: number;
  CustomerId: string | null;
  MobileNo: string | null;
}

async function applicationFor(reference: string): Promise<RawRow | undefined> {
  const rows = await DbHelper.query<RawRow>(
    `SELECT TOP 1 ReferenceNo, Status, CustomerId, MobileNo
       FROM dbo.RawCustomerMaster
      WHERE ReferenceNo = @reference
      ORDER BY Id DESC`,
    { reference }
  );
  return rows[0];
}

async function customerFor(reference: string): Promise<{ CustomerId: string; Status: number } | undefined> {
  const rows = await DbHelper.query<{ CustomerId: string; Status: number }>(
    `SELECT TOP 1 CustomerId, Status FROM dbo.CustomerMaster
      WHERE ReferenceNo = @reference ORDER BY Id DESC`,
    { reference }
  );
  return rows[0];
}

test.use({ storageState: { cookies: [], origins: [] } });

test.describe('Customer onboarding end to end @customer-management @e2e', () => {
  // One customer carried across four tests, so order matters and a failed hop
  // must stop the ones that depend on it. This is the case serial mode is for.
  test.describe.configure({ mode: 'serial' });

  const tag = runTag();
  const customerMobile = freshMobile();
  const bankAccountNumber = '1234567890';
  let reference = '';

  test.beforeEach(async () => {
    await epic('Customer Management');
    await feature('Onboarding end to end');
    await owner('QA Team');
    await parameter('Run tag', tag);
  });

  test('a DSA raises a customer onboarding form', async ({ loginPage, dashboardPage, page }) => {
    test.setTimeout(420_000);
    await tms('E2E-01');
    await story('Maker');
    await severity('critical');
    await parameter('Maker', `${DSA.username} (${DSA.role})`);
    await description(
      'The DSA is the narrowest role in the chain — five menu entries, ' +
        'onboarding only — which is what makes it the honest maker to test ' +
        'with. Running the wizard as an FP Admin proves the wizard works for ' +
        'someone who can do everything.'
    );

    await loginPage.navigate();
    await loginPage.login(DSA.username, DSA.password);
    await dashboardPage.assertDashboardLoaded();

    const wizard = new AddCustomerPage(page);
    await wizard.gotoWizard();

    reference = await wizard.referenceNo.inputValue();
    console.log(`Reference ${reference}  mobile ${customerMobile}  tag ${tag}`);
    expect(reference, 'the wizard did not generate a reference number').toMatch(/\d{6,}/);

    await wizard.fillBasicInformation({
      customerType: 'Fleet',
      // Gurgaon, because that is the division our TSM actually reviews — it
      // moved reference 1000513752 to 105 from there. Left to default, the
      // wizard picks Hyderabad and the form waits in a queue no TSM we can log
      // in as will ever open.
      state: REVIEW_STATE,
      division: REVIEW_DIVISION,
      panNumber: AddCustomerPage.TEST_PAN,
      panDob: '1990-01-01',
      businessName: `${tag} E2E Co`,
      businessEmail: `${tag.toLowerCase()}@example.com`,
      customerName: `${tag} Customer`,
      customerEmail: `${tag.toLowerCase()}.cust@example.com`,
      customerMobile,
      otp: TEST_OTP,
      idProofNumber: AddCustomerPage.TEST_PAN,
      bankName: 'HDFC',
      bankAccountHolder: `${tag} Customer`,
      bankAccountNumber,
      ifscCode: 'HDFC0002048',
      uploadFile: UPLOAD,
    });

    await wizard.saveAsDraft();
    await wizard.goToAddressStep();
    await wizard.fillAddress({
      pinCode: '201304',
      businessAddress: `${tag} E2E Address`,
      addressProofNumber: '1234567890',
      uploadFile: UPLOAD,
    });
    await wizard.goToBranchStep();
    await wizard.fillBranch({ pinCode: '201304', managerName: `${tag} Manager` });
    await wizard.saveBranch();
    await wizard.goToMeetingStep();
    await wizard.fillMeetingDetails(new Date().toISOString().slice(0, 10));
    await wizard.submit();

    const banner = page.locator('.modal.show').filter({ hasText: /successfully submitted/i }).first();
    await expect(banner, 'the wizard did not confirm the submission').toBeVisible({ timeout: 30_000 });

    const application = await applicationFor(reference);
    expect(
      application,
      `No RawCustomerMaster row exists for reference ${reference}. The screen ` +
        `reported a successful submission, so the application was accepted by ` +
        `the UI and lost before it reached the database.`
    ).toBeTruthy();

    expect(
      application!.Status,
      `The application is at status ${application!.Status}; a submitted form ` +
        `should be at 107, Consent Pending, waiting for the customer. If it is ` +
        `already at 105 the consent step was skipped, which would mean a ` +
        `customer is onboarded without accepting the terms.`
    ).toBe(107);
  });

  test('the customer gives consent', async ({ page }) => {
    test.setTimeout(300_000);
    await tms('E2E-02');
    await story('Consent');
    await severity('critical');
    await parameter('Customer mobile', customerMobile);
    await description(
      'The step that belongs to the customer, not the back office. The link ' +
        'arrives by SMS and no amount of clicking in the admin screens advances ' +
        'it. The token is recovered from dbo.UserSMSLog; the URL is rebuilt ' +
        'against the environment under test, because the SMS itself points at ' +
        'UAT regardless of where it was sent from.'
    );

    expect(reference, 'the maker step did not produce a reference').not.toBe('');

    await ConsentPage.completeFor(page, customerMobile, TEST_OTP);

    // 102, "Pending for Review" — not 105.
    //
    // Measured, and it is the whole reason for running this chain as a DSA.
    // A DSA's form does not go straight to the checker: StatusMaster calls 102
    // "Pending for Review", and the credentials workbook says a DSA form "must
    // go through TSM Reviewer before Checker". So the walk depends on who
    // raised it:
    //
    //   DSA raises        107 -> 102 -> 105 -> 101
    //   FP Admin raises   107 -> 105 -> 101
    //
    // LeadStatusLog carries the second path from June — 107 to 105 with
    // "Customer consent recorded; pending for approval" — which is why
    // consent.page.ts documents consent as leaving the application at 105.
    // That is true only for a maker who needs no review, and this test would
    // have quietly encoded the same half-truth had it been run as an FP Admin.
    const application = await applicationFor(reference);
    expect(
      application!.Status,
      `After consent, a DSA-raised application should be at 102, Pending for ` +
        `Review, waiting for a TSM. It is at ${application!.Status}. If it is ` +
        `at 105 the review stage was skipped and the form went straight to the ` +
        `checker — which would mean a third-party agent's application reaches ` +
        `approval without the review the workbook requires.`
    ).toBe(102);
  });

  /**
   * Diagnostic for now, deliberately.
   *
   * Both DSA and TSM carry a "Review Onboarding" entry pointing at
   * /Customer/CustomerOnboardingReviewer, and the workbook says a DSA's form
   * "must go through TSM Reviewer before Checker". No suite has ever opened
   * that screen, so what it does to an application is unmeasured.
   *
   * This asserts only that the application reaches the reviewer's queue, and
   * prints the controls it offers. Asserting a review action before knowing
   * what the screen does would be writing the test from the workbook rather
   * than from the application — which is how the "DSA cannot submit" note got
   * into this codebase.
   */
  test('the application reaches the TSM reviewer queue', async ({ loginPage, dashboardPage, page }) => {
    test.setTimeout(300_000);
    await tms('E2E-03');
    await story('Reviewer');
    await severity('normal');
    await parameter('Reviewer', `${TSM.username} (${TSM.role})`);

    await loginPage.navigate();
    await loginPage.login(TSM.username, TSM.password);
    await dashboardPage.assertDashboardLoaded();

    await page.goto('/Customer/CustomerOnboardingReviewer', {
      waitUntil: 'domcontentloaded',
      timeout: 45_000,
    });
    await page.waitForTimeout(3_000);

    const seen = await page.evaluate(() => {
      const onScreen = (el: Element) => {
        const r = (el as HTMLElement).getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      };
      const txt = (el: Element | null) => (el?.textContent || '').replace(/\s+/g, ' ').trim();
      return {
        refused: /unauthorized access|do not have permission/i.test(document.body.innerText || ''),
        title: txt(Array.from(document.querySelectorAll('p.box-head-title')).find(onScreen) ?? null),
        buttons: [...new Set(Array.from(document.querySelectorAll('button')).filter(onScreen).map(b => txt(b)))],
        fields: Array.from(document.querySelectorAll('input:not([type=hidden]), select'))
          .filter(onScreen)
          .map(f => (f as HTMLInputElement).id || (f as HTMLInputElement).name)
          .filter(Boolean),
        rows: document.querySelectorAll('tbody tr').length,
        body: (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 400),
      };
    });

    console.log(`Reviewer screen: "${seen.title}"  ${seen.rows} row(s)`);
    console.log(`  fields  : ${seen.fields.join(', ')}`);
    console.log(`  buttons : ${seen.buttons.join(' | ')}`);

    expect(seen.refused, 'a TSM was refused its own Review Onboarding screen').toBe(false);

    // The queue opens on a default window that need not contain a form raised
    // seconds ago, so search for it rather than reading whatever happens to be
    // on the first page. An unsearched grid showing "1 row" says nothing about
    // whether our application is in it.
    await page.locator('#corReferenceId').fill(reference);
    await page.locator('button:has-text("Search")').first().click();
    await page.waitForTimeout(3_500);

    const found = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('tbody tr'));
      return rows.map(r => ({
        text: (r.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 200),
        links: Array.from(r.querySelectorAll('a, button'))
          .map(a => (a.textContent || '').replace(/\s+/g, ' ').trim())
          .filter(Boolean),
        hrefs: Array.from(r.querySelectorAll('a[href]'))
          .map(a => a.getAttribute('href') || '')
          .filter(h => h && h !== '#'),
      }));
    });

    console.log(`  after searching ${reference}: ${found.length} row(s)`);
    for (const row of found) {
      console.log(`    ${row.text}`);
      if (row.links.length) console.log(`      actions: ${row.links.join(' | ')}`);
      if (row.hrefs.length) console.log(`      hrefs  : ${row.hrefs.join(' | ')}`);
    }

    // Open the review page itself and record what it offers, before asserting
    // anything about it. This screen has never been exercised, so what "review"
    // does here is unmeasured.
    if (found.some(r => r.text.includes(reference))) {
      await page.goto(`/Customer/ReviewCustomerDetails?ReferenceNo=${reference}`, {
        waitUntil: 'domcontentloaded',
        timeout: 45_000,
      });
      await page.waitForTimeout(3_500);

      const review = await page.evaluate(() => {
        const onScreen = (el: Element) => {
          const r = (el as HTMLElement).getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        };
        const txt = (el: Element | null) => (el?.textContent || '').replace(/\s+/g, ' ').trim();
        return {
          title: txt(Array.from(document.querySelectorAll('p.box-head-title')).find(onScreen) ?? null),
          buttons: Array.from(document.querySelectorAll('button, input[type=submit], a.btn'))
            .filter(onScreen)
            .map(b => `${(b as HTMLElement).id || '(no id)'}:"${txt(b) || (b as HTMLInputElement).value}"`),
          fields: Array.from(document.querySelectorAll('input:not([type=hidden]), select, textarea'))
            .filter(onScreen)
            .map(f => (f as HTMLInputElement).id || (f as HTMLInputElement).name)
            .filter(Boolean),
        };
      });
      console.log(`  review page "${review.title}"`);
      console.log(`    buttons: ${review.buttons.join(' | ')}`);
      console.log(`    fields : ${review.fields.join(', ')}`);
    }

    expect(
      found.some(r => r.text.includes(reference)),
      `Reference ${reference} is at status 102, Pending for Review, but it is ` +
        `not in this TSM's queue. Review is hierarchical — a TSM sees its own ` +
        `division — so either the form was raised in a division this account ` +
        `does not cover, or it has reached nobody at all.\n\n` +
        `Measured: 9612200200 reviews division 17, Gurgaon. A form left to the ` +
        `wizard's default lands on Hyderabad and waits here forever.`
    ).toBe(true);

    // Perform the review. This is what moves 102 to 105 and puts the
    // application in front of the checker.
    const reviewer = new ReviewCustomerPage(page);
    const outcome = await reviewer.review(reference);
    console.log(`  review walked ${outcome.steps} step(s): "${outcome.message}"`);

    const after = await applicationFor(reference);
    expect(
      after!.Status,
      `After review the application should be at 105, Pending for Approval. ` +
        `It is at ${after!.Status}. The reviewer walked ${outcome.steps} step(s) ` +
        `and the screen said "${outcome.message}". A review that leaves the ` +
        `application at 102 has not handed it on — the checker will never see it.`
    ).toBe(105);
  });

  test('a checker approves, and the customer becomes usable', async ({ loginPage, dashboardPage, page }) => {
    test.setTimeout(420_000);
    await tms('E2E-04');
    await story('Checker');
    await severity('critical');
    await parameter('Checker', `${FP_ADMIN.username} (${FP_ADMIN.role})`);
    await description(
      'A different account from the maker, which is the whole point of the ' +
        'stage. Approval needs the PAN and bank account retyped — the page ' +
        'compares them client-side against what the maker submitted, and ' +
        'without them Approve is silently inert.'
    );

    await loginPage.navigate();
    await loginPage.login(FP_ADMIN.username, FP_ADMIN.password);
    await dashboardPage.assertDashboardLoaded();

    const approver = new ApproveCustomerPage(page);
    const outcome = await approver.approve(reference, {
      pan: AddCustomerPage.TEST_PAN,
      bankAccountNumber,
    });
    console.log(`Approval outcome: ${JSON.stringify(outcome)}`);

    const customer = await customerFor(reference);
    expect(
      customer,
      `No CustomerMaster row exists for reference ${reference} after approval. ` +
        `The application was approved but no customer was created, which is the ` +
        `failure a single-screen test cannot see: onboarding reported success ` +
        `and produced nothing usable.`
    ).toBeTruthy();

    expect(
      customer!.Status,
      `The customer was created at status ${customer!.Status}; an approved ` +
        `customer should be 101 (Active).`
    ).toBe(101);

    console.log(`Customer ${customer!.CustomerId} is active. Reference ${reference}, tag ${tag}.`);
  });
});
