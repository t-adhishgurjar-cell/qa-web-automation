import { expect } from '@playwright/test';
import { test } from '../src/fixtures/page.fixtures';
import { RoOnboardingApi } from '../src/helpers/ro-api.helper';
import { freshMobile, runTag } from '../src/helpers/test-identity';
import { createOtpReader } from '../src/helpers/sms-otp.helper';
import { LoginPage } from '../src/pages/login.page';
import { DashboardPage } from '../src/pages/dashboard.page';
import { ChangePasswordPage } from '../src/pages/change-password.page';

/**
 * Creates one retail outlet through the RO onboarding API and makes its admin usable.
 *
 * One call creates the outlet, an RO admin on `roMobile` and a TERRITORY_ADMIN on
 * `tsmMobile`, under freshly minted codes — reusing a code moves a real record, so the
 * helper's unique codes are left as they are. The outlet and both users are then read
 * back from the database, and the RO admin is put onto a known password through the
 * forced first-login change, with the temporary password and the login OTP both read
 * from dbo.UserSMSLog (a generated mobile is not whitelisted).
 *
 *   TOOLS=true ENV=qa npx playwright test --project=tools --grep "create ro"
 *
 * THIS CREATES A REAL OUTLET AND REAL USERS IN QA.
 */
const TARGET_PASSWORD = process.env.RO_PASSWORD ?? 'Nayara@1';

test.use({ storageState: { cookies: [], origins: [] } });

