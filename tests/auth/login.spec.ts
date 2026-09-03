import { expect } from '@playwright/test';
import { test } from '../../src/fixtures/page.fixtures';
import {
  attachment,
  description,
  epic,
  feature,
  layer,
  owner,
  parameter,
  severity,
  story,
  tms,
} from 'allure-js-commons';
import { FleetPlusTestData } from '../../src/helpers/fleetplus-test-data.helper';
import {
  ACCOUNT_LOCKED,
  FIELD_MAX_LENGTH,
  INVALID_CREDENTIALS,
  USERNAME_ALLOWED_CHARACTERS,
} from '../../src/pages/login.page';

/**
 * FleetPlus login — the complete suite.
 *
 * Traces to Nayara_FleetPlus_Login_TestCases.xlsx; every test carries its TC-LGN
 * id in the title and in an Allure `tms` link, so a run maps back to the workbook
 * row by row.
 *
 * ── Layout ──────────────────────────────────────────────────────────────────
 * One describe per sub-module of the workbook, in the order the sheet lists them:
 * page load, username validation, password validation, captcha, authentication,
 * forgot password, unlock user, security & UX.
 *
 * ── Tags ────────────────────────────────────────────────────────────────────
 * Two independent axes:
 *   depth  — @sanity ⊂ @smoke ⊂ @regression. How much of the suite a run executes.
 *   area   — @auth plus a sub-module tag. Which part of login a test exercises.
 * Every test carries one depth tag and at least one area tag, so `--grep @smoke`
 * gives a build gate and `--grep @forgot-password` gives one dialog, without the
 * two selections interfering.
 *
 * ── What this suite will not do to your data ────────────────────────────────
 * Nothing here locks an account, resets a password or consumes a one-time state.
 * Tests that would are gated behind an environment variable naming a disposable
 * account and skip with an explanation when it is unset. Negative logins use a
 * username that rotates per run, because FleetPlus counts failed attempts against
 * usernames that do not exist as well as real ones — a fixed value would lock
 * itself out after five runs and then fail on the lockout instead of the check.
 *
 * ── Two things about this page that break naive tests ───────────────────────
 * 1. The username field sanitises on every keystroke, dropping anything outside
 *    [A-Za-z0-9@._-]. `fill()` sets the value in one operation and bypasses that
 *    entirely, so the sanitiser tests type character by character via typeUsername().
 * 2. Controls are live in the DOM before their click handlers are bound. Playwright's
 *    actionability checks cannot tell the difference, so an early click is accepted
 *    and silently does nothing. Anything driven by page script — the modals, the
 *    captcha refresh — waits for evidence the script has run before acting.
 */

// ─── Tag vocabulary ──────────────────────────────────────────────────────────
// Named constants rather than inline strings: a typo in a tag is silent, and the
// test simply never matches the filter it was meant to be part of.
const TAG = {
  sanity: '@sanity',
  smoke: '@smoke',
  regression: '@regression',

  auth: '@auth',
  pageLoad: '@page-load',
  validation: '@validation',
  captcha: '@captcha',
  authentication: '@authentication',
  forgotPassword: '@forgot-password',
  unlockUser: '@unlock-user',
  session: '@session',
  security: '@security',
  roles: '@roles',
} as const;

/** Accounts QA has to provision by hand; these tests skip when one is not named. */
const TAG_NEEDS_DATA = '@needs-test-data';

/** A full pass is a regression pass, so these two are on every test. */
const BASE = [TAG.regression, TAG.auth];

// ─── Shared state and helpers ────────────────────────────────────────────────

// The whole suite drives login itself, so no test may inherit a stored session.
test.use({ storageState: { cookies: [], origins: [] } });

const WRONG_PASSWORD = 'DefinitelyNotThePassword!1';

/**
 * A throwaway username, unique per run.
 *
 * FleetPlus locks an account after five consecutive failures and applies that to
 * usernames that do not exist as well as to real ones, so a fixed value here would
 * lock itself out and the test would then fail on the lockout message instead of
 * the credential check. Set NEGATIVE_LOGIN_USER to pin a specific throwaway.
 */
function negativeLoginUser(): string {
  return process.env.NEGATIVE_LOGIN_USER?.trim() || `98${String(Date.now()).slice(-8)}`;
}

/**
 * A credential of the given role, falling back to the workbook's primary.
 *
 * Tests deliberately use *different* accounts. FleetPlus keeps one session per user
 * and prompts "already signed in on another device" when a second login arrives, so
 * several tests sharing one account interfere with each other — which is exactly how
 * the logout test started failing once every test used the same TSM row.
 */
function credentialFor(userType: string) {
  return FleetPlusTestData.getCredentialByUserType(userType)
    ?? FleetPlusTestData.getPrimaryCredential();
}

/**
 * The account the Forgot Password OTP tests drive.
 *
 * A workbook credential by default, which is safe for everything in that group:
 * QA issues a fixed OTP rather than sending an SMS, and — more importantly — not
 * one of those tests completes a successful verification. They submit an OTP that
 * is empty, too short, non-numeric or simply wrong, or they only inspect the
 * field. A password is only reset by a *correct* OTP, so none of them can change
 * the account they run against.
 *
 * FORGOT_PASSWORD_TEST_USER overrides it for an environment where the OTP is real.
 */
const otpAccountPool = (() => {
  try {
    return FleetPlusTestData.getCredentials().map(c => c.mobile);
  } catch {
    return [];
  }
})();

/**
 * A distinct account per OTP test.
 *
 * Forgot Password throttles OTP generation per account: the first request
 * succeeds and further ones inside the cooldown are refused. Six tests each
 * asking for a fresh OTP against the same account therefore starve each other,
 * and every one after the first fails with "OTP step not reached" — a message
 * about the throttle, not about the thing under test.
 *
 * Spreading them across accounts is the same fix the login tests use for the
 * one-session-per-user rule. FORGOT_PASSWORD_TEST_USER pins a single account when
 * one is supplied, which reintroduces the throttle — expected, and explicit.
 */
function otpAccount(slot: number): string {
  const pinned = process.env.FORGOT_PASSWORD_TEST_USER?.trim();
  if (pinned) return pinned;
  return otpAccountPool.length
    ? otpAccountPool[slot % otpAccountPool.length]
    : FleetPlusTestData.getPrimaryCredential().mobile;
}

/** A known-locked account. This suite will not lock one itself. */
const LOCKED_USER = process.env.LOCKED_TEST_USER?.trim();
const NEEDS_LOCKED_ACCOUNT =
  'Set LOCKED_TEST_USER to a known-locked account. This suite will not lock one ' +
  'itself — doing so would consume a workbook credential.';

/**
 * Copies the workbook's own record of a test case onto the Allure result.
 *
 * The spreadsheet already holds the module, type, suite, priority, layer,
 * preconditions and expected result for all 150 cases. Restating that in code
 * would create a second copy to keep in sync, so the report reads it from the
 * source instead: the row travels with the result, and a run becomes reviewable
 * without the reviewer opening the spreadsheet alongside it.
 *
 * Silently does nothing when the workbook is absent. test-data/*.xlsx is
 * gitignored, so CI runs without it, and a missing spreadsheet must cost the
 * report some detail — never a test.
 */
