import { Page } from '@playwright/test';
import { BasePage } from './base.page';

export class OtpPage extends BasePage {
  private readonly otpInput = this.page.locator('#forgot_otp, #unlock_otp, input[type="text"][maxlength="6"]');
  private readonly otpError = this.page.locator('#forgot_otp_err, #unlock_otp_err');
  private readonly verifyButton = this.page.locator('#forgot_submit_btn, #unlock_submit_btn');

  constructor(page: Page) {
    super(page);
  }

  async isLoaded(timeout = 10000): Promise<boolean> {
    return this.otpInput.isVisible({ timeout }).catch(() => false);
  }

  async enterOtp(code: string): Promise<void> {
    await this.fillInput(this.otpInput, code);
  }

  async verify(code?: string): Promise<void> {
    const otp = code ?? process.env.TEST_OTP ?? '123456';
    await this.enterOtp(otp);
    await this.clickElement(this.verifyButton, { force: true });
    await this.waitForPageLoad();
  }

  async assertErrorMessage(message: string): Promise<void> {
    await this.assertElementVisible(this.otpError);
    await this.assertElementText(this.otpError, message);
  }

  async isErrorVisible(): Promise<boolean> {
    return this.otpError.isVisible().catch(() => false);
  }
}
