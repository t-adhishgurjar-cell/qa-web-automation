import { Page } from '@playwright/test';
import { BasePage } from './base.page';

export class OtpPage extends BasePage {
  private readonly verifyButton = this.page.getByRole('button', { name: /^(VERIFY|Verify OTP)$/i });
  private readonly forgotOtpInput = this.page.locator('#forgot_otp, #unlock_otp').first();
  private readonly otpBoxes = this.page.locator('.otp-box');
  private readonly otpError    = this.page.locator('#forgot_otp_err, #unlock_otp_err').first();
  private readonly otpErrorText = this.page.getByText(/Invalid OTP|OTP expired|incorrect OTP/i).first();

  constructor(page: Page) {
    super(page);
  }

  private otpBox(index: number) {
    return this.otpBoxes.nth(index);
  }

  async isLoaded(timeout = 10_000): Promise<boolean> {
    return this.verifyButton.isVisible({ timeout }).catch(() => false)
      || this.forgotOtpInput.isVisible({ timeout }).catch(() => false)
      || this.otpBoxes.first().isVisible({ timeout }).catch(() => false);
  }

  async enterOtp(code: string): Promise<void> {
    const digits = code.replace(/\s/g, '').slice(0, 6);
    if (await this.forgotOtpInput.isVisible().catch(() => false)) {
      await this.fillInput(this.forgotOtpInput, digits);
      return;
    }

    const count = await this.otpBoxes.count();
    const length = Math.min(digits.length, count);
    for (let i = 0; i < length; i++) {
      await this.otpBox(i).fill(digits[i]);
    }
  }

  async verify(code?: string): Promise<void> {
    const otp = code ?? process.env.TEST_OTP ?? '123456';
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
