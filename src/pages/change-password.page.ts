import { Page } from '@playwright/test';
import { BasePage } from './base.page';

/**
 * /Home/ChangePassword — the forced change on first login.
 *
 * An account created by the SAP push arrives with a temporary password, and the
 * activation SMS says so:
 *
 *   "Dear User, your FLEETPLUS account has been activated. Username: 9072986100.
 *    Temporary Password: &WHDGWMmE7. Please log in and change your password
 *    immediately."
 *
 * The application enforces that literally. Signing in with the temporary
 * password does NOT reach the dashboard — after the OTP it lands here, and this
 * is the only screen offered until a new password is set. So an officer created
 * through the Office API is not usable by any suite until this screen has been
 * completed once.
 *
 * Measured markup, not assumed:
 *
 *   #OldPassword         "Enter current password"
 *   #NewPassword         "Enter a new password"
 *   #ConfirmNewPassword  "Re-enter your new password"
 *   #btnSubmitChangePwd  "Update Password"
 *   #btnResetChangePwd   "Reset"          — clears the form, not the password
 *   #btnLogoutChangePwd  "Logout"
 *
 * Note the trap in that list: "Reset" sits next to "Update Password" and sounds
 * like the action you want. It empties the three fields.
 */
export class ChangePasswordPage extends BasePage {
  readonly oldPassword = this.page.locator('#OldPassword');
  readonly newPassword = this.page.locator('#NewPassword');
  readonly confirmPassword = this.page.locator('#ConfirmNewPassword');
  readonly submit = this.page.locator('#btnSubmitChangePwd');

  constructor(page: Page) {
    super(page);
  }

  /**
   * True when the application has parked us on the forced-change screen.
   *
   * Waits rather than sampling. The OTP POST resolves before the redirect
   * lands, so an instant check reads the OTP page's URL and concludes the
   * change screen never appeared — which it does, half a second later.
   */
  async isShowing(timeout = 20_000): Promise<boolean> {
    if (/\/Home\/ChangePassword/i.test(this.page.url())) return true;
    return this.newPassword
      .waitFor({ state: 'visible', timeout })
      .then(() => true)
      .catch(() => false);
  }

  /**
   * Sets a new password and returns whatever the application said.
   *
   * The message is returned rather than asserted: a rejected password (too
   * short, reused, not meeting a rule nobody documented) is a result the caller
   * needs to see, and this application states such things in a modal whose text
   * is the only explanation available.
   */
  async change(current: string, next: string): Promise<string> {
    await this.fillInput(this.oldPassword, current);
    await this.fillInput(this.newPassword, next);
    await this.fillInput(this.confirmPassword, next);
    await this.clickElement(this.submit);
    await this.page.waitForTimeout(3_000);

    const modal = this.page.locator('.modal.show').first();
    if (await modal.isVisible().catch(() => false)) {
      const said = ((await modal.textContent()) ?? '').replace(/\s+/g, ' ').trim();
      await modal
        .locator('button:visible, a:visible')
        .filter({ hasText: /^\s*(ok|okay|close|done|continue)\s*$/i })
        .first()
        .click({ timeout: 5_000 })
        .catch(() => undefined);
      await this.page.waitForTimeout(1_500);
      return said;
    }

    // No modal: report the inline validation instead of an empty string, which
    // a caller would have to read as success.
    const inline = await this.page.evaluate(() =>
      Array.from(document.querySelectorAll('.error, .text-danger, .field-validation-error'))
        .filter(el => {
          const r = (el as HTMLElement).getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        })
        .map(el => (el.textContent || '').replace(/\s+/g, ' ').trim())
        .filter(Boolean)
    );
    return inline.length ? `refused inline: ${inline.join('; ')}` : '';
  }
}
