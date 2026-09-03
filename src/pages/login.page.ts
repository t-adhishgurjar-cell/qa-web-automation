import { Page, expect } from '@playwright/test';
import { BasePage } from './base.page';
import { OtpPage } from './otp.page';
import { PreLoginOtpModal } from './components/pre-login-otp-modal.component';
import { RoleSelector, UserTypeSelectionPage } from './user-type-selection.page';

/**
 * FleetPlus login — /Home/Login.
 *
 * The full journey is four stages, not two:
 *
 *   login form ──► /Home/UserTypeSelection ──► /Home/LoginOtpVerification ──► dashboard
 *   #btnLogin        .user-type-card              6 x .otp-box                 #sidebarMenu
 *
 * Stage two is conditional: it appears only for accounts holding more than one
 * role. login() walks whichever stages the app presents.
 */

/** The app's exact wording for a rejected credential, confirmed against QA. */
export const INVALID_CREDENTIALS = /invalid username or password|invalid credentials|user not found/i;

/** Lockout wording — a distinct state from "rejected", worth naming separately. */
export const ACCOUNT_LOCKED = /account has been locked|unlock your account/i;

/** The username field silently drops anything outside this set as the user types. */
export const USERNAME_ALLOWED_CHARACTERS = /^[A-Za-z0-9@._-]*$/;

/** Field length limits, read off the live markup rather than assumed. */
export const FIELD_MAX_LENGTH = { username: 50, captcha: 6 } as const;

export class LoginPage extends BasePage {
  // ─── Login form ───────────────────────────────────────────────────────────
  // Public so specs can make field-level assertions (maxlength, autocomplete,
  // masking) without duplicating selectors. Everything else stays private.
  readonly usernameInput = this.page.locator('#Username');
  readonly passwordInput = this.page.locator('#Password');
  readonly captchaInput = this.page.locator('#CaptchaCode');
  readonly loginButton = this.page.locator('#btnLogin');

  private readonly showPasswordToggle = this.page.locator('#togglePassword');

  // ─── Page furniture ───────────────────────────────────────────────────────
  // Named individually because TC-LGN-001 is a build-acceptance gate: when it
  // fails it must say *which* control is missing, not "the page looks wrong".
  readonly brandLogo = this.page.getByAltText('Nayara Energy Logo').first();
  readonly bannerImage = this.page.getByAltText('Nayara Banner');
  readonly heading = this.page.getByText('Welcome to FLEETPLUS', { exact: true });
  readonly subtitle = this.page.getByText('Please enter your details', { exact: true });
  readonly captchaImage = this.page.locator('#captchaImg');
  readonly captchaRefreshButton = this.page.locator('#captchaRefreshBtn');
  readonly forgotPasswordLink = this.page.locator('#forgotPasswordLink');
  readonly unlockUserLink = this.page.locator('#unlockUserLink');
  readonly signUpLink = this.page.getByRole('link', { name: 'Sign Up' });
  readonly fleetHelplineText = this.page.getByText(/New fleet customer sign-up/i);
  readonly personalSignUpText = this.page.getByText(/New personal customer sign-up/i);

  // ─── Hidden fields that carry the login contract ──────────────────────────
  readonly loginStageField = this.page.locator('input[name="LoginStage"]');
  readonly clientPayloadField = this.page.locator('#clientPayload');
  readonly antiForgeryField = this.page.locator('input[name="__RequestVerificationToken"]');

  /** The banner the app writes ?message=… into. */
  readonly flashMessage = this.page.locator('#message');

  // ─── Inline field validation ──────────────────────────────────────────────
  // Client-side, and distinct from the server's modals: these fill in before any
  // request is made, so a test asserting on them proves the form never submitted.
  readonly usernameError = this.page.locator('#username_error');
  readonly passwordError = this.page.locator('#password_error');
  readonly captchaError = this.page.locator('#captcha_error');

  /**
   * Hidden field, populated asynchronously by POST /Home/GetIP, and part of the
   * encrypted login payload. See waitUntilSubmittable() — the single most important
   * detail in this class.
   */
  private readonly userIpField = this.page.locator('#Userip');

  /**
   * Every surface the app uses to report a login problem.
   *
   * Two kinds, and both are needed: server-side failures write into #message or open
   * a Bootstrap modal, while client-side validation fills the inline spans. None of
   * it is reliably findable with a getByText sweep — the modals sit in the DOM
   * permanently and are populated on demand, so a text search reports "no error"
   * even while the app is displaying one.
   */
  private readonly errorSurfaces = [
    '#message',
    '#failer-mess-text',
    '#error-mess-text',
    '#username_error',
    '#password_error',
    '#captcha_error',
  ];

