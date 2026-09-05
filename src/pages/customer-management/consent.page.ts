import { Page, expect } from '@playwright/test';
import { BasePage } from '../base.page';
import { DbHelper } from '../../helpers/db.helper';

/**
 * The customer consent page — /consent/consent?token=…
 *
 * A submitted application sits at status 107 (Consent Pending) until the
 * customer accepts the terms and verifies the OTP. Only then does it move to
 * 105 (Pending for Approval). Nothing about that is visible to the maker, and
 * no amount of clicking in the back office advances it: the step belongs to the
 * customer, and the link arrives by SMS.
 *
 * That link is recoverable, which is what makes onboarding automatable at all.
 * dbo.UserSMSLog holds the message and its token.
 *
 * ── Two things here are not guessable ─────────────────────────────────────
 *
 * 1. The SMS hardcodes a different environment. A message sent from QA carries
 *    a link to fleetplusuatweb.nayaraenergy.com. The token is host-agnostic so
 *    the link works either way, which is why nobody has noticed — but a real
 *    customer onboarded in QA consents on UAT. Only the token is taken from the
 *    SMS; the URL is rebuilt against the environment under test.
 *
 * 2. The Confirm button is a two-stage gate. It starts as "Read the Terms and
 *    Conditions" and is enabled; clicking it relabels it to "Confirm & Continue"
 *    and *disables* it until the checkbox is ticked. Ticking the box first and
 *    clicking once does nothing — the OTP field never appears, and the failure
 *    looks like a missing element rather than a sequence error.
 */
export class ConsentPage extends BasePage {
  readonly termsCheckbox = this.page.locator('#T\\&C');
  readonly continueButton = this.page.locator('#continueBtn');
  readonly otpInput = this.page.locator('#consentOtp');
  readonly verifyOtpButton = this.page.locator('#verifyOtpBtn');
  readonly confirmation = this.page.getByText(/consent has been securely recorded/i);

  constructor(page: Page) {
    super(page);
  }

  /**
   * The consent token most recently sent to this mobile.
   *
   * Read-only, like everything else that touches the database. Throws rather
   * than returning empty: a missing token means the application never reached
   * Consent Pending, and that is a different problem from a failed consent.
   */
  static async tokenFor(mobile: string): Promise<string> {
    const rows = await DbHelper.query<{ SMSText: string }>(
      `SELECT TOP 1 SMSText FROM dbo.UserSMSLog
        WHERE MobileNo = @mobile AND SMSText LIKE '%consent?token=%'
        ORDER BY Id DESC`,
      { mobile }
    );

    const token = rows[0]?.SMSText.match(/token=([0-9a-fA-F-]+)/)?.[1];
    if (!token) {
      throw new Error(
        `No consent SMS was sent to ${mobile}. The application has not reached ` +
          `status 107, so there is nothing to consent to yet.`
      );
    }
    return token;
  }

  async open(token: string): Promise<void> {
    // Deliberately rebuilt against BASE_URL rather than following the link in
    // the SMS, which points at UAT. See note 1 above.
    await this.navigateTo(`/consent/consent?token=${token}`);
    await this.continueButton.waitFor({ state: 'visible', timeout: 30_000 });
  }

  /**
   * Accepts the terms and verifies the OTP, leaving the application at 105.
   *
   * The two clicks on the same button are the sequence described in note 2, not
   * a retry.
   */
  async give(otp: string): Promise<void> {
    this.logger.info('Acknowledging the terms and conditions');
    await this.clickElement(this.continueButton);
    await this.page.waitForTimeout(1_500);

    await this.termsCheckbox.check();
    await expect(
      this.continueButton,
      'ticking the terms checkbox did not enable Confirm & Continue'
    ).toBeEnabled({ timeout: 10_000 });

    await this.clickElement(this.continueButton);
    await this.otpInput.waitFor({ state: 'visible', timeout: 30_000 });

    this.logger.info('Verifying the consent OTP');
    await this.fillInput(this.otpInput, otp);
    await this.clickElement(this.verifyOtpButton);

    await expect(
      this.confirmation,
      'the page did not confirm the consent was recorded'
    ).toBeVisible({ timeout: 30_000 });
  }

  /** Fetches the token and completes the whole step. */
  static async completeFor(page: Page, mobile: string, otp: string): Promise<void> {
    const consent = new ConsentPage(page);
    await consent.open(await ConsentPage.tokenFor(mobile));
    await consent.give(otp);
  }
}
