import { Page, expect } from '@playwright/test';
import { BasePage } from './base.page';
import { OtpPage } from './otp.page';
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

export class LoginPage extends BasePage {
  // ─── Login form ───────────────────────────────────────────────────────────
  private readonly usernameInput = this.page.locator('#Username');
  private readonly passwordInput = this.page.locator('#Password');
  private readonly captchaInput = this.page.locator('#CaptchaCode');
  private readonly loginButton = this.page.locator('#btnLogin');
  private readonly showPasswordToggle = this.page.getByTitle('Show Password').locator('i');

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

  // ─── Forgot-password / unlock-user flow ───────────────────────────────────
  private readonly forgotPasswordLink = this.page.getByRole('link', { name: /forgot password/i })
    .or(this.page.getByRole('button', { name: /forgot password/i }));
  private readonly unlockUserLink = this.page.getByRole('button', { name: /unlock user/i })
    .or(this.page.getByRole('link', { name: /unlock user/i })).first();
  private readonly forgotUsernameInput = this.page.locator('#forgot_username, #unlock_username').first();
  private readonly forgotSubmitButton = this.page.locator('#forgot_submit_btn, #unlock_submit_btn').first();

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
    // Race progress against rejection. Waiting only for a destination means every
    // failed login burns the full timeout before the test can assert on the error.
    const arrived = this.page
      .locator(
        // Destinations, plus the session prompt — it is a legitimate outcome of a
        // login POST, and treating it as one avoids burning the whole timeout.
        `.user-type-card, .otp-box, #sidebarMenu, ${this.sessionDialogButtons.join(', ')}`
      )
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
    await this.dismissSessionDialogs();
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
    await this.clickElement(this.unlockUserLink);
  }

  async openForgotPasswordFlow(): Promise<void> {
    await this.clickElement(this.forgotPasswordLink);
  }

  async requestOtpForUsername(username: string): Promise<void> {
    await this.fillInput(this.forgotUsernameInput, username);
    await this.clickElement(this.forgotSubmitButton, { force: true });
    await this.waitForPageLoad();
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