  /** Session-conflict prompts; which appears depends on where the clash is. */
  private readonly sessionDialogButtons = [
    '#profile-active-session-ok-btn',
    '#nayara-single-tab-takeover',
    '#nayara-profile-tab-continue-btn',
  ];

  // ─── Forgot-password / unlock-user modals ─────────────────────────────────
  // Both dialogs are the same widget under a different prefix, so they share one
  // component rather than two page objects. See PreLoginOtpModal.
  readonly forgotPassword = new PreLoginOtpModal(this.page, 'forgot');
  readonly unlockUser = new PreLoginOtpModal(this.page, 'unlock');

  constructor(page: Page) {
    super(page);
  }

  // ─── Actions ──────────────────────────────────────────────────────────────
  async navigate(): Promise<void> {
    await this.navigateTo('/');
  }

  async fillCredentials(username: string, password: string): Promise<void> {
    await this.fillInput(this.usernameInput, username);
    await this.fillInput(this.passwordInput, password);
  }

  /**
   * QA accepts any captcha value — POST /Home/ValidateCaptchaCode returned
   * {"valid":true} for every input tested, including the empty string. The field is
   * still filled because the client refuses to submit while it is blank.
   */
  async fillCaptcha(value = process.env.TEST_CAPTCHA ?? '123456'): Promise<void> {
    if (await this.captchaInput.isVisible().catch(() => false)) {
      await this.fillInput(this.captchaInput, value);
    }
  }

  /**
   * Waits until the form can actually be submitted.
   *
   * The page fetches the client IP in the background and writes it to #Userip.
   * Submitting before that resolves gets the login rejected **silently** — the app
   * re-renders the login page with every error surface empty: no message, no modal,
   * nothing. A human never hits this, because typing credentials takes longer than
   * the fetch; automation clicks within a second of load and loses the race.
   *
   * The resulting failure is indistinguishable from a wrong password, so gate on it
   * rather than guess at it later.
   */
  async waitUntilSubmittable(timeout = 20_000): Promise<void> {
    await expect
      .poll(async () => (await this.userIpField.inputValue().catch(() => '')).trim(), {
        timeout,
        message: 'waiting for POST /Home/GetIP to populate #Userip',
      })
      .not.toBe('');
  }

  /** Submits the form, but only once it is genuinely ready. */
  async submit(): Promise<void> {
    await this.waitUntilSubmittable();
    await this.clickElement(this.loginButton);
    await this.dismissSessionDialogs();
    await this.waitForPageLoad();
  }

  /** Fills and submits the form. Does not follow the flow past the form. */
  async signIn(username: string, password: string): Promise<void> {
    this.logger.info(`Submitting login for: ${username}`);
    await this.fillCredentials(username, password);
    await this.fillCaptcha();
    await this.submit();
  }

  /**
   * Full login: form → role selection (if offered) → OTP → wherever the app lands.
   *
   * `role` picks the user type for multi-role accounts; omit it to take the first
   * usable one. Deliberately does not assert the destination — callers check for a
   * dashboard, a forced password change, or an error as the test requires.
   */
  async login(username: string, password: string, role?: RoleSelector): Promise<void> {
    await this.signIn(username, password);
    await this.waitForPostLoginLanding();

    // The active-session prompt ("already signed in on another device") only renders
    // once the login POST resolves, so the dismissal inside submit() runs too early
    // to catch it. Clear it here and wait again for the real destination.
    if (await this.dismissSessionDialogs()) {
      await this.waitForPostLoginLanding();
    }

    await this.selectUserTypeIfPresent(role);
    await this.completeOtpIfPresent();
  }

  /**
   * Waits for the login POST to land somewhere recognisable.
   *
   * Submission is an async encrypted post, so the browser sits on the login URL for
   * a moment afterwards. Waiting on any single destination would stall the other
   * paths, so this waits for whichever arrives first and lets the caller decide.
   */
  private async waitForPostLoginLanding(timeout = 20_000): Promise<void> {
    await this.waitForOutcome(['.user-type-card', '.otp-box', '#sidebarMenu'], timeout);
  }

