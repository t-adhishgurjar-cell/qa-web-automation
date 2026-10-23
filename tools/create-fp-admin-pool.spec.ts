import { expect } from '@playwright/test';
import { test } from '../src/fixtures/page.fixtures';
import { AddUserPage } from '../src/pages/user-management/add-user.page';
import { ChangePasswordPage } from '../src/pages/change-password.page';
import { LoginPage } from '../src/pages/login.page';
import { DashboardPage } from '../src/pages/dashboard.page';
import { createOtpReader } from '../src/helpers/sms-otp.helper';
import { freshMobile, runTag } from '../src/helpers/test-identity';
import { FP_ADMIN } from '../src/config/accounts';

/**
 * Mints a pool of FP Admin accounts so the suite can run several workers at once.
 *
 * The whole regression ran on one worker because FleetPlus allows one live session per
 * user: two workers as the same FP Admin evict each other and the failures look like
 * product defects. Measured on a real round, 22 of every 27 seconds went on logging in —
 * about 80% of wall-clock. One account per worker is what removes that, and FP_ADMIN is
 * one of the five types /User/AddUser actually offers, so these can be created here
 * rather than waited on.
 *
 * Each account is created, then put on a known password through the forced first-login
 * change screen — the same route as set-officer-passwords.spec.ts, reading the temporary
 * password out of dbo.UserSMSLog. No hashes are written.
 *
 *   COUNT=3 TOOLS=true ENV=qa npx playwright test --project=tools \
 *     --grep "create fp admin pool"
 *
 * Then run wide with the pool it prints:
 *   FP_ADMIN_USERS=loadtest_006,<a>,<b>,<c> WORKERS=4 ENV=qa npx playwright test ...
 *
 * THIS CREATES REAL FP ADMIN USERS IN QA. They are Nayara-side administrators, so they
 * are tagged and listed at the end for cleanup.
 */

const COUNT = Number(process.env.COUNT ?? 3);
const TARGET_PASSWORD = process.env.POOL_PASSWORD ?? 'Nayara@1';

test.use({ storageState: { cookies: [], origins: [] } });

test.describe('Tools — data building @tools', () => {
  test('create fp admin pool', async ({ page, browser, loginPage, dashboardPage, db }) => {
    test.setTimeout(30 * 60_000);

    const tag = runTag();
    const created: string[] = [];
    const failed: string[] = [];

    await loginPage.navigate();
    await loginPage.login(FP_ADMIN.username, FP_ADMIN.password);
    await dashboardPage.assertDashboardLoaded();

    const addUser = new AddUserPage(page);

    for (let index = 0; index < COUNT; index++) {
      const mobile = freshMobile();
      console.log(`\n--- ${index + 1}/${COUNT}: FP_ADMIN on ${mobile} ---`);

      // Opened through the list every time: direct navigation renders the form without
      // its action footer, so #btnAdd is simply absent and the submit has nothing to click.
      await addUser.open();
      await addUser.enterMobile(mobile);
      await addUser.fillIdentity({
        mobile,
        firstName: 'Auto',
        lastName: `FP${index + 1}`,
        email: `${tag.toLowerCase()}.fp${index + 1}@example.com`,
        userType: 'FP_ADMIN',
      });
      await addUser.selectUserType('FP_ADMIN');

      const outcome = await addUser.submit();
      console.log(`  submit: ${JSON.stringify(outcome)}`);

      const row = await db.query<{ Id: number; UserName: string }>(
        `SELECT TOP 1 u.Id, u.UserName FROM dbo.Users u
           JOIN dbo.UserTypesMaster ut ON ut.Id = u.UserTypeId
          WHERE u.MobileNumber = @mobile AND ut.Code = 'FP_ADMIN' ORDER BY u.Id DESC`,
        { mobile }
      );
      if (!row[0]) {
        console.log(`  NOT created — ${outcome.message || 'the app said nothing'}`);
        failed.push(mobile);
        continue;
      }
      console.log(`  Users.${row[0].Id} created as ${row[0].UserName}`);
      created.push(row[0].UserName);
    }

    // ── Put each one on the target password, in its own context ──────────────
    const usable: string[] = [];
    for (const username of created) {
      const mobile = username;
      const sms = await db.query<{ SMSText: string }>(
        `SELECT TOP 5 SMSText FROM dbo.UserSMSLog
          WHERE MobileNo = @mobile
            AND (SMSText LIKE '%Temporary Password%' OR SMSText LIKE '%temporary%password is%')
          ORDER BY Id DESC`,
        { mobile }
      );
      let temp = '';
      for (const sent of sms) {
        const text = sent.SMSText ?? '';
        temp = text.match(/Temporary Password:\s*(\S+?)\.\s/)?.[1]
          ?? text.match(/password is\s+(\S+?)\.(?:\s|$)/i)?.[1] ?? '';
        if (temp) break;
      }
      if (!temp) {
        console.log(`\n${username}: no activation SMS, so no temporary password to use`);
        continue;
      }

      // A fresh context per account: clearing cookies ends the session in the browser
      // only, and signing in as a second account on the remains of the first is refused
      // with "Unable to verify session", which reads exactly like a bad password.
      const context = await browser.newContext();
      try {
        const fresh = await context.newPage();
        const login = new LoginPage(fresh);
        await login.navigate();
        const otp = await createOtpReader(mobile, 'Login');
        await login.login(mobile, temp, undefined, otp);

        const changePage = new ChangePasswordPage(fresh);
        if (await changePage.isShowing()) {
          console.log(`\n${username}: ${await changePage.change(temp, TARGET_PASSWORD)}`);
        } else {
          console.log(`\n${username}: not parked on the change screen (${fresh.url()})`);
        }
      } finally {
        await context.close();
      }

      // Proved cold, in yet another context, before it is offered as usable.
      const check = await browser.newContext();
      try {
        const fresh = await check.newPage();
        const login = new LoginPage(fresh);
        await login.navigate();
        const otp = await createOtpReader(mobile, 'Login');
        await login.login(mobile, TARGET_PASSWORD, undefined, otp);
        await new DashboardPage(fresh).assertDashboardLoaded();
        console.log(`  ${username} / ${TARGET_PASSWORD} — verified at ${fresh.url()}`);
        usable.push(username);
      } catch (error) {
        console.log(`  ${username} could not sign in with ${TARGET_PASSWORD}: ${(error as Error).message.split('\n')[0]}`);
      } finally {
        await check.close();
      }
    }

    console.log(`\n=== pool (tag ${tag}) ===`);
    console.log(`  created : ${created.join(', ') || 'none'}`);
    console.log(`  usable  : ${usable.join(', ') || 'none'}`);
    console.log(`  refused : ${failed.join(', ') || 'none'}`);
    console.log(`\n  FP_ADMIN_USERS=${[FP_ADMIN.username, ...usable].join(',')}`);

    expect(usable.length, 'no usable FP Admin was produced').toBeGreaterThan(0);
  });
});
