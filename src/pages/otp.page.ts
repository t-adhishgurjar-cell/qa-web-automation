import { Page } from '@playwright/test';
import { BasePage } from './base.page';

/**
 * 2FA OTP verification — /Home/LoginOtpVerification.
 *
 * Six single-character inputs (class .otp-box, maxlength="1"), no ids or names,
 * filled one digit at a time. The same page object also serves the forgot-password
 * and unlock-user modals, which render a single combined input instead.
 */
export class OtpPage extends BasePage {
  // #btnVerifyOtp is the login OTP button; the role fallback covers the modals.
  private readonly verifyButton = this.page
    .locator('#btnVerifyOtp')
    .or(this.page.getByRole('button', { name: /^(VERIFY|Verify OTP)$/i }))
    .first();

  private readonly forgotOtpInput = this.page.locator('#forgot_otp, #unlock_otp').first();

  // maxlength="1" is the fallback if the class is ever restyled — the shape of the
  // control is the durable part.
  private readonly otpBoxes = this.page
    .locator('.otp-box')
    .or(this.page.locator('input[maxlength="1"]:not([type="hidden"])'));

  private readonly otpError = this.page.locator('#forgot_otp_err, #unlock_otp_err').first();
  private readonly otpErrorText = this.page.getByText(/Invalid OTP|OTP expired|incorrect OTP/i).first();

  constructor(page: Page) {
    super(page);
  }

  /** True once the OTP step is actually on screen. */
  async isPresent(timeout = 15_000): Promise<boolean> {
    if (this.page.url().includes('LoginOtpVerification')) return true;
    return this.otpBoxes
      .first()
      .waitFor({ state: 'visible', timeout })
      .then(() => true)
      .catch(() => false);
  }

  async enterOtp(code: string): Promise<void> {
    const digits = code.replace(/\s/g, '').slice(0, 6);

    // Forgot-password / unlock modals use one combined field.
    if (await this.forgotOtpInput.isVisible().catch(() => false)) {
      await this.fillInput(this.forgotOtpInput, digits);
      return;
    }

    await this.otpBoxes.first().waitFor({ state: 'visible', timeout: 15_000 });
    const count = await this.otpBoxes.count();
    for (let i = 0; i < Math.min(digits.length, count); i++) {
      await this.otpBoxes.nth(i).fill(digits[i]);
    }
  }

  async verify(code?: string): Promise<void> {
    const otp = code ?? process.env.TEST_OTP ?? '123456';
    this.logger.info('Verifying OTP');
    await this.enterOtp(otp);
    await this.clickElement(this.verifyButton);
    await this.waitForPageLoad();
  }

  async assertErrorMessage(message: string): Promise<void> {
    await this.assertElementVisible(this.otpError);
    await this.assertElementText(this.otpError, message);
  }

  async isErrorVisible(): Promise<boolean> {
    const idBased = await this.otpError.isVisible().catch(() => false);
    const textBased = await this.otpErrorText.isVisible().catch(() => false);
    return idBased || textBased;
  }

  async clickResendOtp(): Promise<void> {
    await this.page.getByRole('button', { name: /resend otp/i }).click({ force: true });
  }

  async isVerifyButtonEnabled(): Promise<boolean> {
    return this.verifyButton.isEnabled();
  }
}