  /**
   * Waits for the app to reach one of `destinations`, or to report an error.
   *
   * The destination list is a parameter because it shrinks as the journey
   * advances. After the profile step, `.user-type-card` is still on screen — so
   * including it would make every later wait return immediately and the flow
   * would appear to have progressed when it had not.
   *
   * The session prompt is always an acceptable outcome: it is a legitimate answer
   * to a login POST, and treating it as one avoids burning the whole timeout
   * before anyone notices it is there.
   */
  private async waitForOutcome(destinations: string[], timeout = 20_000): Promise<void> {
    // Race progress against rejection. Waiting only for a destination means every
    // failed login burns the full timeout before the test can assert on the error.
    const arrived = this.page
      .locator([...destinations, ...this.sessionDialogButtons].join(', '))
      .first()
      .waitFor({ state: 'visible', timeout })
      .catch(() => undefined);

    const rejected = (async () => {
      const deadline = Date.now() + timeout;
      while (Date.now() < deadline) {
        if (Object.keys(await this.getErrorMessages()).length > 0) return;
        await this.page.waitForTimeout(500);
      }
    })();

    await Promise.race([arrived, rejected]);
  }

  /** Clears the role-selection step when the app presents it. */
  async selectUserTypeIfPresent(role?: RoleSelector): Promise<void> {
    const selection = new UserTypeSelectionPage(this.page);
    if (!(await selection.isPresent(2_000))) return;

    await selection.selectRole(role);

    // Choosing a profile can raise the active-session prompt ("Confirmation —
    // Yes/Cancel") when the account is already signed in elsewhere, and it renders
    // a moment *after* Get Started. Checking for it immediately finds nothing, and
    // the browser then sits on the profile page until the test times out on a
    // missing dashboard — which reads as a broken login rather than an unanswered
    // prompt. So wait for whatever the app produces, then clear it if that is what
    // turned up.
    //
    // The destinations deliberately exclude .user-type-card: it is still on screen
    // at this point, and including it would satisfy the wait instantly.
    const afterRoleSelection = ['.otp-box', '#sidebarMenu'];

    await this.waitForOutcome(afterRoleSelection);
    if (await this.dismissSessionDialogs()) {
      await this.waitForOutcome(afterRoleSelection);
    }
  }

  /** Completes 2FA when the app presents it. */
  async completeOtpIfPresent(code?: string): Promise<void> {
    const otpPage = new OtpPage(this.page);
    if (!(await otpPage.isPresent(10_000))) return;

    await otpPage.verify(code);
    await this.dismissSessionDialogs();
  }

  /**
   * Confirms an "already logged in elsewhere" prompt when one appears.
   *
   * Returns whether anything was dismissed, so callers know to wait again — the
   * page navigates after the prompt is answered.
   */
  async dismissSessionDialogs(): Promise<boolean> {
    let dismissed = false;
    for (const selector of this.sessionDialogButtons) {
      const button = this.page.locator(selector);
      if (await button.isVisible().catch(() => false)) {
        this.logger.info(`Dismissing session dialog: ${selector}`);
        await button.click().catch(() => undefined);
        await this.waitForPageLoad();
        dismissed = true;
      }
    }
    return dismissed;
  }

  async toggleShowPassword(): Promise<void> {
    await this.clickElement(this.showPasswordToggle);
  }

  async openUnlockUserFlow(): Promise<void> {
    await this.unlockUser.open();
  }

  async openForgotPasswordFlow(): Promise<void> {
    await this.forgotPassword.open();
  }

  async requestOtpForUsername(username: string): Promise<boolean> {
    return this.forgotPassword.requestOtp(username);
  }

  // ─── Field-level helpers ──────────────────────────────────────────────────
  /**
   * Types `raw` into the username field and returns what the field kept.
   *
   * The field runs a client-side sanitiser on every keystroke, dropping anything
   * outside [A-Za-z0-9@._-] — spaces, emoji, angle brackets and quotes all vanish
   * as they are typed. fill() sets the value in one shot and bypasses that entirely,
   * so the sanitiser tests must type character by character or they prove nothing.
   */
  async typeUsername(raw: string): Promise<string> {
    await this.usernameInput.fill('');
    await this.usernameInput.pressSequentially(raw, { delay: 5 });
    await this.usernameInput.blur();
    return this.usernameInput.inputValue();
  }

  /** Same, for the captcha field — it enforces its own six-character limit. */
  async typeCaptcha(raw: string): Promise<string> {
    await this.captchaInput.fill('');
    await this.captchaInput.pressSequentially(raw, { delay: 5 });
    return this.captchaInput.inputValue();
  }

  /** Submits with the keyboard, as a user tabbing through the form would. */
  async submitWithEnter(): Promise<void> {
    await this.passwordInput.press('Enter');
  }

