import { expect } from '@playwright/test';
import { test } from '../src/fixtures/page.fixtures';
import { ConsentPage } from '../src/pages/customer-management/consent.page';
import { ReviewCustomerPage } from '../src/pages/customer-management/review-customer.page';
import { ApproveCustomerPage } from '../src/pages/customer-management/approve-customer.page';
import { FP_ADMIN, TSM, TEST_OTP } from '../src/config/accounts';

/**
 * Turns the two-region OD applications into OD logins that can actually be used.
 *
 * The applications exist but nothing can sign in as them: an OD application sits at
 * 107, Consent Pending, and a customer's login only exists once approval creates its
 * user. So this walks the rest of the chain, which for a DSA-raised form is
 *
 *   107 Consent Pending -> 102 Pending for Review -> 105 Pending for Approval -> 101 Active
 *
 * consent by the customer, review by a TSM, approval by a checker who is not the maker.
 *
 * Two things here are worth knowing before reading a failure.
 *
 * The reviewer stage is the interesting one for OD. A form only advances if a reviewer
 * can see it, and these applications carry the dummy divisions 61 (GJ_I) and 53
 * (WB_NE) — divisions no TSM is mapped to. The Gurgaon TSM is used deliberately:
 * if OD really does bypass location filtering, as FP-OD-1 found, then this TSM can
 * review a Gujarat and a Bengal application, and the walk succeeds *because* of the
 * defect. If review turns out to be properly scoped, this stage is where it stops, and
 * that is worth knowing too — it would mean OD applications in those states have no
 * reviewer at all.
 *
 * Approval needs the PAN and bank account retyped. The page compares them client-side
 * against what the maker submitted, and without them Approve is silently inert — no
 * message, no request. They are passed in per application below.
 *
 *   TOOLS=true ENV=qa npx playwright test --project=tools --grep "create od logins"
 */

test.use({ storageState: { cookies: [], origins: [] } });
test.describe.configure({ mode: 'default' });

/** The two applications raised for the hierarchy test, with what approval will ask for. */
const APPLICATIONS = [
  {
    place: 'Ahmedabad', reference: process.env.OD_AHMEDABAD_REF ?? '1000514990',
    mobile: process.env.OD_AHMEDABAD_MOBILE ?? '9149024359',
    pan: process.env.OD_AHMEDABAD_PAN ?? 'HSBPP4359Q',
    bankAccountNumber: process.env.OD_AHMEDABAD_BANK ?? '1234567890',
    state: 'GJ_I', dummyDivision: 61,
  },
  {
    place: 'Kolkata', reference: process.env.OD_KOLKATA_REF ?? '1000514991',
    mobile: process.env.OD_KOLKATA_MOBILE ?? '9149056894',
    pan: process.env.OD_KOLKATA_PAN ?? 'HTMPH6894D',
    bankAccountNumber: process.env.OD_KOLKATA_BANK ?? '1234567890',
    state: 'WB_NE', dummyDivision: 53,
  },
] as const;

