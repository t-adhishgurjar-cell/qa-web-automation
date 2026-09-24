import { test } from '../src/fixtures/page.fixtures';

/**
 * Does the self-enrolment form still derive a division from the pin code?
 *
 * The change request asks for two things to go from OD enrolment: the division, and the pin
 * code restriction based on it. Add Customer does both — no division control, and the state's
 * dummy division stored. The public self-enrolment form at /Home/PersonalSelfEnrolment shows
 * no division either, but it carries a hidden #odDivision, and the one OD customer raised
 * through it is live with a REAL division: NAYAFP3023400262 on 34, Noida.
 *
 * If that hidden field fills from the pin code, the derivation the change removes is still
 * running on this path, and the customer's division is decided by its address after all.
 *
 * Read-only and nothing is created: pin codes are entered, the hidden field is read, and the
 * form is abandoned. No OTP is requested and Submit is never pressed.
 *
 *   TOOLS=true ENV=qa npx playwright test --project=tools --grep "probe self enrolment division"
 */

test.use({ storageState: { cookies: [], origins: [] } });

/** Pin codes in three different states, each belonging to a different real division. */
const PIN_CODES = [
  { pin: '380001', where: 'Ahmedabad, GJ_I' },
  { pin: '201304', where: 'Noida, UP_UK' },
  { pin: '700001', where: 'Kolkata, WB_NE' },
];

test.describe('Tools — probes @tools', () => {
  test('probe self enrolment division', async ({ page, db }) => {
    test.setTimeout(300_000);

    await page.goto('/Home/PersonalSelfEnrolment', { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);

    const read = async () =>
      page.evaluate(() => {
        const value = (id: string) => (document.getElementById(id) as HTMLInputElement | null)?.value ?? '(absent)';
        return {
          division: value('odDivision'),
          divisionalOffice: value('odDivisionalOfficeName'),
          stateOffice: value('odStateOfficeName'),
          state: value('odState'),
          city: value('odCity'),
        };
      });

    console.log(`  before any pin code: ${JSON.stringify(await read())}`);

    for (const { pin, where } of PIN_CODES) {
      await page.locator('#odPinCode').fill(pin);
      await page.locator('#odPinCode').blur();
      // The lookup fires on blur, so wait for the state to fill rather than sampling — a
      // read taken too early reports an empty field and looks like nothing happened.
      await page.locator('#odState').filter({ hasNotText: /^$/ })
        .waitFor({ state: 'visible', timeout: 10_000 }).catch(() => undefined);
      await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);

      const state = await read();
      console.log(`\n  ${pin} (${where}): ${JSON.stringify(state)}`);

      if (state.division && state.division !== '(absent)' && state.division !== '0') {
        const resolved = await db.query(`
          SELECT DivisionId, DivisionName, IsPlaceholder, BusinessStateName
          FROM dbo.DivisionMaster
          WHERE CAST(DivisionId AS varchar(10)) = '${state.division}' OR DMId = '${state.division}'`);
        console.log(`    that division is: ${JSON.stringify(resolved)}`);
      }
    }
  });
});