  /**
   * Clicks LOGIN and waits for the client-side validation to answer, retrying if
   * it does not.
   *
   * Same race as the modals: the button is rendered, visible and enabled before
   * the page script binds its submit handler, and a click in that window is
   * accepted by the browser and does nothing at all. Playwright's actionability
   * checks cannot see the difference, so the test reports "no validation error
   * appeared" — which reads exactly like the application failing to validate.
   *
   * Retrying is the honest fix: a click that produces validation proves the
   * handler is bound, and one that does not is indistinguishable from the page
   * not being ready yet.
   */
  async submitExpectingValidation(
    via: 'click' | 'enter' = 'click',
    attempts = 3
  ): Promise<void> {
    await this.waitUntilSubmittable();

    const populatedError = this.page
      .locator('#username_error, #password_error, #captcha_error')
      .filter({ hasText: /\S/ })
      .first();

    for (let attempt = 1; attempt <= attempts; attempt++) {
      if (via === 'enter') {
        await this.submitWithEnter();
      } else {
        await this.loginButton.click();
      }

      const validated = await populatedError
        .waitFor({ state: 'visible', timeout: 5_000 })
        .then(() => true)
        .catch(() => false);

      if (validated) return;

      this.logger.warn(
        `Submitting by ${via} produced no validation message ` +
          `(attempt ${attempt}/${attempts}) — the submit handler is probably not ` +
          `bound yet.`
      );
    }

    throw new Error(
      `Submitting by ${via} ${attempts} times produced no client-side validation on ` +
        `a form that should have been refused. Either the page script failed to ` +
        `load, or the form validation has genuinely regressed. ` +
        `Current URL: ${this.page.url()}`
    );
  }

  async loginStage(): Promise<string> {
    return this.loginStageField.inputValue();
  }

  async antiForgeryToken(): Promise<string> {
    return this.antiForgeryField.inputValue();
  }

  async captchaImageSrc(): Promise<string> {
    return (await this.captchaImage.getAttribute('src')) ?? '';
  }

  async clientIp(): Promise<string> {
    return (await this.userIpField.inputValue()).trim();
  }

  /**
   * Fills the form without submitting.
   *
   * Used by the tests that check a field survives a failed submit — they need the
   * form populated but must control when the POST happens.
   */
  async fillForm(username: string, password: string, captcha = '123456'): Promise<void> {
    await this.fillInput(this.usernameInput, username);
    await this.fillInput(this.passwordInput, password);
    await this.fillInput(this.captchaInput, captcha);
  }

  // ─── Reading errors ───────────────────────────────────────────────────────
  /** Visible, non-empty text from each error surface, keyed by selector. */
  async getErrorMessages(): Promise<Record<string, string>> {
    const found: Record<string, string> = {};
    for (const selector of this.errorSurfaces) {
      const locator = this.page.locator(selector).first();
      if (!(await locator.isVisible().catch(() => false))) continue;
      const text = ((await locator.textContent().catch(() => '')) ?? '').trim();
      if (text) found[selector] = text;
    }
    return found;
  }

  /** True when the app is reporting this account as locked out. */
  async isAccountLocked(): Promise<boolean> {
    return Object.values(await this.getErrorMessages()).some(m => ACCOUNT_LOCKED.test(m));
  }

  // ─── Assertions ───────────────────────────────────────────────────────────
  async assertLoginPageLoaded(): Promise<void> {
    await this.assertElementVisible(this.usernameInput);
    await this.assertElementVisible(this.passwordInput);
    await this.assertElementVisible(this.loginButton);
  }

  async isPasswordMasked(): Promise<boolean> {
    return (await this.passwordInput.getAttribute('type')) === 'password';
  }

  /**
   * Waits for any error surface to report text matching `pattern`.
   *
   * On failure it reports what each surface actually held, so a mismatch reads as
   * "the app said X, we expected Y" rather than "element not found" — the latter
   * being indistinguishable from the app showing nothing at all.
   */
  async assertErrorContains(pattern: RegExp, timeout = 15_000): Promise<void> {
    const deadline = Date.now() + timeout;
    let seen: Record<string, string> = {};

    while (Date.now() < deadline) {
      seen = await this.getErrorMessages();
      if (Object.values(seen).some(text => pattern.test(text))) return;
      await this.page.waitForTimeout(500);
    }

    const observed = Object.keys(seen).length
      ? Object.entries(seen).map(([sel, text]) => `  ${sel}: "${text}"`).join('\n')
      : '  (no error surface displayed any text)';

    throw new Error(
      `No login error matched ${pattern}.\n` +
        `Surfaces checked: ${this.errorSurfaces.join(', ')}\n` +
        `Observed:\n${observed}\nCurrent URL: ${this.page.url()}`
    );
  }
}