async function fromWorkbook(tcId: string): Promise<void> {
  const row = FleetPlusTestData.getLoginCase(tcId);
  if (!row) return;

  // Labels are filterable in the Allure UI; parameters show on the result itself.
  if (row.layer) await layer(row.layer);
  if (row.testType) await parameter('Test type', row.testType);
  if (row.priority) await parameter('Priority', row.priority);
  if (row.suite) await parameter('Workbook suite', row.suite);
  if (row.module) await parameter('Workbook module', row.module);
  if (row.automate) await parameter('Marked automatable', row.automate);

  const detail = [
    row.scenario && `**Scenario** — ${row.scenario}`,
    row.caseDescription && `\n${row.caseDescription}`,
    row.preconditions && `\n**Preconditions**\n${row.preconditions}`,
    row.steps && `\n**Steps**\n${row.steps}`,
    row.testData && row.testData !== '-' && `\n**Test data**\n${row.testData}`,
    row.expectedResult && `\n**Expected result**\n${row.expectedResult}`,
    row.remarks && `\n**Workbook remarks** — ${row.remarks}`,
  ]
    .filter(Boolean)
    .join('\n');

  // Attached rather than folded into description(): descriptionHtml() would
  // replace the description each test writes for itself, and the two say
  // different things — the description explains why the test is written the way
  // it is, the attachment is the requirement it traces to.
  if (detail) {
    await attachment(`${tcId} — workbook entry`, detail, 'text/markdown');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Page load — TC-LGN-001 … TC-LGN-013
//
// Reads the login page without authenticating, so these run in parallel and never
// touch account state. The right thing to run first: if the page does not render
// its controls, every other login test fails for a reason unrelated to what it
// is testing.
//
// Not covered, and why:
//   TC-LGN-008 — bfcache captcha reissue. Marked manual in the workbook; a
//                back/forward cache restore cannot be forced reliably.
//   TC-LGN-012 — CSP inline-handler audit. A one-time code review, not a suite test.
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Login — page load', () => {

  test(
    'TC-LGN-001 login page renders every control needed to sign in',
    { tag: [...BASE, TAG.smoke, TAG.sanity, TAG.pageLoad] },
    async ({ loginPage }) => {
      await epic('Authentication');
      await feature('Login');
      await story('Page load');
      await owner('QA Team');
      await tms('TC-LGN-001');
      await fromWorkbook('TC-LGN-001');
      await severity('critical');
      await description('Build acceptance gate: the login page paints in full.');

      await loginPage.navigate();

      // Asserted one control at a time on purpose. A single composite assertion
      // would report "the page is wrong"; this reports which control is missing,
      // which is the difference between a usable failure and a bug hunt.
      await expect(loginPage.brandLogo, 'Nayara brand logo').toBeVisible();
      await expect(loginPage.heading, '"Welcome to FLEETPLUS" heading').toBeVisible();
      await expect(loginPage.subtitle, '"Please enter your details" subtitle').toBeVisible();
      await expect(loginPage.usernameInput, 'Username field').toBeVisible();
      await expect(loginPage.passwordInput, 'Password field').toBeVisible();
      await expect(loginPage.captchaInput, 'Captcha field').toBeVisible();
      await expect(loginPage.captchaImage, 'Captcha image').toBeVisible();
      await expect(loginPage.loginButton, 'LOGIN button').toBeVisible();
      await expect(loginPage.loginButton, 'LOGIN button label').toHaveText(/LOGIN/i);
      await expect(loginPage.unlockUserLink, '"Unlock User" link').toBeVisible();
      await expect(loginPage.forgotPasswordLink, '"Forgot Password?" link').toBeVisible();
      await expect(loginPage.fleetHelplineText, 'fleet helpline text').toBeVisible();
      await expect(loginPage.signUpLink, 'Sign Up link').toBeVisible();
      await expect(loginPage.bannerImage, 'right-side banner image').toBeVisible();
    }
  );

  test(
    'TC-LGN-002 a fresh captcha image is issued on every page load',
    { tag: [...BASE, TAG.pageLoad, TAG.captcha] },
    async ({ loginPage, page }) => {
      await epic('Authentication');
      await feature('Login');
      await story('Page load');
      await owner('QA Team');
      await tms('TC-LGN-002');
      await fromWorkbook('TC-LGN-002');
      await severity('normal');

      await loginPage.navigate();

      const src = await loginPage.captchaImageSrc();
      expect(src, 'captcha src should call GenerateCaptchaImage').toContain('GenerateCaptchaImage');
      expect(src, 'captcha src needs a cache-buster so no cached image is reused')
        .toMatch(/GenerateCaptchaImage\?\d+/);

      // The rendered size is the contract the workbook states (120x36). Reading
      // naturalWidth also proves the image actually decoded — a broken image is
      // still "visible" to Playwright.
      //
      // Polled, not read once: the image is a separate request that lands around
      // half a second after DOMContentLoaded, so a single read returns 0x0 and
      // reports a decode failure that never happened.
      await expect
        .poll(
          () => loginPage.captchaImage.evaluate(
            (img: HTMLImageElement) => ({ w: img.naturalWidth, h: img.naturalHeight })
          ),
          { message: 'waiting for the captcha image to decode', timeout: 15_000 }
        )
        .toEqual({ w: 120, h: 36 });

      // Reloading must not serve the same image back.
      const first = src;
      await page.reload({ waitUntil: 'domcontentloaded' });
      expect(await loginPage.captchaImageSrc(), 'a reload must issue a new captcha')
        .not.toBe(first);
    }
  );

  test(
    'TC-LGN-003 the client IP is captured into the hidden field on load',
    { tag: [...BASE, TAG.pageLoad] },
    async ({ loginPage }) => {
      await epic('Authentication');
      await feature('Login');
      await story('Page load');
      await owner('QA Team');
      await tms('TC-LGN-003');
      await fromWorkbook('TC-LGN-003');
      await severity('normal');
      await description(
        'POST /Home/GetIP fills #Userip, which forms part of the encrypted login ' +
          'payload. An unpopulated field gets the login silently rejected.'
      );

      await loginPage.navigate();
      await loginPage.waitUntilSubmittable();

      expect(await loginPage.clientIp(), 'captured client IP').toMatch(/^\d{1,3}(\.\d{1,3}){3}$/);
    }
  );

  test(
    'TC-LGN-004 the form stays usable when the IP lookup fails',
    { tag: [...BASE, TAG.pageLoad] },
    async ({ loginPage, page }) => {
      await epic('Authentication');
      await feature('Login');
      await story('Page load');
      await owner('QA Team');
      await tms('TC-LGN-004');
      await fromWorkbook('TC-LGN-004');
      await severity('normal');
      await description('A failed IP lookup must degrade, not block sign-in.');

      await page.route('**/Home/GetIP', route => route.abort());
      await loginPage.navigate();

      // Confirmed against QA: the client substitutes 0.0.0.0 rather than leaving
      // the field blank, which is what keeps the form submittable.
      await expect
        .poll(() => loginPage.clientIp(), {
          message: 'waiting for the IP fallback to be applied',
          timeout: 15_000,
        })
        .not.toBe('');

      expect(await loginPage.clientIp(), 'fallback IP').toBe('0.0.0.0');
      await expect(loginPage.loginButton, 'LOGIN must remain usable').toBeEnabled();
    }
  );

  test(
    'TC-LGN-005 the password can be revealed and re-masked',
    { tag: [...BASE, TAG.pageLoad] },
    async ({ loginPage }) => {
      await epic('Authentication');
      await feature('Login');
      await story('Page load');
      await owner('QA Team');
      await tms('TC-LGN-005');
      await fromWorkbook('TC-LGN-005');
      await severity('minor');

      await loginPage.navigate();
      await loginPage.passwordInput.fill('Thinkpad@1');

      expect(await loginPage.isPasswordMasked(), 'masked before toggling').toBe(true);
      await loginPage.toggleShowPassword();
      expect(await loginPage.isPasswordMasked(), 'revealed after toggling').toBe(false);
      await loginPage.toggleShowPassword();
      expect(await loginPage.isPasswordMasked(), 're-masked after toggling back').toBe(true);
    }
  );

  test(
    'TC-LGN-006 the captcha refresh control issues a new image',
    { tag: [...BASE, TAG.pageLoad, TAG.captcha] },
    async ({ loginPage }) => {
      await epic('Authentication');
      await feature('Login');
      await story('Page load');
      await owner('QA Team');
      await tms('TC-LGN-006');
      await fromWorkbook('TC-LGN-006');
      await severity('normal');

      await loginPage.navigate();

      // Wait for the first captcha to finish loading before clicking. The refresh
      // handler is wired up as part of the same page script; clicking during the
      // initial load lands before the listener exists and is silently lost.
      await expect
        .poll(
          () => loginPage.captchaImage.evaluate((img: HTMLImageElement) => img.complete),
          { message: 'waiting for the initial captcha to load', timeout: 15_000 }
        )
        .toBe(true);

      const before = await loginPage.captchaImageSrc();
      await loginPage.captchaRefreshButton.click();

      await expect
        .poll(() => loginPage.captchaImageSrc(), {
          message: 'waiting for the refreshed captcha to be swapped in',
          timeout: 10_000,
        })
        .not.toBe(before);
    }
  );

  test(
    'TC-LGN-007 pressing Enter submits the form',
    { tag: [...BASE, TAG.pageLoad] },
    async ({ loginPage }) => {
      await epic('Authentication');
      await feature('Login');
      await story('Page load');
      await owner('QA Team');
      await tms('TC-LGN-007');
      await fromWorkbook('TC-LGN-007');
      await severity('normal');
      await description('Keyboard submission must behave exactly like clicking LOGIN.');

      await loginPage.navigate();

      // Submitted empty so the assertion is about *whether* the form submitted,
      // not about any account. If Enter did nothing, no error would appear.
      await loginPage.submitExpectingValidation('enter');

      await expect(
        loginPage.usernameError,
        'Enter did not trigger the form validation, so it did not submit'
      ).toBeVisible();
    }
  );

  test(
    'TC-LGN-009 a flash message is displayed and its query parameter removed',
    { tag: [...BASE, TAG.pageLoad, TAG.session] },
    async ({ loginPage, page }) => {
      await epic('Authentication');
      await feature('Login');
      await story('Page load');
      await owner('QA Team');
      await tms('TC-LGN-009');
      await fromWorkbook('TC-LGN-009');
      await severity('normal');
      await description(
        'The app redirects here with ?message=… after a session expiry. The text ' +
          'must render, and the parameter must be stripped so a refresh does not ' +
          'show a stale banner.'
      );

      await page.goto('/Home/Login?message=Session%20Expired', { waitUntil: 'domcontentloaded' });

      await expect(loginPage.flashMessage).toHaveText(/Session Expired/i);
      await expect(page, 'the message parameter must be stripped after first paint')
        .not.toHaveURL(/[?&]message=/);
    }
  );

  test(
    'TC-LGN-010 the anti-forgery token is rendered into the form',
    { tag: [...BASE, TAG.pageLoad, TAG.security] },
    async ({ loginPage }) => {
      await epic('Authentication');
      await feature('Login');
      await story('Page load');
      await owner('QA Team');
      await tms('TC-LGN-010');
      await fromWorkbook('TC-LGN-010');
      await severity('critical');

      await loginPage.navigate();

      await expect(loginPage.antiForgeryField).toBeAttached();
      expect(await loginPage.antiForgeryToken(), 'anti-forgery token value')
        .toMatch(/^CfDJ8/); // ASP.NET Core data-protection prefix
    }
  );

  test(
    'TC-LGN-011 the personal-customer Sign Up link points at self-enrolment',
    { tag: [...BASE, TAG.pageLoad] },
    async ({ loginPage, page }) => {
      await epic('Authentication');
      await feature('Login');
      await story('Page load');
      await owner('QA Team');
      await tms('TC-LGN-011');
      await fromWorkbook('TC-LGN-011');
      await severity('normal');

      await loginPage.navigate();
      await expect(loginPage.signUpLink).toHaveAttribute('href', '/Home/PersonalSelfEnrolment');

      await loginPage.signUpLink.click();
      await expect(page).toHaveURL(/PersonalSelfEnrolment/i);
    }
  );

  test(
    'TC-LGN-013 the hidden LoginStage field starts at the password stage',
    { tag: [...BASE, TAG.pageLoad] },
    async ({ loginPage }) => {
      await epic('Authentication');
      await feature('Login');
      await story('Page load');
      await owner('QA Team');
      await tms('TC-LGN-013');
      await fromWorkbook('TC-LGN-013');
      await severity('normal');
      await description(
        'LoginStage tells the server which step of the journey a POST belongs to. ' +
          'A fresh page must always start at stage 1 — anything else would let a ' +
          'client skip straight to the OTP step.'
      );

      await loginPage.navigate();
      expect(await loginPage.loginStage(), 'initial LoginStage').toBe('1');
    }
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Username validation — TC-LGN-014 … TC-LGN-027
//
// Client-side only: no credential is submitted and no account state is touched.
// ─────────────────────────────────────────────────────────────────────────────

/** Values the field must preserve exactly as typed. */
const USERNAME_ACCEPTED = [
  { tc: 'TC-LGN-014', label: 'an alphanumeric username', input: 'user123', smoke: true },
  { tc: 'TC-LGN-015', label: 'a mobile number', input: '9611200199', smoke: false },
  { tc: 'TC-LGN-016', label: 'the permitted specials @ . _ -', input: 'user@name.co_in-01', smoke: false },
];

/**
 * Values the field must strip, and the characters that must not survive.
 *
 * The assertion names the *rule* — no disallowed character survives — rather than
 * pinning the exact output string, so tightening the charset does not break the
 * suite while loosening it still does.
 */
const USERNAME_SANITISED = [
  {
    tc: 'TC-LGN-019',
    label: 'disallowed punctuation',
    input: 'ab#$%^&*()cd',
    mustNotContain: ['#', '$', '%', '^', '&', '*', '(', ')'],
  },
  { tc: 'TC-LGN-020', label: 'embedded spaces', input: 'ab cd ef', mustNotContain: [' '] },
  { tc: 'TC-LGN-024', label: 'unicode and emoji', input: 'usér😀ñame', mustNotContain: ['é', '😀', 'ñ'] },
  {
    tc: 'TC-LGN-025',
    label: 'an XSS payload',
    input: '<script>alert(1)</script>',
    mustNotContain: ['<', '>', '/', '(', ')'],
  },
  {
    tc: 'TC-LGN-026',
    label: 'a SQL injection payload',
    input: "' OR 1=1--",
    mustNotContain: ["'", '=', ' '],
  },
];

test.describe('Login — username validation', () => {
  test.beforeEach(async ({ loginPage }) => {
    await loginPage.navigate();
  });

  for (const { tc, label, input, smoke } of USERNAME_ACCEPTED) {
    test(
      `${tc} accepts ${label}`,
      { tag: [...BASE, TAG.validation, ...(smoke ? [TAG.smoke] : [])] },
      async ({ loginPage }) => {
        await tms(tc);
        await severity('normal');

        expect(await loginPage.typeUsername(input), `"${input}" must be kept verbatim`)
          .toBe(input);
      }
    );
  }

  for (const { tc, label, input, mustNotContain } of USERNAME_SANITISED) {
    test(
      `${tc} strips ${label} as it is typed`,
      { tag: [...BASE, TAG.validation, TAG.security] },
      async ({ loginPage }) => {
        await tms(tc);
        await severity(tc === 'TC-LGN-025' || tc === 'TC-LGN-026' ? 'critical' : 'normal');
        await description(
          `Typed: ${JSON.stringify(input)}. The field must drop every character ` +
            `outside ${USERNAME_ALLOWED_CHARACTERS.source}.`
        );

        const kept = await loginPage.typeUsername(input);

        for (const character of mustNotContain) {
          expect(kept, `"${character}" survived sanitisation in ${JSON.stringify(kept)}`)
            .not.toContain(character);
        }

        // The general rule, not just the specific characters this case names.
        expect(kept, `${JSON.stringify(kept)} contains a disallowed character`)
          .toMatch(USERNAME_ALLOWED_CHARACTERS);
      }
    );
  }

  test(
    'TC-LGN-017 rejects an empty username',
    { tag: [...BASE, TAG.smoke, TAG.validation] },
    async ({ loginPage }) => {
      await epic('Authentication');
      await feature('Login');
      await story('Username validation');
      await owner('QA Team');
      await tms('TC-LGN-017');
      await fromWorkbook('TC-LGN-017');
      await severity('critical');

      await loginPage.submitExpectingValidation();

      await expect(loginPage.usernameError).toBeVisible();
      await expect(loginPage.usernameError).toHaveText(/username is required/i);
    }
  );

  test(
    'TC-LGN-018 rejects a whitespace-only username',
    { tag: [...BASE, TAG.validation] },
    async ({ loginPage }) => {
      await epic('Authentication');
      await feature('Login');
      await story('Username validation');
      await owner('QA Team');
      await tms('TC-LGN-018');
      await fromWorkbook('TC-LGN-018');
      await severity('normal');
      await description(
        'Spaces are stripped as typed, so a whitespace-only entry reduces to empty ' +
          'and must be refused for the same reason an empty field is.'
      );

      expect(await loginPage.typeUsername('     '), 'whitespace should reduce to empty').toBe('');

      await loginPage.submitExpectingValidation();
      await expect(loginPage.usernameError).toHaveText(/username is required/i);
    }
  );

  test(
    'TC-LGN-022 accepts a username of exactly the maximum length',
    { tag: [...BASE, TAG.validation] },
    async ({ loginPage }) => {
      await epic('Authentication');
      await feature('Login');
      await story('Username validation');
      await owner('QA Team');
      await tms('TC-LGN-022');
      await fromWorkbook('TC-LGN-022');
      await severity('normal');

      await expect(loginPage.usernameInput)
        .toHaveAttribute('maxlength', String(FIELD_MAX_LENGTH.username));

      const atLimit = 'a'.repeat(FIELD_MAX_LENGTH.username);
      expect(await loginPage.typeUsername(atLimit)).toBe(atLimit);
    }
  );

  test(
    'TC-LGN-023 truncates a username longer than the maximum',
    { tag: [...BASE, TAG.validation] },
    async ({ loginPage }) => {
      await epic('Authentication');
      await feature('Login');
      await story('Username validation');
      await owner('QA Team');
      await tms('TC-LGN-023');
      await fromWorkbook('TC-LGN-023');
      await severity('normal');

      const kept = await loginPage.typeUsername('a'.repeat(FIELD_MAX_LENGTH.username + 10));
      expect(kept.length, 'the field must cap input at its maxlength')
        .toBe(FIELD_MAX_LENGTH.username);
    }
  );

  test(
    'TC-LGN-027 clears the username error once the user retypes',
    { tag: [...BASE, TAG.validation] },
    async ({ loginPage }) => {
      await epic('Authentication');
      await feature('Login');
      await story('Username validation');
      await owner('QA Team');
      await tms('TC-LGN-027');
      await fromWorkbook('TC-LGN-027');
      await severity('minor');

      await loginPage.submitExpectingValidation();
      await expect(loginPage.usernameError).toBeVisible();

      await loginPage.typeUsername('user123');
      await expect(loginPage.usernameError, 'the error must clear as soon as input resumes')
        .toBeHidden();
    }
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Password validation — TC-LGN-028 … TC-LGN-033
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Login — password validation', () => {
  test.beforeEach(async ({ loginPage }) => {
    await loginPage.navigate();
  });

  test(
    'TC-LGN-028 rejects an empty password',
    { tag: [...BASE, TAG.smoke, TAG.validation] },
    async ({ loginPage }) => {
      await epic('Authentication');
      await feature('Login');
      await story('Password validation');
      await owner('QA Team');
      await tms('TC-LGN-028');
      await fromWorkbook('TC-LGN-028');
      await severity('critical');

      await loginPage.typeUsername('user123');
      await loginPage.submitExpectingValidation();

      await expect(loginPage.passwordError).toHaveText(/password is required/i);
    }
  );

  test(
    'TC-LGN-029 does not authenticate on a whitespace-only password',
    { tag: [...BASE, TAG.validation] },
    async ({ loginPage, page }) => {
      await epic('Authentication');
      await feature('Login');
      await story('Password validation');
      await owner('QA Team');
      await tms('TC-LGN-029');
      await fromWorkbook('TC-LGN-029');
      await severity('normal');
      await description(
        'Asserted as "does not sign in" rather than "shows this exact error": the ' +
          'password field has no client-side sanitiser, so the refusal may come from ' +
          'either side. Either way the user must not end up authenticated.'
      );

      // A plain click, not submitExpectingValidation(): the client accepts a
      // non-empty password, so this reaches the server and no inline validation
      // message is produced. The refusal is asserted below instead.
      await loginPage.fillForm('user123', '     ');
      await loginPage.waitUntilSubmittable();
      await loginPage.loginButton.click();
      await page.waitForTimeout(3_000);

      // Asserted as "still on the login page" rather than by URL pattern: a refused
      // login leaves the browser on the site root, which is where the login page is
      // served, so matching on the path alone proves nothing.
      await expect(loginPage.loginButton, 'the login form must still be on screen')
        .toBeVisible();
      await expect(page.locator('#sidebarMenu'), 'no dashboard may be reached').toBeHidden();
    }
  );

  test(
    'TC-LGN-030 submits a password containing special characters verbatim',
    { tag: [...BASE, TAG.validation] },
    async ({ loginPage }) => {
      await epic('Authentication');
      await feature('Login');
      await story('Password validation');
      await owner('QA Team');
      await tms('TC-LGN-030');
      await fromWorkbook('TC-LGN-030');
      await severity('critical');
      await description(
        'The password must never be sanitised — stripping a character would silently ' +
          'change the credential and make a valid password fail.'
      );

      const complex = 'P@ssw0rd!#$%^&*()_+{}|:"<>?';
      await loginPage.passwordInput.pressSequentially(complex, { delay: 5 });

      expect(await loginPage.passwordInput.inputValue(), 'the password must be kept intact')
        .toBe(complex);
    }
  );

  test(
    'TC-LGN-031 accepts a very long password without breaking the form',
    { tag: [...BASE, TAG.validation] },
    async ({ loginPage }) => {
      await epic('Authentication');
      await feature('Login');
      await story('Password validation');
      await owner('QA Team');
      await tms('TC-LGN-031');
      await fromWorkbook('TC-LGN-031');
      await severity('minor');
      await description(
        'Client-side only. The password field carries no maxlength, so an oversized ' +
          'value must be retained and the form must stay operable.'
      );

      const long = 'A1!'.repeat(200);
      await loginPage.passwordInput.fill(long);

      expect(await loginPage.passwordInput.inputValue()).toHaveLength(long.length);
      await expect(loginPage.loginButton).toBeEnabled();
    }
  );

  test(
    'TC-LGN-032 masks the password by default',
    { tag: [...BASE, TAG.validation, TAG.security] },
    async ({ loginPage }) => {
      await epic('Authentication');
      await feature('Login');
      await story('Password validation');
      await owner('QA Team');
      await tms('TC-LGN-032');
      await fromWorkbook('TC-LGN-032');
      await severity('critical');

      await expect(loginPage.passwordInput).toHaveAttribute('type', 'password');
    }
  );

  test(
    'TC-LGN-033 sets the expected autocomplete hints on the credential fields',
    { tag: [...BASE, TAG.validation, TAG.security] },
    async ({ loginPage }) => {
      await epic('Authentication');
      await feature('Login');
      await story('Password validation');
      await owner('QA Team');
      await tms('TC-LGN-033');
      await fromWorkbook('TC-LGN-033');
      await severity('minor');
      await description(
        'The captcha must be autocomplete="off" — a browser refilling a one-time ' +
          'challenge from history defeats it.'
      );

      await expect(loginPage.usernameInput).toHaveAttribute('autocomplete', 'username');
      await expect(loginPage.passwordInput).toHaveAttribute('autocomplete', 'current-password');
      await expect(loginPage.captchaInput).toHaveAttribute('autocomplete', 'off');
    }
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Captcha — TC-LGN-034, TC-LGN-045
//
// Only the two cases that are meaningful here. The rest of the workbook's captcha
// module (035–038, 047, 048) asserts that a *wrong* code is rejected, which
// presumes Captcha:BypassFlag = N. On this environment bypass is on —
// /Home/ValidateCaptchaCode returns {"valid":true} for every value tried,
// including the empty string — so those tests would go green while testing
// nothing, which is worse than not having them. They belong on an environment
// with the flag off. The two below check the *required* rule, which runs on the
// client and is independent of the flag.
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Login — captcha field', () => {
  test.beforeEach(async ({ loginPage }) => {
    await loginPage.navigate();
  });

  test(
    'TC-LGN-034 rejects an empty captcha',
    { tag: [...BASE, TAG.smoke, TAG.validation, TAG.captcha] },
    async ({ loginPage }) => {
      await epic('Authentication');
      await feature('Login');
      await story('Captcha');
      await owner('QA Team');
      await tms('TC-LGN-034');
      await fromWorkbook('TC-LGN-034');
      await severity('critical');

      await loginPage.fillForm('user123', 'Thinkpad@1', '');
      await loginPage.submitExpectingValidation();

      await expect(loginPage.captchaError).toHaveText(/captcha is required/i);
    }
  );

  test(
    'TC-LGN-045 caps the captcha field at six characters',
    { tag: [...BASE, TAG.validation, TAG.captcha] },
    async ({ loginPage }) => {
      await epic('Authentication');
      await feature('Login');
      await story('Captcha');
      await owner('QA Team');
      await tms('TC-LGN-045');
      await fromWorkbook('TC-LGN-045');
      await severity('minor');

      await expect(loginPage.captchaInput)
        .toHaveAttribute('maxlength', String(FIELD_MAX_LENGTH.captcha));

      const kept = await loginPage.typeCaptcha('ABCDEFGHIJ');
      expect(kept, 'the captcha field must not accept more than its issued length')
        .toHaveLength(FIELD_MAX_LENGTH.captcha);
    }
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Input retention — TC-LGN-070, TC-LGN-071
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Login — input retention', () => {
  test.beforeEach(async ({ loginPage }) => {
    await loginPage.navigate();
  });

  test(
    'TC-LGN-070 keeps the typed password when the submit is refused',
    { tag: [...BASE, TAG.validation] },
    async ({ loginPage }) => {
      await epic('Authentication');
      await feature('Login');
      await story('Input retention');
      await owner('QA Team');
      await tms('TC-LGN-070');
      await fromWorkbook('TC-LGN-070');
      await severity('normal');
      await description(
        'Driven through the empty-captcha refusal, which is the failure this ' +
          'environment can actually produce; the workbook frames it as a wrong ' +
          'captcha, but bypass is enabled on QA so a wrong value is accepted. ' +
          'The behaviour under test — the form is refused and the password survives ' +
          '— is identical.'
      );

      const password = 'Thinkpad@1';
      await loginPage.fillForm('user123', password, '');
      await loginPage.submitExpectingValidation();

      await expect(loginPage.captchaError).toBeVisible();
      expect(await loginPage.passwordInput.inputValue(), 'the password must not be cleared')
        .toBe(password);
      expect(await loginPage.usernameInput.inputValue(), 'the username must not be cleared')
        .toBe('user123');
    }
  );

  test(
    'TC-LGN-071 keeps the username after the server rejects the credentials',
    { tag: [...BASE, TAG.validation, TAG.authentication] },
    async ({ loginPage }) => {
      await epic('Authentication');
      await feature('Login');
      await story('Input retention');
      await owner('QA Team');
      await tms('TC-LGN-071');
      await fromWorkbook('TC-LGN-071');
      await severity('normal');
      await description(
        'A round trip to the server, unlike the rest of this group. Uses a rotating ' +
          'throwaway username so no real account accrues failed attempts.'
      );

      const throwaway = negativeLoginUser();
      await loginPage.login(throwaway, WRONG_PASSWORD);

      expect(await loginPage.usernameInput.inputValue(), 'the username must survive the failure')
        .toBe(throwaway);
    }
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Authentication — TC-LGN-050 … TC-LGN-064, TC-LGN-137
//
// Serial: these are the only tests that hold a session, and FleetPlus permits one
// session per user. Running them in parallel makes them fight each other over the
// "already signed in on another device" prompt.
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Login — authentication', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ loginPage }) => {
    await loginPage.navigate();
    await loginPage.assertLoginPageLoaded();
  });

  test(
    'TC-LGN-052 valid credentials reach the dashboard',
    { tag: [...BASE, TAG.smoke, TAG.sanity, TAG.authentication] },
    async ({ loginPage, dashboardPage, page }) => {
      await epic('Authentication');
      await feature('Login');
      await story('Successful login');
      await owner('QA Team');
      await tms('TC-LGN-052');
      await fromWorkbook('TC-LGN-052');
      await severity('critical');
      await description('Form -> role selection (if offered) -> OTP -> dashboard.');

      const { mobile, password } = FleetPlusTestData.getPrimaryCredential();
      await loginPage.login(mobile, password);

      // Name the interstitial rather than letting it surface as "no sidebar". A
      // forced password change is an account problem, not a login defect.
      await expect(
        page,
        'Login landed on the forced password-change screen. Complete the change for ' +
          'this account and update the workbook, or pin a working account with ' +
          'PRIMARY_CREDENTIAL_MOBILE.'
      ).not.toHaveURL(/ChangePassword/i);

      await dashboardPage.assertDashboardLoaded();
    }
  );

  test(
    'TC-LGN-063 an unknown username is rejected with a generic error',
    { tag: [...BASE, TAG.smoke, TAG.sanity, TAG.authentication] },
    async ({ loginPage }) => {
      await epic('Authentication');
      await feature('Login');
      await story('Rejected credentials');
      await owner('QA Team');
      await tms('TC-LGN-063');
      await fromWorkbook('TC-LGN-063');
      await severity('critical');
      await description('An unknown user with a wrong password gets an error, not a session.');

      const username = negativeLoginUser();
      await loginPage.login(username, WRONG_PASSWORD);

      // A locked account also shows an error, so a bare "some error appeared" check
      // would pass while testing nothing at all.
      if (await loginPage.isAccountLocked()) {
        throw new Error(
          `Could not test credential rejection: ${username} is locked out. ` +
            `Unset NEGATIVE_LOGIN_USER to rotate the username per run, or point it at ` +
            `a freshly unlocked account.`
        );
      }

      await loginPage.assertErrorContains(INVALID_CREDENTIALS);
    }
  );

  test(
    'TC-LGN-137 logout returns the user to the login page',
    { tag: [...BASE, TAG.smoke, TAG.session] },
    async ({ loginPage, dashboardPage }) => {
      await epic('Authentication');
      await feature('Login');
      await story('Logout');
      await owner('QA Team');
      await tms('TC-LGN-137');
      await fromWorkbook('TC-LGN-137');
      await severity('normal');

      const { mobile, password } = credentialFor('dsa');
      await loginPage.login(mobile, password);
      await dashboardPage.assertDashboardLoaded();

      await dashboardPage.logout();
      await loginPage.assertLoginPageLoaded();
    }
  );

  test(
    'TC-LGN-051 a multi-profile account is offered its roles before 2FA',
    { tag: [...BASE, TAG.smoke, TAG.authentication, TAG.roles] },
    async ({ loginPage, userTypeSelectionPage }) => {
      await epic('Authentication');
      await feature('Login');
      await story('Role selection');
      await owner('QA Team');
      await tms('TC-LGN-051');
      await fromWorkbook('TC-LGN-051');
      await severity('normal');
      await description('Accounts holding several roles must choose one before 2FA.');

      // Named explicitly rather than taken from getPrimaryCredential(): most accounts
      // hold a single role and skip this step entirely, so the primary would silently
      // skip the test.
      const multiRole = FleetPlusTestData.getCredentialByUserType('customer admin');
      test.skip(!multiRole, 'No multi-role account marked Ready in the credentials workbook.');

      await loginPage.signIn(multiRole!.mobile, multiRole!.password);

      test.skip(
        !(await userTypeSelectionPage.isPresent()),
        'This account holds a single role, so the app skips the selection step.'
      );

      const roles = await userTypeSelectionPage.availableRoles();
      expect(roles.length).toBeGreaterThan(0);

      // Every card must carry the attributes the page object selects on — this is
      // what makes role selection robust rather than text-matched.
      for (const role of roles) {
        expect(role.code, `role card without a data-code: ${JSON.stringify(role)}`).not.toBe('');
        expect(role.userId, `role card without a data-userid: ${role.code}`).not.toBe('');
      }
    }
  );

  test(
    'TC-LGN-064 a locked account is reported as locked, not as a bad credential',
    { tag: [...BASE, TAG.authentication, TAG_NEEDS_DATA] },
    async ({ loginPage }) => {
      await epic('Authentication');
      await feature('Login');
      await story('Account lockout');
      await owner('QA Team');
      await tms('TC-LGN-064');
      await fromWorkbook('TC-LGN-064');
      await severity('normal');
      await description(
        'A locked account must be reported as locked, not as a rejected credential — ' +
          'they need different remedies.'
      );

      test.skip(!LOCKED_USER, NEEDS_LOCKED_ACCOUNT);

      const { password } = FleetPlusTestData.getPrimaryCredential();
      await loginPage.login(LOCKED_USER as string, password);
      await loginPage.assertErrorContains(ACCOUNT_LOCKED);
    }
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// TC-LGN-050 — every credential in the workbook, one test each.
//
// The group above proves the login *mechanism* with a couple of accounts; this
// proves the *accounts*. Each row is a real user with its own role, region and
// password, and any of them can be locked or expire independently. One test per
// row means a broken account is named in the report instead of silently never
// being exercised.
// ─────────────────────────────────────────────────────────────────────────────

/** Loaded at module scope, so a missing workbook must not crash collection. */
const allCredentials = (() => {
  try {
    return FleetPlusTestData.getCredentials();
  } catch (error) {
    console.warn(`Could not read credentials workbook: ${(error as Error).message}`);
    return [];
  }
})();

test.describe('Login — every credential in the workbook', () => {
  // Deliberately NOT serial. Each test signs in as a different account and shares
  // no state with its neighbours, so there is nothing for serial mode to protect —
  // and its abort-on-first-failure behaviour actively hurts here: one account with
  // a stale password stopped the six behind it from running at all, turning a
  // one-account data problem into a seven-account blind spot. The point of this
  // group is to report on every row, especially when one of them is broken.
  test.describe.configure({ mode: 'default' });

  test.skip(
    allCredentials.length === 0,
    'No credentials could be read from the workbook — see the warning logged at collection.'
  );

  for (const cred of allCredentials) {
    const label = [cred.userType, cred.mobile, cred.region].filter(Boolean).join(' · ');

    test(
      `TC-LGN-050 ${label} can sign in`,
      { tag: [...BASE, TAG.authentication, TAG.roles] },
      async ({ loginPage, dashboardPage, page }) => {
        await epic('Authentication');
        await feature('Login');
        await owner('QA Team');
        await tms('TC-LGN-050');
        await fromWorkbook('TC-LGN-050');
        await story(`Role: ${cred.userType || 'unspecified'}`);
        await severity('critical');
        await description(
          `Signs in as ${cred.mobile} (${cred.userType || 'role unspecified'}` +
            `${cred.region ? `, ${cred.region}` : ''}) and confirms a dashboard.`
        );

        await loginPage.navigate();
        await loginPage.login(cred.mobile, cred.password);

        // Classify the account's own state before asserting on the dashboard.
        // All three of these end at "no dashboard", but they need different
        // people to do different things, and a bare "sidebar never rendered"
        // tells the reader none of that.
        const errors = await loginPage.getErrorMessages();
        const rejected = Object.values(errors).find(text => INVALID_CREDENTIALS.test(text));
        const locked = Object.values(errors).find(text => ACCOUNT_LOCKED.test(text));

        expect(
          locked,
          `${cred.mobile} (${cred.userType}) is LOCKED OUT — the app said ` +
            `"${locked}". Unlock it in FleetPlus before this row can be tested.`
        ).toBeUndefined();

        expect(
          rejected,
          `${cred.mobile} (${cred.userType}) was REJECTED — the app said ` +
            `"${rejected}". The password recorded for this row in ` +
            `FleetPlusUsercredentials.xlsx no longer matches the account. Correct ` +
            `the workbook; do not retry by guessing, as five failures lock the account.`
        ).toBeUndefined();

        await expect(
          page,
          `${cred.mobile} landed on the forced password-change screen. Reset it in ` +
            `FleetPlus and update the workbook.`
        ).not.toHaveURL(/ChangePassword/i);

        await dashboardPage.assertDashboardLoaded();

        // Release the account; FleetPlus keeps one session per user and an
        // abandoned one prompts "already signed in" on the next run.
        //
        // endSession() rather than logout(): this test is about whether the
        // *account* can sign in, and a fault in the logout control must not be
        // reported against it. TC-LGN-137 is what covers logout. Getting this
        // wrong is what previously turned one broken menu into a failure for
        // this account plus six others that never ran behind it.
        await dashboardPage.endSession();
      }
    );
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Forgot Password — TC-LGN-081 … TC-LGN-096
//
// Split in two. The username step sends nothing to anyone and runs every pass.
// Anything past "Generate OTP" sends a real SMS to a real registered mobile and,
// if completed, changes that account's password — so it is gated behind
// FORGOT_PASSWORD_TEST_USER.
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Forgot Password — dialog and username step', () => {
  test.beforeEach(async ({ loginPage }) => {
    await loginPage.navigate();
  });

  test(
    'TC-LGN-081 the Forgot Password dialog opens at the username step',
    { tag: [...BASE, TAG.smoke, TAG.forgotPassword] },
    async ({ loginPage }) => {
      await epic('Authentication');
      await feature('Forgot Password');
      await story('Dialog');
      await owner('QA Team');
      await tms('TC-LGN-081');
      await fromWorkbook('TC-LGN-081');
      await severity('critical');

      await loginPage.forgotPassword.open();

      await expect(loginPage.forgotPassword.title).toHaveText(/forgot password/i);
      await expect(loginPage.forgotPassword.usernameInput).toBeVisible();
      await expect(loginPage.forgotPassword.submitButton).toHaveText(/generate otp/i);
      await expect(
        loginPage.forgotPassword.otpInput,
        'the OTP step must not be reachable before an OTP is issued'
      ).toBeHidden();
    }
  );

  test(
    'TC-LGN-084 an empty username is refused inside the dialog',
    { tag: [...BASE, TAG.forgotPassword] },
    async ({ loginPage }) => {
      await epic('Authentication');
      await feature('Forgot Password');
      await story('Username step');
      await owner('QA Team');
      await tms('TC-LGN-084');
      await fromWorkbook('TC-LGN-084');
      await severity('critical');

      const modal = loginPage.forgotPassword;
      await modal.open();
      await modal.submit();

      expect(await modal.waitForError('username')).toMatch(/username is required/i);
      expect(await modal.isOnOtpStep(), 'the dialog must not advance').toBe(false);
    }
  );

  test(
    'TC-LGN-085 the dialog sanitises the username exactly as the login form does',
    { tag: [...BASE, TAG.forgotPassword, TAG.security] },
    async ({ loginPage }) => {
      await epic('Authentication');
      await feature('Forgot Password');
      await story('Username step');
      await owner('QA Team');
      await tms('TC-LGN-085');
      await fromWorkbook('TC-LGN-085');
      await severity('critical');
      await description(
        'The modal is a second entry point for the same value; a sanitiser applied ' +
          'on the login form but not here would be a bypass.'
      );

      const modal = loginPage.forgotPassword;
      await modal.open();
      await modal.fillUsername('<script>alert(1)</script>');

      const kept = await modal.usernameValue();
      expect(kept, `angle brackets survived in ${JSON.stringify(kept)}`).not.toMatch(/[<>]/);
      expect(kept, `${JSON.stringify(kept)} contains a disallowed character`)
        .toMatch(USERNAME_ALLOWED_CHARACTERS);
    }
  );

  test(
    'TC-LGN-086 a non-existent username does not reveal that the account is unknown',
    { tag: [...BASE, TAG.forgotPassword, TAG.security] },
    async ({ loginPage }) => {
      await epic('Authentication');
      await feature('Forgot Password');
      await story('Username step');
      await owner('QA Team');
      await tms('TC-LGN-086');
      await fromWorkbook('TC-LGN-086');
      await severity('critical');
      await description(
        'Account enumeration: the response for an unknown username must not be ' +
          'distinguishable by wording from one for a real account.\n\n' +
          '**Known defect — this test is expected to fail.** FleetPlus answers ' +
          '"User not found" for a username that does not exist, so anyone can ' +
          'determine whether a given mobile number is registered, one request at a ' +
          'time and without authenticating. The fix is server-side: return the same ' +
          'wording ("If the account exists, an OTP has been sent") in both cases.\n\n' +
          'Marked test.fail() so the suite reports the truth without going red every ' +
          'run. It flips to a failure the moment the application is fixed, which is ' +
          'the signal to remove this annotation.'
      );

      // Expected to fail: see the description above. Remove once the server stops
      // distinguishing unknown usernames from real ones.
      test.fail(
        true,
        'Known defect: Forgot Password discloses account existence with "User not found".'
      );

      const modal = loginPage.forgotPassword;
      await modal.open();
      await modal.requestOtp(negativeLoginUser(), 8_000);

      const message = await modal.waitForAnyError();
      expect(
        message,
        `The dialog disclosed account existence: ${JSON.stringify(message)}`
      ).not.toMatch(/not (found|registered|exist)|does not exist|no such user|unknown user/i);
    }
  );

  test(
    'TC-LGN-098 the dialog is fully reset when closed and reopened',
    { tag: [...BASE, TAG.forgotPassword] },
    async ({ loginPage }) => {
      await epic('Authentication');
      await feature('Forgot Password');
      await story('Dialog');
      await owner('QA Team');
      await tms('TC-LGN-098');
      await fromWorkbook('TC-LGN-098');
      await severity('normal');
      await description(
        'A dialog that keeps its previous value leaks one user’s username into the ' +
          'next attempt, and a stale error makes the form look broken on reopen.'
      );

      const modal = loginPage.forgotPassword;

      await modal.open();
      await modal.submit(); // provoke an error to prove it is cleared too
      expect(await modal.errorFor('username')).not.toBe('');
      await modal.fillUsername('leftoveruser');
      await modal.close();

      await modal.open();
      expect(await modal.usernameValue(), 'the username field must be empty on reopen').toBe('');
      expect(await modal.errorFor('username'), 'the error must not persist').toBe('');
    }
  );
});

test.describe('Forgot Password — OTP step', () => {
  // Not gated. Every test here refuses verification on purpose or only inspects
  // the field, so none can reset the account's password — see OTP_FLOW_USER.
  test.beforeEach(async ({ loginPage }) => {
    await loginPage.navigate();
  });

  test(
    'TC-LGN-082 an OTP is issued for a valid username',
    { tag: [...BASE, TAG.smoke, TAG.forgotPassword] },
    async ({ loginPage }) => {
      await epic('Authentication');
      await feature('Forgot Password');
      await story('OTP step');
      await owner('QA Team');
      await tms('TC-LGN-082');
      await fromWorkbook('TC-LGN-082');
      await severity('critical');

      const modal = loginPage.forgotPassword;
      await modal.open();

      expect(
        await modal.requestOtp(otpAccount(0)),
        `No OTP was issued for ${otpAccount(0)}: ${await modal.anyError()}`
      ).toBe(true);

      // Asserted as "the dialog advanced and said nothing was wrong". An earlier
      // version checked #forgot_otp_userid for a bound user id — the field exists
      // but stays empty, so the binding is kept server-side in session. That was
      // an assumption about the implementation, not a requirement.
      expect(await modal.anyError(), 'the dialog must not report an error').toBe('');
      await expect(modal.otpInput).toBeVisible();
    }
  );

  test(
    'TC-LGN-089 an OTP shorter than six digits is refused',
    { tag: [...BASE, TAG.forgotPassword] },
    async ({ loginPage }) => {
      await epic('Authentication');
      await feature('Forgot Password');
      await story('OTP step');
      await owner('QA Team');
      await tms('TC-LGN-089');
      await fromWorkbook('TC-LGN-089');
      await severity('normal');

      const modal = loginPage.forgotPassword;
      await modal.open();
      const issued = await modal.requestOtp(otpAccount(1));
      expect(issued, `OTP step not reached for ${otpAccount(1)}: ${await modal.anyError()}`).toBe(true);

      await modal.fillOtp('123');
      await modal.submit();

      expect(await modal.waitForError('otp'), 'a short OTP must be refused before verification')
        .not.toBe('');
    }
  );

  test(
    'TC-LGN-090 an empty OTP is refused',
    { tag: [...BASE, TAG.forgotPassword] },
    async ({ loginPage }) => {
      await epic('Authentication');
      await feature('Forgot Password');
      await story('OTP step');
      await owner('QA Team');
      await tms('TC-LGN-090');
      await fromWorkbook('TC-LGN-090');
      await severity('normal');

      const modal = loginPage.forgotPassword;
      await modal.open();
      const issued = await modal.requestOtp(otpAccount(2));
      expect(issued, `OTP step not reached for ${otpAccount(2)}: ${await modal.anyError()}`).toBe(true);

      await modal.submit();
      expect(await modal.waitForError('otp')).not.toBe('');
    }
  );

  test(
    'TC-LGN-093 non-numeric characters are blocked in the OTP field',
    { tag: [...BASE, TAG.forgotPassword] },
    async ({ loginPage }) => {
      await epic('Authentication');
      await feature('Forgot Password');
      await story('OTP step');
      await owner('QA Team');
      await tms('TC-LGN-093');
      await fromWorkbook('TC-LGN-093');
      await severity('normal');

      const modal = loginPage.forgotPassword;
      await modal.open();
      const issued = await modal.requestOtp(otpAccount(3));
      expect(issued, `OTP step not reached for ${otpAccount(3)}: ${await modal.anyError()}`).toBe(true);

      await modal.fillOtp('12ab#!');
      expect(await modal.otpValue(), 'the OTP field must accept digits only').toMatch(/^\d*$/);
    }
  );

  test(
    'TC-LGN-094 the OTP field caps at six digits',
    { tag: [...BASE, TAG.forgotPassword] },
    async ({ loginPage }) => {
      await epic('Authentication');
      await feature('Forgot Password');
      await story('OTP step');
      await owner('QA Team');
      await tms('TC-LGN-094');
      await fromWorkbook('TC-LGN-094');
      await severity('minor');
      await description(
        'Asserted without issuing an OTP. The field is rendered at page load and ' +
          'only revealed at step two, so its length limit is readable without ' +
          'spending an OTP request — which matters because the app throttles ' +
          'those to one per account per 100 seconds, and there are more tests in ' +
          'this group than there are accounts to spread them over. TC-LGN-093 ' +
          'covers what the field does with typed input.'
      );

      const modal = loginPage.forgotPassword;
      await modal.open();

      await expect(modal.otpInput).toHaveAttribute('maxlength', '6');
    }
  );

  test(
    'TC-LGN-091 an incorrect OTP is rejected',
    { tag: [...BASE, TAG.forgotPassword, TAG.security] },
    async ({ loginPage }) => {
      await epic('Authentication');
      await feature('Forgot Password');
      await story('OTP step');
      await owner('QA Team');
      await tms('TC-LGN-091');
      await fromWorkbook('TC-LGN-091');
      await severity('critical');

      const modal = loginPage.forgotPassword;
      await modal.open();
      const issued = await modal.requestOtp(otpAccount(4));
      expect(issued, `OTP step not reached for ${otpAccount(4)}: ${await modal.anyError()}`).toBe(true);

      await modal.fillOtp('000000');
      await modal.submit();

      expect(await modal.waitForError('otp'), 'a wrong OTP must not be accepted').not.toBe('');
    }
  );

  test(
    'TC-LGN-096 Resend is blocked while the cooldown is running',
    { tag: [...BASE, TAG.forgotPassword] },
    async ({ loginPage }) => {
      await epic('Authentication');
      await feature('Forgot Password');
      await story('OTP step');
      await owner('QA Team');
      await tms('TC-LGN-096');
      await fromWorkbook('TC-LGN-096');
      await severity('normal');
      await description('An unthrottled resend is an SMS-cost and abuse vector.');

      const modal = loginPage.forgotPassword;
      await modal.open();
      const issued = await modal.requestOtp(otpAccount(5));
      expect(issued, `OTP step not reached for ${otpAccount(5)}: ${await modal.anyError()}`).toBe(true);

      expect(
        await modal.isResendEnabled(),
        'Resend must be disabled immediately after an OTP is issued'
      ).toBe(false);
    }
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Unlock User — TC-LGN-104 … TC-LGN-119
//
// The same widget as Forgot Password under a different id prefix, so it is driven
// through the same component. What differs is the precondition: unlock is only
// meaningful for an account that is actually locked, and locking one is a
// destructive act this suite will not perform.
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Unlock User — dialog and username step', () => {
  test.beforeEach(async ({ loginPage }) => {
    await loginPage.navigate();
  });

  test(
    'TC-LGN-104 the Unlock User dialog opens at the username step',
    { tag: [...BASE, TAG.smoke, TAG.unlockUser] },
    async ({ loginPage }) => {
      await epic('Authentication');
      await feature('Unlock User');
      await story('Dialog');
      await owner('QA Team');
      await tms('TC-LGN-104');
      await fromWorkbook('TC-LGN-104');
      await severity('critical');

      await loginPage.unlockUser.open();

      await expect(loginPage.unlockUser.title).toHaveText(/unlock user/i);
      await expect(loginPage.unlockUser.usernameInput).toBeVisible();
      await expect(loginPage.unlockUser.submitButton).toHaveText(/generate otp/i);
      await expect(loginPage.unlockUser.otpInput).toBeHidden();
    }
  );

  test(
    'TC-LGN-105 the dialog prefills the username already typed on the login form',
    { tag: [...BASE, TAG.unlockUser] },
    async ({ loginPage }) => {
      await epic('Authentication');
      await feature('Unlock User');
      await story('Dialog');
      await owner('QA Team');
      await tms('TC-LGN-105');
      await fromWorkbook('TC-LGN-105');
      await severity('normal');
      await description(
        'A user reaches this dialog because their sign-in was refused, so the ' +
          'username is already on screen; making them retype it is the moment they ' +
          'mistype it.'
      );

      await loginPage.typeUsername('9611200199');
      await loginPage.unlockUser.open();

      expect(await loginPage.unlockUser.usernameValue(), 'username carried into the dialog')
        .toBe('9611200199');
    }
  );

  test(
    'TC-LGN-109 an empty username is refused inside the dialog',
    { tag: [...BASE, TAG.unlockUser] },
    async ({ loginPage }) => {
      await epic('Authentication');
      await feature('Unlock User');
      await story('Username step');
      await owner('QA Team');
      await tms('TC-LGN-109');
      await fromWorkbook('TC-LGN-109');
      await severity('critical');

      const modal = loginPage.unlockUser;
      await modal.open();
      await modal.usernameInput.fill('');
      await modal.submit();

      expect(await modal.waitForError('username')).toMatch(/username is required/i);
      expect(await modal.isOnOtpStep(), 'the dialog must not advance').toBe(false);
    }
  );

  test(
    'TC-LGN-115 a resend request without a username is handled',
    { tag: [...BASE, TAG.unlockUser] },
    async ({ loginPage }) => {
      await epic('Authentication');
      await feature('Unlock User');
      await story('Username step');
      await owner('QA Team');
      await tms('TC-LGN-115');
      await fromWorkbook('TC-LGN-115');
      await severity('minor');
      await description(
        'Resend is not offered before an OTP exists. The assertion is that the ' +
          'control is unavailable rather than that clicking it errors — an ' +
          'unreachable control cannot misbehave.'
      );

      const modal = loginPage.unlockUser;
      await modal.open();

      expect(
        await modal.isResendEnabled(),
        'Resend must not be actionable before an OTP has been issued'
      ).toBe(false);
    }
  );

  test(
    'TC-LGN-119 the two pre-login dialogs never stack',
    { tag: [...BASE, TAG.unlockUser, TAG.forgotPassword] },
    async ({ loginPage }) => {
      await epic('Authentication');
      await feature('Unlock User');
      await story('Dialog');
      await owner('QA Team');
      await tms('TC-LGN-119');
      await fromWorkbook('TC-LGN-119');
      await severity('normal');
      await description(
        'Confirmed against QA: the open dialog’s backdrop intercepts the other ' +
          'trigger, so the second link is unreachable rather than opening behind ' +
          'the first. Asserted through pointer-event reachability, which is what a ' +
          'user actually experiences.'
      );

      await loginPage.unlockUser.open();

      // A short timeout on purpose: the assertion is that this click *cannot* land.
      const secondOpened = await loginPage.forgotPasswordLink
        .click({ timeout: 3_000 })
        .then(() => true)
        .catch(() => false);

      expect(secondOpened, 'the Forgot Password link must be unreachable while Unlock is open')
        .toBe(false);
      expect(await loginPage.forgotPassword.isOpen(), 'Forgot Password must not have opened')
        .toBe(false);
      expect(await loginPage.unlockUser.isOpen(), 'Unlock User must still be the active dialog')
        .toBe(true);
    }
  );

  test(
    'TC-LGN-110 an unlock request for an account that is not locked is refused',
    { tag: [...BASE, TAG.unlockUser] },
    async ({ loginPage }) => {
      await epic('Authentication');
      await feature('Unlock User');
      await story('Username step');
      await owner('QA Team');
      await tms('TC-LGN-110');
      await fromWorkbook('TC-LGN-110');
      await severity('normal');
      await description(
        'Uses a healthy workbook account. Safe to run: the request is expected to ' +
          'be refused, so no OTP is sent and nothing about the account changes.'
      );

      const { mobile } = FleetPlusTestData.getPrimaryCredential();
      const modal = loginPage.unlockUser;
      await modal.open();

      const advanced = await modal.requestOtp(mobile, 10_000);

      expect(
        advanced,
        `An unlock OTP was issued for ${mobile}, which is not locked. Unlock must ` +
          `not be usable as a general OTP oracle.`
      ).toBe(false);
      expect(await modal.waitForAnyError(), 'the refusal must be explained to the user')
        .not.toBe('');
    }
  );
});

test.describe('Unlock User — locked account', () => {
  test.skip(!LOCKED_USER, NEEDS_LOCKED_ACCOUNT);

  test.beforeEach(async ({ loginPage }) => {
    await loginPage.navigate();
  });

  test(
    'TC-LGN-106 an unlock OTP is issued for a locked account',
    { tag: [...BASE, TAG.smoke, TAG.unlockUser, TAG_NEEDS_DATA] },
    async ({ loginPage }) => {
      await epic('Authentication');
      await feature('Unlock User');
      await story('Locked account');
      await owner('QA Team');
      await tms('TC-LGN-106');
      await fromWorkbook('TC-LGN-106');
      await severity('critical');

      const modal = loginPage.unlockUser;
      await modal.open();

      expect(
        await modal.requestOtp(LOCKED_USER as string),
        `No unlock OTP was issued for ${LOCKED_USER}: ${await modal.anyError()}`
      ).toBe(true);
      expect(await modal.hiddenUserId.inputValue()).not.toBe('');
    }
  );

  test(
    'TC-LGN-111 an incorrect unlock OTP is rejected',
    { tag: [...BASE, TAG.unlockUser, TAG.security, TAG_NEEDS_DATA] },
    async ({ loginPage }) => {
      await epic('Authentication');
      await feature('Unlock User');
      await story('Locked account');
      await owner('QA Team');
      await tms('TC-LGN-111');
      await fromWorkbook('TC-LGN-111');
      await severity('critical');

      const modal = loginPage.unlockUser;
      await modal.open();
      expect(await modal.requestOtp(LOCKED_USER as string), 'OTP step not reached').toBe(true);

      await modal.fillOtp('000000');
      await modal.submit();

      expect(await modal.waitForError('otp'), 'a wrong OTP must not unlock the account')
        .not.toBe('');
    }
  );

  test(
    'TC-LGN-112 the unlock OTP field enforces its length',
    { tag: [...BASE, TAG.unlockUser, TAG_NEEDS_DATA] },
    async ({ loginPage }) => {
      await epic('Authentication');
      await feature('Unlock User');
      await story('Locked account');
      await owner('QA Team');
      await tms('TC-LGN-112');
      await fromWorkbook('TC-LGN-112');
      await severity('normal');

      const modal = loginPage.unlockUser;
      await modal.open();
      expect(await modal.requestOtp(LOCKED_USER as string), 'OTP step not reached').toBe(true);

      await expect(modal.otpInput).toHaveAttribute('maxlength', '6');
      await modal.fillOtp('1234567890');
      expect(await modal.otpValue()).toHaveLength(6);

      await modal.fillOtp('123');
      await modal.submit();
      expect(await modal.waitForError('otp'), 'a short OTP must be refused').not.toBe('');
    }
  );

  test(
    'TC-LGN-114 Resend is blocked while the unlock cooldown is running',
    { tag: [...BASE, TAG.unlockUser, TAG_NEEDS_DATA] },
    async ({ loginPage }) => {
      await epic('Authentication');
      await feature('Unlock User');
      await story('Locked account');
      await owner('QA Team');
      await tms('TC-LGN-114');
      await fromWorkbook('TC-LGN-114');
      await severity('normal');

      const modal = loginPage.unlockUser;
      await modal.open();
      expect(await modal.requestOtp(LOCKED_USER as string), 'OTP step not reached').toBe(true);

      expect(await modal.isResendEnabled(), 'Resend must be throttled after an OTP is sent')
        .toBe(false);
    }
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Security and UX — TC-LGN-138 … TC-LGN-149
//
// Properties of the response and the page rather than of any account: cheap, safe,
// and the cases most likely to regress silently — nobody notices a dropped security
// header until an audit.
//
// Not covered, and why:
//   TC-LGN-141 — anti-forgery enforcement needs a forged POST; belongs in the API
//                project, not a browser test.
//   TC-LGN-143 — restoring credentials from the browser cache cannot be forced
//                deterministically.
//   TC-LGN-145/146/147 — responsive, cross-browser and keyboard accessibility. The
//                first two are a project-matrix concern; the third belongs with an
//                axe scan.
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Login — security and UX', () => {

  test(
    'TC-LGN-140 a hostile message parameter is not reflected into the page',
    { tag: [...BASE, TAG.security] },
    async ({ loginPage, page }) => {
      await epic('Authentication');
      await feature('Login');
      await story('Security and UX');
      await owner('QA Team');
      await tms('TC-LGN-140');
      await fromWorkbook('TC-LGN-140');
      await severity('critical');
      await description(
        'The ?message= parameter is written into the page after a session expiry. ' +
          'If it were rendered as HTML it would be a reflected XSS on an ' +
          'unauthenticated endpoint — about the worst place to have one.'
      );

      const payload = '<img src=x onerror=alert(1)>';

      // Fails the test rather than being ignored: an executed payload is the whole
      // thing this case exists to catch.
      const dialogs: string[] = [];
      page.on('dialog', async d => {
        dialogs.push(d.message());
        await d.dismiss();
      });

      const response = await page.goto(`/Home/Login?message=${encodeURIComponent(payload)}`, {
        waitUntil: 'domcontentloaded',
      });
      await page.waitForTimeout(2_000);

      // A network security proxy in front of the browser will block a URL carrying
      // a script payload before it ever reaches FleetPlus, and answer with its own
      // interstitial. Passing on that response would be reporting the proxy's
      // protection as the application's — so the test refuses to draw a conclusion.
      const reachedTheApp = (await page.locator('#btnLogin').count()) > 0;
      test.skip(
        !reachedTheApp,
        `The request never reached FleetPlus — it was answered by an intermediary ` +
          `(HTTP ${response?.status()}, "${await page.title()}"). Run this from an ` +
          `unfiltered network to get a verdict on the application itself.`
      );

      expect(dialogs, 'the payload executed').toEqual([]);
      expect(await page.locator('#message img').count(), 'an element was injected').toBe(0);
      expect(
        await loginPage.flashMessage.innerHTML().catch(() => ''),
        'the message banner must not contain markup from the query string'
      ).not.toMatch(/<img|onerror/i);
    }
  );

  test(
    'TC-LGN-142 the login response carries the expected security headers',
    { tag: [...BASE, TAG.security] },
    async ({ page }) => {
      await epic('Authentication');
      await feature('Login');
      await story('Security and UX');
      await owner('QA Team');
      await tms('TC-LGN-142');
      await fromWorkbook('TC-LGN-142');
      await severity('critical');

      const response = await page.goto('/Home/Login', { waitUntil: 'domcontentloaded' });
      const headers = response?.headers() ?? {};

      // Asserted one at a time so a failure names the missing header.
      expect(headers['content-security-policy'], 'Content-Security-Policy').toBeDefined();
      expect(headers['content-security-policy'], 'CSP must restrict the default source')
        .toContain("default-src 'self'");
      expect(headers['content-security-policy'], 'CSP must forbid plugin content')
        .toContain("object-src 'none'");
      expect(headers['x-content-type-options'], 'X-Content-Type-Options').toMatch(/nosniff/);
      expect(headers['x-frame-options'], 'X-Frame-Options').toMatch(/SAMEORIGIN|DENY/i);
      expect(headers['referrer-policy'], 'Referrer-Policy').toMatch(/strict-origin/);
      expect(headers['strict-transport-security'], 'Strict-Transport-Security')
        .toMatch(/max-age=\d+/);

      // A login page must never be cached; a shared machine would serve it back.
      expect(headers['cache-control'], 'Cache-Control').toMatch(/no-store/);
    }
  );

  test(
    'TC-LGN-144 the site is served over HTTPS and its session cookie is protected',
    { tag: [...BASE, TAG.security] },
    async ({ page, context }) => {
      await epic('Authentication');
      await feature('Login');
      await story('Security and UX');
      await owner('QA Team');
      await tms('TC-LGN-144');
      await fromWorkbook('TC-LGN-144');
      await severity('critical');

      await page.goto('/Home/Login', { waitUntil: 'domcontentloaded' });
      expect(page.url(), 'the login page must be served over HTTPS').toMatch(/^https:/);

      const cookies = await context.cookies();
      const session = cookies.find(c => c.name.includes('AspNetCore.Session'));
      expect(session, `no session cookie was issued; got ${cookies.map(c => c.name).join(', ')}`)
        .toBeDefined();

      expect(session?.httpOnly, 'the session cookie must be HttpOnly').toBe(true);
      expect(session?.secure, 'the session cookie must be Secure').toBe(true);
      expect(session?.sameSite, 'the session cookie must set SameSite').not.toBe('None');
    }
  );

  test(
    'TC-LGN-138 a double click on LOGIN issues only one authentication request',
    { tag: [...BASE, TAG.security] },
    async ({ loginPage, page }) => {
      await epic('Authentication');
      await feature('Login');
      await story('Security and UX');
      await owner('QA Team');
      await tms('TC-LGN-138');
      await fromWorkbook('TC-LGN-138');
      await severity('critical');
      await description(
        'Asserted by counting the requests that actually leave the browser rather ' +
          'than by checking whether the button disables — the requirement is that ' +
          'the credential is submitted once, however that is achieved. A second ' +
          'request would spend an extra failed attempt against the account and ' +
          'race two sessions into existence.'
      );

      const throwaway = negativeLoginUser();

      const loginPosts: string[] = [];
      page.on('request', request => {
        if (request.method() === 'POST' && /\/Home\/(Login|LoginComplete)/i.test(request.url())) {
          loginPosts.push(request.url());
        }
      });

      await loginPage.navigate();
      await loginPage.fillForm(throwaway, WRONG_PASSWORD);
      await loginPage.waitUntilSubmittable();

      await loginPage.loginButton.click({ noWaitAfter: true });
      await loginPage.loginButton
        .click({ noWaitAfter: true, force: true, timeout: 3_000 })
        .catch(() => undefined); // the button going away is itself a valid defence

      await page.waitForTimeout(5_000);

      expect(
        loginPosts.length,
        `The LOGIN button accepted a second submit: ${loginPosts.length} login POSTs ` +
          `were issued for one credential.`
      ).toBeLessThanOrEqual(1);
    }
  );

  test(
    'TC-LGN-149 sign-up guidance is shown for both customer types',
    { tag: [...BASE, TAG.security] },
    async ({ loginPage }) => {
      await epic('Authentication');
      await feature('Login');
      await story('Security and UX');
      await owner('QA Team');
      await tms('TC-LGN-149');
      await fromWorkbook('TC-LGN-149');
      await severity('minor');

      await loginPage.navigate();

      await expect(loginPage.fleetHelplineText).toBeVisible();
      await expect(loginPage.fleetHelplineText, 'the fleet helpline number must be shown')
        .toContainText(/1800\s?1200\s?330/);
      await expect(loginPage.personalSignUpText).toBeVisible();
      await expect(loginPage.signUpLink).toBeVisible();
    }
  );
});
