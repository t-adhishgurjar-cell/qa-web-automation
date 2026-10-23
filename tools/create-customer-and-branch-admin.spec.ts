import { expect } from '@playwright/test';
import { test } from '../src/fixtures/page.fixtures';
import { AddCustomerPage } from '../src/pages/customer-management/add-customer.page';
import { ApproveCustomerPage } from '../src/pages/customer-management/approve-customer.page';
import { AddBranchPage } from '../src/pages/customer-management/add-branch.page';
import { ConsentPage } from '../src/pages/customer-management/consent.page';
import { ReviewCustomerPage } from '../src/pages/customer-management/review-customer.page';
import { ChangePasswordPage } from '../src/pages/change-password.page';
import { LoginPage } from '../src/pages/login.page';
import { DashboardPage } from '../src/pages/dashboard.page';
import { runTag, freshMobile } from '../src/helpers/test-identity';
import { FP_ADMIN, TSM, TEST_OTP } from '../src/config/accounts';
import * as path from 'path';

/**
 * Builds a Customer Admin and a Branch Admin on ONE mobile number, both on Nayara@1.
 *
 * The shape being reproduced is 9999303778's: a single mobile carrying one CUSTOMER_ADMIN
 * row (IsParentUser = 1) and one or more BRANCH_ADMIN rows, so the login page offers a
 * choice of role cards and a suite can sign in as either capability on one credential.
 *
 * ── Why this is not an Add User run ───────────────────────────────────────────
 * /User/AddUser offers five of the thirteen codes in UserTypesMaster, and neither of
 * these two is among them — see note 2 in add-user.page.ts. Customer-side users are a
 * side effect of onboarding: approving a customer creates its Customer Admin, and a
 * branch creates a Branch Admin with it. So the only way to get these rows is to onboard
 * a customer for real.
 *
 * ── How both roles land on one number ─────────────────────────────────────────
 * The wizard's branch step checks #uiBOMobileSameAsParent, which gives the branch the
 * parent customer's mobile rather than a second one. One enrolment therefore produces
 * both rows against one number. If approval turns out to create only the Customer Admin,
 * stage 4 falls back to /Customer/AddBranch with the same mobile typed in explicitly —
 * an FP Admin is never capped and auto-approves, so a branch user is created with it.
 *
 * ── The password ──────────────────────────────────────────────────────────────
 * No hash is written. An approved customer arrives with a temporary password in its
 * activation SMS, logged to dbo.UserSMSLog whether or not the whitelist let it send, and
 * is parked on /Home/ChangePassword until it is changed. Stage 5 reads that temporary
 * password, signs in, and sets the target through the UI — the same route as
 * set-officer-passwords.spec.ts.
 *
 * One change covers both rows: a password change writes LastPasswordChangedAt on every
 * Users row sharing the mobile, measured on 9999303778 where all four rows moved
 * together. usp_AddUser also inherits the existing hash when a row is added to a mobile
 * that already has one, so the order of stages 4 and 5 does not matter.
 *
 *   TOOLS=true ENV=qa npx playwright test --project=tools \
 *     --grep "create customer and branch admin"
 *
 * Re-runnable: pass CBA_MOBILE, CBA_REFERENCE and CBA_PAN to resume a chain that
 * stopped part way rather than starting a second customer.
 *
 * THIS CREATES A REAL CUSTOMER IN QA AND REAL CREDENTIALS. It is in tools/ so a normal
 * run cannot reach it. Every record carries a runTag.
 */

const UPLOAD = path.join(__dirname, '../test-data/files/sample-doc.pdf');
const TARGET_PASSWORD = process.env.CBA_PASSWORD ?? 'Nayara@1';

/** Gurgaon in HR_HP_PB — the division whose TSM we hold credentials for, if review is ever needed. */
const STATE = process.env.CBA_STATE ?? 'HR_HP_PB';
const DIVISION = process.env.CBA_DIVISION ?? 'Gurgaon';
const BANK_ACCOUNT = process.env.CBA_BANK ?? '1234567890';

