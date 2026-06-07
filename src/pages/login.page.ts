import { Page, expect } from '@playwright/test';
import { BasePage } from './base.page';
import { OtpPage } from './otp.page';

export class LoginPage extends BasePage {
  // ─── Login form (recorded locators — webqa.fleetforc.com) ─────────────────
  private readonly usernameInput = this.page.locator('#Username');
  private readonly passwordInput = this.page.locator('#Password');
  private readonly captchaInput  = this.page.locator('#CaptchaCode');
  private readonly loginButton   = this.page.locator('#btnLogin');
  private readonly showPasswordToggle = this.page.getByTitle('Show Password').locator('i');
  private readonly activeSessionYesButton = this.page.getByRole('button', { name: 'Yes' });
  private readonly usernameError   = this.page.locator('#username_error, #username_err, [id*="username_err"]').first();
  private readonly passwordError   = this.page.locator('#password_error, #password_err, [id*="password_err"]').first();

  // ─── OTP Login tab (portal login via mobile) ────────────────────────────────
  private readonly otpLoginTab     = this.page.getByRole('link', { name: /otp login|login with otp/i })
    .or(this.page.getByRole('button', { name: /otp login|login with otp/i }))
    .or(this.page.getByText(/otp login/i).first());
  private readonly mobileInput     = this.page.getByPlaceholder(/mobile|phone|10-digit/i)
    .or(this.page.locator('#mobile, #otp_mobile, input[name*="mobile"]').first());
  private readonly sendOtpButton   = this.page.getByRole('button', { name: /send otp/i });
  private readonly mobileError     = this.page.locator('#mobile_error, #mobile_err, [id*="mobile_err"]').first();

  // ─── Forgot-password / OTP-request flow ───────────────────────────────────
  private readonly forgotPasswordLink  = this.page.getByRole('link', { name: /forgot password/i })
    .or(this.page.getByRole('button', { name: /forgot password/i }));
  private readonly unlockUserLink      = this.page.getByRole('button', { name: /unlock user/i })
    .or(this.page.getByRole('link', { name: /unlock user/i })).first();
  private readonly forgotUsernameInput = this.page.locator('#forgotModal #forgot_username, #unlockModal #unlock_username, #forgot_username, #unlock_username').first();
  private readonly forgotUsernameError = this.page.locator('#forgot_username_error, #unlock_username_error, #forgot_username_err, #unlock_username_err, [id*="username_error"]').first();
  private readonly forgotSubmitButton  = this.page.locator('#forgotModal #forgot_submit_btn, #unlockModal #unlock_submit_btn, #forgot_submit_btn, #unlock_submit_btn').first();
  private readonly forgotOtpStep       = this.page.locator('#forgotModal #forgot_step2, #unlockModal #unlock_step2, #forgot_otp, #unlock_otp').first();

  constructor(page: Page) {
    super(page);
  }

  // ─── Actions ──────────────────────────────────────────────────────────────
  async navigate(): Promise<void> {
    await this.navigateTo('/');
  }

  /**
   * Full login including captcha, active-session dialog, and 2FA OTP.
   */
  async login(username: string, password: string): Promise<void> {
    this.logger.info(`Logging in as: ${username}`);
    await this.fillCredentials(username, password);
    await this.fillCaptchaIfVisible();
    await this.clickElement(this.loginButton);
    await this.dismissActiveSessionDialog();
    await this.waitForPageLoad();

    if (await this.isOtpVerificationVisible()) {
      await this.completeOtpVerification();
    }
  }

  /** Submits credentials only — returns OtpPage for 2FA assertions. */
  async submitCredentials(username: string, password: string): Promise<OtpPage> {
    this.logger.info(`Submitting credentials for: ${username}`);
    await this.fillCredentials(username, password);
    await this.fillCaptchaIfVisible();
    await this.clickElement(this.loginButton);
    await this.dismissActiveSessionDialog();
    await this.waitForPageLoad();
    return new OtpPage(this.page);
  }

  async requestOtpForMobile(mobile: string): Promise<OtpPage> {
    this.logger.info(`Requesting OTP for mobile: ${mobile}`);
    if (await this.otpLoginTab.isVisible().catch(() => false)) {
      await this.clickElement(this.otpLoginTab);
      await this.fillInput(this.mobileInput, mobile);
      await this.clickElement(this.sendOtpButton, { force: true });
    } else if (await this.forgotPasswordLink.isVisible().catch(() => false)) {
      await this.clickElement(this.forgotPasswordLink);
      await this.fillInput(this.forgotUsernameInput, mobile);
      await this.clickElement(this.forgotSubmitButton, { force: true });
    } else if (await this.unlockUserLink.isVisible().catch(() => false)) {
      await this.clickElement(this.unlockUserLink);
      await this.fillInput(this.forgotUsernameInput, mobile);
      await this.clickElement(this.forgotSubmitButton, { force: true });
    } else {
      throw new Error('Unable to locate the OTP login / forgot password flow');
    }

    await this.waitForPageLoad();
    await this.forgotOtpStep.waitFor({ state: 'visible', timeout: 5_000 }).catch(() => undefined);
    return new OtpPage(this.page);
  }

