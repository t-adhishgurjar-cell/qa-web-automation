import { test } from '../src/fixtures/page.fixtures';
import { PreLoginOtpModal } from '../src/pages/components/pre-login-otp-modal.component';

/**
 * Can an existing GJ_I TSM be given a password, so it can actually be used?
 *
 * GJ_I already has TSMs for Ahmedabad I and Ahmedabad II — 222 location rows between the
 * two divisions — but none of them can sign in: none has a dbo.UserAuthStatus row and
 * none has ever been sent a temporary password, so they are directory entries rather than
 * accounts. And the officer API cannot make a new one: asked for a TERRITORY node it
 * answers "Invalid nodeType", because it derives the user type from the node and knows
 * only ZONE, State and DIVISION.
 *
 * That leaves the pre-login Forgot Password flow, which issues an OTP against the mobile
 * and is the one route to a password that does not need an existing one. Whether it works
 * for an account that has never logged in is exactly the unknown.
 *
 * Read-only in effect if it refuses; if it succeeds it sets a password on a QA account
 * that nobody has ever signed into.
 *
 *   TSM_MOBILE=9111181007 TOOLS=true ENV=qa npx playwright test --project=tools --grep "probe tsm activate"
 */

test.use({ storageState: { cookies: [], origins: [] } });

/** An Ahmedabad I (division 1) territory admin, active, never signed in. */
const MOBILE = process.env.TSM_MOBILE ?? '9111181007';
const OTP = process.env.TEST_OTP ?? '123456';

test.describe('Tools — probes @tools', () => {
  test('probe tsm activate', async ({ loginPage, page, db }) => {
    test.setTimeout(300_000);

    const before = await db.query(`
      SELECT u.Id, u.UserName, ut.Code AS UserTypeCode, a.UserId AS hasAuthStatus
      FROM dbo.Users u
      JOIN dbo.UserTypesMaster ut ON ut.Id = u.UserTypeId
      LEFT JOIN dbo.UserAuthStatus a ON a.UserId = u.Id
      WHERE u.UserName = '${MOBILE}'`);
    console.log(`  ${before.length} user row(s) for ${MOBILE}, ` +
      `${(before as { hasAuthStatus: number | null }[]).filter(r => r.hasAuthStatus).length} with an auth status`);

    await loginPage.navigate();

    const forgot = new PreLoginOtpModal(page, 'forgot');
    await forgot.open();

    const advanced = await forgot.requestOtp(MOBILE);
    console.log(`  OTP step reached: ${advanced}`);
    if (!advanced) {
      console.log(`  refused: "${await forgot.waitForAnyError()}"`);
      return;
    }

    await forgot.fillOtp(OTP);
    await forgot.submit();
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);

    console.log(`  url now: ${page.url()}`);
    console.log(`  any error: "${await forgot.anyError()}"`);

    const fields = await page.evaluate(() =>
      Array.from(document.querySelectorAll('input'))
        .filter(e => e.id && !!e.offsetParent)
        .map(e => `${e.id} type=${(e as HTMLInputElement).type}`));
    console.log(`  visible inputs: ${fields.join(', ') || 'none'}`);

    // Give the reset a moment: the password SMS, if there is one, is written after the
    // OTP is accepted rather than with it.
    await page.waitForTimeout(3_000);

    const auth = await db.query(`
      SELECT COUNT(*) AS rows_ FROM dbo.UserAuthStatus a
      JOIN dbo.Users u ON u.Id = a.UserId WHERE u.UserName = '${MOBILE}'`);
    console.log(`  UserAuthStatus rows now: ${JSON.stringify(auth)}`);

    const duplicates = await db.query(`
      SELECT COUNT(*) AS userRows FROM dbo.Users WHERE UserName = '${MOBILE}'`);
    console.log(`  Users rows for this mobile: ${JSON.stringify(duplicates)}`);

    const after = await db.query(`
      SELECT TOP 4 MobileNo, SMSText, CreatedOn FROM dbo.UserSMSLog
      WHERE MobileNo = '${MOBILE}' ORDER BY CreatedOn DESC`);
    console.log(`  SMS log:`);
    for (const row of after as { SMSText: string; CreatedOn: string }[]) {
      console.log(`    ${row.CreatedOn} ${row.SMSText.slice(0, 160)}`);
    }
  });
});