test.describe('Tools — create OD logins @tools', () => {
  for (const application of APPLICATIONS) {
    test(`create od logins — ${application.place} ${application.reference}`, async ({
      page, loginPage, dashboardPage, db,
    }) => {
      test.setTimeout(900_000);

      const statusOf = async (): Promise<number | undefined> => {
        const rows = await db.query<{ Status: number }>(
          `SELECT Status FROM dbo.RawCustomerMaster WHERE ReferenceNo = ${Number(application.reference)}`
        );
        return rows[0]?.Status;
      };

      console.log(`\n=== ${application.place} ${application.reference} (${application.mobile}) ===`);
      console.log(`  starting status: ${await statusOf()}`);

      // Each stage is skipped if the application is already past it, so this can be
      // re-run against a chain that stopped halfway — which is how it was built.
      const start = await statusOf();

      // ── Consent. Belongs to the customer: the link arrives by SMS and no amount of
      // clicking in the back office advances it. The token comes from dbo.UserSMSLog
      // and the URL is rebuilt against the environment under test.
      if (start === 107) {
        await ConsentPage.completeFor(page, application.mobile, TEST_OTP);
        console.log(`  after consent: ${await statusOf()}`);
      } else {
        console.log(`  consent already given (status ${start})`);
      }

      // ── Review, by a TSM in a different state entirely. See the note above.
      await page.context().clearCookies();
      await loginPage.navigate();
      await loginPage.login(TSM.username, TSM.password);
      await dashboardPage.assertDashboardLoaded();

      if ((await statusOf()) === 102) {
        const reviewer = new ReviewCustomerPage(page);
        const review = await reviewer.review(application.reference);
        console.log(`  review (${TSM.username}): ${JSON.stringify(review)}`);

        // The decision posts asynchronously. Read immediately and the status is still
        // 102, which reads as a review that did not take — and then the approval stage
        // reports the application missing from its queue, blaming the wrong thing.
        await expect
          .poll(statusOf, { timeout: 30_000, message: 'the review never moved the status past 102' })
          .not.toBe(102);
        console.log(`  after review: ${await statusOf()}`);
      } else {
        console.log(`  review already done (status ${await statusOf()})`);
      }

      // ── Approval, by a checker who is not the maker.
      if ((await statusOf()) === 105) {
        await page.context().clearCookies();
        await loginPage.navigate();
        await loginPage.login(FP_ADMIN.username, FP_ADMIN.password);
        await dashboardPage.assertDashboardLoaded();

        const approver = new ApproveCustomerPage(page);
        const outcome = await approver.approve(application.reference, {
          pan: application.pan,
          bankAccountNumber: application.bankAccountNumber,
        });
        console.log(`  approval: ${JSON.stringify(outcome)}`);

        // Like the review decision, the approval posts asynchronously.
        await expect
          .poll(statusOf, { timeout: 30_000, message: 'the approval never moved the status past 105' })
          .not.toBe(105);
        console.log(`  after approval: ${await statusOf()}`);
      } else {
        console.log(`  approval already done (status ${await statusOf()})`);
      }

      // ── What exists now: the customer, its division, and the user that can sign in.
      const customer = await db.query(`
        SELECT c.CustomerID, c.Status, c.CustomerStateId, c.CustomerDivisionId,
               d.DivisionName, d.IsPlaceholder, c.MobileNo
        FROM dbo.CustomerMaster c
        LEFT JOIN dbo.DivisionMaster d ON d.DivisionId = c.CustomerDivisionId
        WHERE c.MobileNo = '${application.mobile}'`);
      console.log(`  customer: ${JSON.stringify(customer)}`);

      const user = await db.query(`
        SELECT u.Id, u.UserName, u.MobileNumber, ut.Code AS UserTypeCode, u.IsActive
        FROM dbo.Users u
        LEFT JOIN dbo.UserTypesMaster ut ON ut.Id = u.UserTypeId
        WHERE u.MobileNumber = '${application.mobile}'`);
      console.log(`  user: ${JSON.stringify(user)}`);

      // ── The first-time password, which arrives by SMS and is readable here.
      const sms = await db.query(`
        SELECT TOP 5 MobileNo, SMSText, CreatedOn FROM dbo.UserSMSLog
        WHERE MobileNo = '${application.mobile}' ORDER BY CreatedOn DESC`);
      console.log(`  SMS log:`);
      for (const row of sms as { MobileNo: string; SMSText: string; CreatedOn: string }[]) {
        console.log(`    ${row.CreatedOn} ${row.SMSText}`);
      }

      expect(
        await statusOf(),
        `${application.place} ${application.reference} did not reach 101, Active. The ` +
          `stage it stopped at is in the log above — if review never advanced it past ` +
          `102, the Gurgaon TSM could not see a ${application.state} application, which ` +
          `would mean OD applications on dummy division ${application.dummyDivision} ` +
          `have no reviewer.`
      ).toBe(101);
    });
  }
});