test.use({ storageState: { cookies: [], origins: [] } });

test.describe('Tools — data building @tools', () => {
  test('create customer and branch admin', async ({ page, browser, loginPage, dashboardPage, db }) => {
    test.setTimeout(30 * 60_000);

    const tag = runTag();
    const mobile = process.env.CBA_MOBILE ?? freshMobile();
    const pan = process.env.CBA_PAN ?? AddCustomerPage.freshPan('P');
    let reference = process.env.CBA_REFERENCE ?? '';

    console.log(`\n=== mobile ${mobile}  pan ${pan}  tag ${tag} ===`);

    const applicationStatus = async (): Promise<number | undefined> => {
      const rows = await db.query<{ Status: number }>(
        `SELECT TOP 1 Status FROM dbo.RawCustomerMaster
          WHERE ReferenceNo = @reference ORDER BY Id DESC`,
        { reference }
      );
      return rows[0]?.Status;
    };

    interface UserRow {
      Id: number; UserName: string; MobileNumber: string;
      UserTypeCode: string; IsParentUser: boolean; IsActive: boolean;
    }
    const usersOn = async (): Promise<UserRow[]> =>
      db.query<UserRow>(
        `SELECT u.Id, u.UserName, u.MobileNumber, ut.Code AS UserTypeCode,
                u.IsParentUser, u.IsActive
           FROM dbo.Users u
           LEFT JOIN dbo.UserTypesMaster ut ON ut.Id = u.UserTypeId
          WHERE u.MobileNumber = @mobile ORDER BY u.Id`,
        { mobile }
      );

    // ── 0. The number must not exist ─────────────────────────────────────────
    //
    // freshMobile() derives a number from the clock, the worker and a counter, so a
    // collision is unlikely rather than impossible — and "unlikely" is not what a
    // caller asking for an unused number is owed. Checked against every table that
    // claims a mobile, including the SMS log, which holds a trace even where the
    // conflict check in usp_AddUser would not look.
    await test.step('the mobile is unused', async () => {
      const existing = await db.query<{ src: string; n: number }>(
        `SELECT 'Users' AS src, COUNT(*) AS n FROM dbo.Users WHERE MobileNumber = @mobile
          UNION ALL SELECT 'CustomerMaster', COUNT(*) FROM dbo.CustomerMaster WHERE MobileNo = @mobile
          UNION ALL SELECT 'RawCustomerMaster', COUNT(*) FROM dbo.RawCustomerMaster WHERE MobileNo = @mobile
          UNION ALL SELECT 'UserSMSLog', COUNT(*) FROM dbo.UserSMSLog WHERE MobileNo = @mobile`,
        { mobile }
      );
      const held = existing.filter(r => r.n > 0);
      console.log(`  ${mobile} pre-existing rows: ${held.map(r => `${r.src}=${r.n}`).join(', ') || 'none'}`);

      // A resumed run is exempt: by then the number is deliberately its own.
      if (process.env.CBA_MOBILE) {
        console.log('  CBA_MOBILE was supplied, so this is a resume — not asserting the number is new');
        return;
      }
      expect(
        held,
        `${mobile} is already in use (${held.map(r => `${r.src}=${r.n}`).join(', ')}). ` +
          `The point of this run is a number that did not exist, so it stops rather than ` +
          `building on top of whatever holds it.`
      ).toHaveLength(0);
    });

    // ── 1. The application ───────────────────────────────────────────────────
    await test.step('FP Admin raises a Fleet onboarding form', async () => {
      if (reference) {
        console.log(`  resuming reference ${reference} (status ${await applicationStatus()})`);
        return;
      }

      await loginPage.navigate();
      await loginPage.login(FP_ADMIN.username, FP_ADMIN.password);
      await dashboardPage.assertDashboardLoaded();

      const wizard = new AddCustomerPage(page);
      await wizard.gotoWizard();
      reference = await wizard.referenceNo.inputValue();
      expect(reference, 'the wizard generated no reference number').toMatch(/\d{6,}/);
      console.log(`  reference ${reference}`);

      await wizard.fillBasicInformation({
        customerType: 'Fleet',
        state: STATE,
        division: DIVISION,
        panNumber: pan,
        panDob: '1990-01-01',
        businessName: `${tag} Dual Admin Co`,
        businessEmail: `${tag.toLowerCase()}@example.com`,
        customerName: `${tag} Parent Admin`,
        customerEmail: `${tag.toLowerCase()}.cust@example.com`,
        customerMobile: mobile,
        otp: TEST_OTP,
        idProofNumber: pan,
        bankName: 'HDFC',
        bankAccountHolder: `${tag} Parent Admin`,
        bankAccountNumber: BANK_ACCOUNT,
        ifscCode: 'HDFC0002048',
        uploadFile: UPLOAD,
      });

      await wizard.saveAsDraft();
      await wizard.goToAddressStep();
      await wizard.fillAddress({
        pinCode: '201304',
        businessAddress: `${tag} Address`,
        addressProofNumber: '1234567890',
        uploadFile: UPLOAD,
      });

      // The branch that becomes the Branch Admin. fillBranch checks
      // #uiBOMobileSameAsParent, so this branch carries the customer's own mobile —
      // which is the entire reason both roles end up on one number.
      await wizard.goToBranchStep();
      await wizard.fillBranch({
        pinCode: '201304',
        managerName: `${tag} Branch Admin`,
        location: `${tag} Branch`,
      });
      await wizard.saveBranch();

      await wizard.goToMeetingStep();
      await wizard.fillMeetingDetails(new Date().toISOString().slice(0, 10));
      await wizard.submit();

      await expect
        .poll(applicationStatus, { timeout: 60_000, message: 'the submission never reached the database' })
        .toBe(107);
      console.log(`  submitted at 107, Consent Pending`);
    });

    // ── 2. Consent, which belongs to the customer ────────────────────────────
    await test.step('the customer gives consent', async () => {
      if ((await applicationStatus()) !== 107) {
        console.log(`  consent already given (status ${await applicationStatus()})`);
        return;
      }
      await ConsentPage.completeFor(page, mobile, TEST_OTP);
      await expect
        .poll(applicationStatus, { timeout: 60_000, message: 'consent did not move the application off 107' })
        .not.toBe(107);
      console.log(`  after consent: ${await applicationStatus()}`);
    });

    // ── 3. Review, only if this build routed an FP Admin's form through one ──
    await test.step('review, if the application is waiting for one', async () => {
      if ((await applicationStatus()) !== 102) {
        console.log(`  no review stage (status ${await applicationStatus()})`);
        return;
      }
      // An FP-Admin-raised form should go 107 -> 105 and skip this entirely. Handled
      // rather than asserted, so a routing change does not strand the chain here.
      await page.context().clearCookies();
      await loginPage.navigate();
      await loginPage.login(TSM.username, TSM.password);
      await dashboardPage.assertDashboardLoaded();

      const outcome = await new ReviewCustomerPage(page).review(reference);
      console.log(`  review (${TSM.username}): ${JSON.stringify(outcome)}`);
      await expect
        .poll(applicationStatus, { timeout: 60_000, message: 'the review never moved the status past 102' })
        .not.toBe(102);
    });

    // ── 4. Approval, which is what creates the users ─────────────────────────
    await test.step('a checker approves, creating the Customer Admin', async () => {
      if ((await applicationStatus()) !== 105) {
        console.log(`  approval already done (status ${await applicationStatus()})`);
        return;
      }
      await page.context().clearCookies();
      await loginPage.navigate();
      await loginPage.login(FP_ADMIN.username, FP_ADMIN.password);
      await dashboardPage.assertDashboardLoaded();

      // PAN and bank account are retyped because the page compares them client-side
      // against what the maker submitted; without them Approve is silently inert.
      const outcome = await new ApproveCustomerPage(page).approve(reference, {
        pan,
        bankAccountNumber: BANK_ACCOUNT,
      });
      console.log(`  approval: ${JSON.stringify(outcome)}`);

      await expect
        .poll(applicationStatus, { timeout: 60_000, message: 'the approval never moved the status past 105' })
        .not.toBe(105);
    });

    // ParentId IS NULL, not ORDER BY Id DESC.
    //
    // One approval writes two CustomerMaster rows against this reference — the parent
    // and the branch the wizard carried — and the branch has the higher Id, so taking
    // the last row returns the branch. That misnamed the customer in a report, and it
    // would have handed a branch id to Add Branch as the parent to hang a branch off.
    const customer = await db.query<{ CustomerId: string; Id: number; Status: number }>(
      `SELECT TOP 1 CustomerId, Id, Status FROM dbo.CustomerMaster
        WHERE ReferenceNo = @reference AND ParentId IS NULL ORDER BY Id`,
      { reference }
    );
    expect(
      customer[0],
      `No CustomerMaster row for reference ${reference}. Without a customer there is ` +
        `no Customer Admin to create, so the chain stopped before it could produce one.`
    ).toBeTruthy();
    console.log(`  customer ${customer[0].CustomerId} at status ${customer[0].Status}`);

    // ── 5. A Branch Admin, if the wizard's branch did not already make one ───
    await test.step('ensure a Branch Admin exists on the same mobile', async () => {
      const before = await usersOn();
      console.log(`  users on ${mobile}: ${before.map(u => `${u.Id} ${u.UserTypeCode}`).join(', ') || 'none'}`);
      if (before.some(u => u.UserTypeCode === 'BRANCH_ADMIN')) {
        console.log('  a Branch Admin already exists — the wizard branch produced one');
        return;
      }

      // The wizard's branch did not yield a user, so add one explicitly. As an FP Admin
      // this auto-approves into CustomerMaster at 101 and creates the branch user with
      // it — no 108 queue, no cap. The manager mobile is typed as the customer's own.
      await page.context().clearCookies();
      await loginPage.navigate();
      await loginPage.login(FP_ADMIN.username, FP_ADMIN.password);
      await dashboardPage.assertDashboardLoaded();

      const branch = new AddBranchPage(page);
      await branch.open();
      const parent = await branch.findParent(customer[0].CustomerId);
      expect(parent.found, `Add Branch could not resolve ${customer[0].CustomerId}`).toBe(true);
      if (await branch.branchTypeOffered()) await branch.selectBranchType('Fleet');

      const code = await branch.fillBranch({
        pinCode: '201304',
        managerName: `${tag} Branch Admin`,
        email: `${tag.toLowerCase()}.branch@example.com`,
        address: `${tag} Branch Address`,
      });
      console.log(`  branch location code ${code}`);

      const otp = await branch.verifyManagerMobile(mobile, TEST_OTP);
      console.log(`  manager mobile: ${JSON.stringify(otp)}`);
      console.log(`  submit said: "${await branch.submit()}"`);

      await expect
        .poll(async () => (await usersOn()).some(u => u.UserTypeCode === 'BRANCH_ADMIN'), {
          timeout: 60_000,
          message: `No BRANCH_ADMIN row appeared on ${mobile} after the branch was submitted`,
        })
        .toBe(true);
    });

    // ── 6. The password, through the UI ─────────────────────────────────────
    await test.step(`set the password to ${TARGET_PASSWORD}`, async () => {
      const sms = await db.query<{ SMSText: string; CreatedOn: string }>(
        `SELECT TOP 5 SMSText, CreatedOn FROM dbo.UserSMSLog
          WHERE MobileNo = @mobile
            AND (SMSText LIKE '%Temporary Password%' OR SMSText LIKE '%temporary%password is%')
          ORDER BY Id DESC`,
        { mobile }
      );

      // Has the temporary password already been spent? Asked of the database rather
      // than by trying to sign in: a re-run that guesses wrong burns a failed attempt
      // against a real account, and enough of those lock it. LastPasswordChangedAt
      // later than the SMS that issued the temporary password means it is gone.
      const auth = await db.query<{ LastPasswordChangedAt: string | null }>(
        `SELECT TOP 1 a.LastPasswordChangedAt
           FROM dbo.UserAuthStatus a
           JOIN dbo.Users u ON u.Id = a.UserId
          WHERE u.MobileNumber = @mobile
          ORDER BY a.LastPasswordChangedAt DESC`,
        { mobile }
      );
      const changedAt = auth[0]?.LastPasswordChangedAt;
      const issuedAt = sms[0]?.CreatedOn;
      if (changedAt && issuedAt && new Date(changedAt) > new Date(issuedAt)) {
        console.log(`  password already changed at ${changedAt}, after the SMS at ${issuedAt} — skipping`);
        return;
      }
      // Two wordings, and they are not interchangeable — see temporaryPassword() in
      // set-officer-passwords.spec.ts for why matching one misses the other.
      let temp = '';
      for (const row of sms) {
        const text = row.SMSText ?? '';
        temp = text.match(/Temporary Password:\s*(\S+?)\.\s/)?.[1]
          ?? text.match(/password is\s+(\S+?)\.(?:\s|$)/i)?.[1]
          ?? '';
        if (temp) break;
      }
      expect(temp, `No activation SMS with a temporary password for ${mobile}`).toBeTruthy();
      console.log(`  temporary password read from UserSMSLog`);

      await page.context().clearCookies();
      await loginPage.navigate();
      await loginPage.login(mobile, temp);

      const changePage = new ChangePasswordPage(page);
      if (await changePage.isShowing()) {
        console.log(`  change screen said: "${await changePage.change(temp, TARGET_PASSWORD)}"`);
      } else {
        console.log(`  not parked on the change screen (url ${page.url()}) — already changed?`);
      }
    });

    // ── 7. Proof: sign in cold as each role ─────────────────────────────────
    //
    // A fresh browser context per role, not clearCookies() on the shared one. Clearing
    // cookies ends the session in the browser and not on the server, and signing in as
    // the second role on the remains of the first is refused with "Unable to verify
    // session. Please try again." — which reads exactly like a bad password and is not
    // one. Measured: both roles sign in first time when each gets its own context.
    for (const role of ['CUSTOMER_ADMIN', 'BRANCH_ADMIN'] as const) {
      await test.step(`sign in cold as ${role}`, async () => {
        const context = await browser.newContext();
        try {
          const fresh = await context.newPage();
          const login = new LoginPage(fresh);
          const dashboard = new DashboardPage(fresh);
          await login.navigate();
          await login.login(mobile, TARGET_PASSWORD, role);
          await dashboard.assertDashboardLoaded();
          console.log(`  ${role}: signed in at ${fresh.url()}`);
        } finally {
          await context.close();
        }
      });
    }

    const final = await usersOn();
    console.log(`\n=== ${mobile} / ${TARGET_PASSWORD} ===`);
    console.log(`  customer ${customer[0].CustomerId}  reference ${reference}  tag ${tag}`);
    for (const u of final) {
      console.log(`  Users.${u.Id}  ${u.UserTypeCode}  parent=${u.IsParentUser}  active=${u.IsActive}`);
    }

    expect(
      final.filter(u => u.UserTypeCode === 'CUSTOMER_ADMIN'),
      `No CUSTOMER_ADMIN row on ${mobile}`
    ).not.toHaveLength(0);
    expect(
      final.filter(u => u.UserTypeCode === 'BRANCH_ADMIN'),
      `No BRANCH_ADMIN row on ${mobile}`
    ).not.toHaveLength(0);
  });
});