test.describe('Tools — data building @tools', () => {
  test('create ro', async ({ browser, db }) => {
    test.setTimeout(15 * 60_000);
    const tag = runTag();
    const roMobile = process.env.RO_MOBILE ?? freshMobile();
    const tsmMobile = process.env.RO_TSM_MOBILE ?? freshMobile();
    console.log(`\n=== RO on ${roMobile}, TSM on ${tsmMobile}, tag ${tag} ===`);

    // Resumable: an outlet already on this mobile is read back, not created again — the
    // API happily creates a second one, and the first attempt died on a read-back query
    // after the outlet existed.
    const existing = await db.query<{ ROCode: string }>(
      `SELECT TOP 1 ROCode FROM dbo.ROMaster WHERE MobileNo = @m ORDER BY ID DESC`, { m: roMobile });
    let custCode = existing[0]?.ROCode ?? '';
    let tsmCode = '(existing)';
    if (custCode) {
      console.log(`  outlet ${custCode} already exists on ${roMobile} — resuming`);
    } else {
      const outcome = await RoOnboardingApi.onboard({ roMobile, tsmMobile, custName: `${tag} Auto Pump` });
      console.log(`  api: action=${outcome.action} remarks="${outcome.remarks}" ref=${outcome.referenceNo} cust=${outcome.custCode} tsm=${outcome.tsmCode} http=${outcome.httpStatus}`);
      expect(outcome.created, `The RO API did not create the outlet: ${outcome.action} ${outcome.remarks}\n${outcome.raw.slice(0, 400)}`).toBe(true);
      custCode = outcome.custCode; tsmCode = outcome.tsmCode;
    }

    // ── What exists now ──────────────────────────────────────────────────────
    const ro = await db.query<Record<string, unknown>>(`
      SELECT TOP 3 ID, ROCode, ROName, ROStatus, StatusFlag, MobileNo, DivisionCode, TSMID,
             StateName, CityName, BusinessStateName, CreatedOn
        FROM dbo.ROMaster WHERE MobileNo = @m OR ROCode = @c ORDER BY ID DESC`,
      { m: roMobile, c: custCode });
    for (const r of ro) console.log('  ROMaster: ' + JSON.stringify(r));
    expect(ro.length, `no ROMaster row for ${custCode}`).toBeGreaterThan(0);

    const users = await db.query<{ Id: number; UserName: string; MobileNumber: string; Code: string; IsActive: boolean }>(`
      SELECT u.Id, u.UserName, u.MobileNumber, ut.Code, u.IsActive
        FROM dbo.Users u JOIN dbo.UserTypesMaster ut ON ut.Id = u.UserTypeId
       WHERE u.MobileNumber IN (@a, @b) ORDER BY u.Id`, { a: roMobile, b: tsmMobile });
    for (const u of users) console.log(`  Users.${u.Id} ${u.Code} ${u.MobileNumber} active=${u.IsActive}`);
    expect(users.some(u => u.Code === 'RO'), `no RO user was created on ${roMobile}`).toBe(true);

    // ── The RO admin's password, through the UI ──────────────────────────────
    const sms = await db.query<{ SMSText: string }>(`
      SELECT TOP 5 SMSText FROM dbo.UserSMSLog
       WHERE MobileNo = @m AND (SMSText LIKE '%Temporary Password%' OR SMSText LIKE '%temporary%password is%')
       ORDER BY Id DESC`, { m: roMobile });
    let temp = '';
    for (const row of sms) {
      temp = row.SMSText.match(/Temporary Password:\s*(\S+?)\.\s/)?.[1] ?? row.SMSText.match(/password is\s+(\S+?)\.(?:\s|$)/i)?.[1] ?? '';
      if (temp) break;
    }
    if (!temp) {
      // An API-created RO admin gets an onboarding SMS and no password at all. The only
      // route to a first password is the pre-login Forgot Password flow: request an OTP for
      // the username, answer it, and the application issues a temporary password by SMS —
      // both read from dbo.UserSMSLog, since a generated mobile is not whitelisted.
      console.log(`  no activation password for ${roMobile} — issuing one through Forgot Password`);
      const context = await browser.newContext();
      try {
        const page = await context.newPage();
        const login = new LoginPage(page);
        await login.navigate();
        const resetOtp = await createOtpReader(roMobile, 'PasswordReset');
        await login.openForgotPasswordFlow();
        const sent = await login.requestOtpForUsername(roMobile);
        expect(sent, `Forgot Password did not reach the OTP step for ${roMobile}: ${await login.forgotPassword.anyError()}`).toBe(true);
        await login.forgotPassword.fillOtp(await resetOtp());
        await login.forgotPassword.submit();
        await page.waitForTimeout(3_000);
        console.log(`  forgot-password said: ${(await login.forgotPassword.anyError()) || (await page.locator('.modal.show').first().textContent().catch(() => '') || '').replace(/\s+/g, ' ').trim().slice(0, 160) || 'nothing'}`);
      } finally { await context.close(); }

      for (let attempt = 0; attempt < 15 && !temp; attempt++) {
        const again = await db.query<{ SMSText: string }>(`
          SELECT TOP 3 SMSText FROM dbo.UserSMSLog
           WHERE MobileNo = @m AND (SMSText LIKE '%Temporary Password%' OR SMSText LIKE '%temporary%password is%')
           ORDER BY Id DESC`, { m: roMobile });
        for (const row of again) {
          temp = row.SMSText.match(/Temporary Password:\s*(\S+?)\.\s/)?.[1] ?? row.SMSText.match(/password is\s+(\S+?)\.(?:\s|$)/i)?.[1] ?? '';
          if (temp) break;
        }
        if (!temp) await new Promise(r => setTimeout(r, 2_000));
      }
      expect(temp, `Forgot Password issued no temporary password SMS for ${roMobile}`).toBeTruthy();
    }
    {
      const context = await browser.newContext();
      try {
        const page = await context.newPage();
        const login = new LoginPage(page);
        await login.navigate();
        const otp = await createOtpReader(roMobile, 'Login');
        await login.login(roMobile, temp, undefined, otp);
        const change = new ChangePasswordPage(page);
        if (await change.isShowing()) console.log(`  change screen: ${await change.change(temp, TARGET_PASSWORD)}`);
        else console.log(`  not parked on the change screen (${page.url()})`);
      } finally { await context.close(); }

      const check = await browser.newContext();
      try {
        const page = await check.newPage();
        const login = new LoginPage(page);
        await login.navigate();
        const otp = await createOtpReader(roMobile, 'Login');
        await login.login(roMobile, TARGET_PASSWORD, undefined, otp);
        await new DashboardPage(page).assertDashboardLoaded();
        console.log(`  RO admin ${roMobile} / ${TARGET_PASSWORD} — verified at ${page.url()}`);
      } finally { await check.close(); }
    }

    console.log(`\n=== RO ${custCode} ===`);
    console.log(`  RO admin : ${roMobile} / ${TARGET_PASSWORD}`);
    console.log(`  TSM      : ${tsmMobile} (${tsmCode}) — temporary password in UserSMSLog`);
  });
});