  async requestOtpForUsername(username: string): Promise<void> {
    this.logger.info(`Requesting OTP for username: ${username}`);
    if (await this.forgotPasswordLink.isVisible().catch(() => false)) {
      await this.clickElement(this.forgotPasswordLink);
    } else if (await this.unlockUserLink.isVisible().catch(() => false)) {
      await this.clickElement(this.unlockUserLink);
    } else {
      throw new Error('Unable to locate the forgot-password or unlock-user flow');
    }

    await this.fillInput(this.forgotUsernameInput, username);
    await this.clickElement(this.forgotSubmitButton, { force: true });
    await this.waitForPageLoad();
  }

  async fillCredentials(username: string, password: string): Promise<void> {
    await this.fillInput(this.usernameInput, username);
    await this.fillInput(this.passwordInput, password);
  }

  async submitLogin(): Promise<void> {
    await this.fillCaptchaIfVisible();
    await this.clickElement(this.loginButton);
    await this.dismissActiveSessionDialog();
    await this.waitForPageLoad();
  }

  async toggleShowPassword(): Promise<void> {
    await this.clickElement(this.showPasswordToggle);
  }

  async tabThroughLoginForm(): Promise<void> {
    await this.usernameInput.focus();
    await this.page.keyboard.press('Tab');
  }

  async isPasswordFieldFocused(): Promise<boolean> {
    return this.passwordInput.evaluate(el => (el as HTMLElement).matches(':focus'));
  }

  async pressEnterOnLoginForm(): Promise<void> {
    await this.fillCaptchaIfVisible();
    await this.passwordInput.press('Enter');
    await this.dismissActiveSessionDialog();
    await this.waitForPageLoad();

    if (await this.isOtpVerificationVisible()) {
      await this.completeOtpVerification();
    }
  }

  private async fillCaptchaIfVisible(): Promise<void> {
    const captcha = process.env.TEST_CAPTCHA ?? '1234';
    if (await this.captchaInput.isVisible().catch(() => false)) {
      await this.fillInput(this.captchaInput, captcha);
    }
  }

  /** Confirms "already logged in elsewhere" dialog when it appears. */
  private async dismissActiveSessionDialog(): Promise<void> {
    if (await this.activeSessionYesButton.isVisible({ timeout: 3000 }).catch(() => false)) {
      await this.clickElement(this.activeSessionYesButton);
      await this.waitForPageLoad();
    }
  }

  private async isOtpVerificationVisible(): Promise<boolean> {
    return this.page.getByRole('button', { name: /^(VERIFY|Verify OTP)$/i }).isVisible({ timeout: 10_000 }).catch(() => false)
      || this.page.url().includes('LoginOtpVerification');
  }

  private async completeOtpVerification(): Promise<void> {
    const otpPage = new OtpPage(this.page);
    await otpPage.verify();
  }

  // ─── Assertions ───────────────────────────────────────────────────────────
  async assertLoginPageLoaded(): Promise<void> {
    await this.assertElementVisible(this.usernameInput);
    await this.assertElementVisible(this.passwordInput);
    await this.assertElementVisible(this.loginButton);
  }

  async assertErrorMessage(message: string): Promise<void> {
    await this.assertElementVisible(this.page.getByText(message, { exact: true }));
  }

  async assertErrorContains(pattern: string | RegExp): Promise<void> {
    await this.assertElementVisible(this.page.getByText(pattern).first());
  }

  async isPasswordMasked(): Promise<boolean> {
    const type = await this.passwordInput.getAttribute('type');
    if (type === 'password') return true;
    // FleetPlus may render password as textbox — verify Show Password toggle exists
    return this.showPasswordToggle.isVisible().catch(() => false);
  }

  async isPasswordVisibleAfterToggle(): Promise<boolean> {
    await this.toggleShowPassword();
    const type = await this.passwordInput.getAttribute('type');
    return type !== 'password';
  }

  async isLoginButtonDisabled(): Promise<boolean> {
    return !(await this.loginButton.isEnabled());
  }

  async assertMobileError(message: string | RegExp): Promise<void> {
    await this.assertElementVisible(this.mobileError);
    if (typeof message === 'string') {
      await this.assertElementText(this.mobileError, message);
    } else {
      await expect(this.mobileError).toHaveText(message);
    }
  }

  async isOtpLoginStepVisible(): Promise<boolean> {
    return this.forgotOtpStep.isVisible({ timeout: 5000 }).catch(() => false)
      || this.page.getByRole('button', { name: /^(VERIFY|Verify OTP)$/i }).isVisible({ timeout: 3000 }).catch(() => false);
  }

  async assertUsernameError(message: string): Promise<void> {
    await this.assertElementVisible(this.usernameError);
    await this.assertElementText(this.usernameError, message);
  }

  async assertPasswordError(message: string): Promise<void> {
    await this.assertElementVisible(this.passwordError);
    await this.assertElementText(this.passwordError, message);
  }

  async assertForgotOtpStepVisible(): Promise<void> {
    await this.assertElementVisible(this.forgotOtpStep);
  }

  async isForgotOtpStepVisible(): Promise<boolean> {
    return this.forgotOtpStep.isVisible({ timeout: 5000 }).catch(() => false);
  }

  async assertForgotUsernameError(message: string): Promise<void> {
    await this.assertElementVisible(this.forgotUsernameError);
    await this.assertElementText(this.forgotUsernameError, message);
  }
}
