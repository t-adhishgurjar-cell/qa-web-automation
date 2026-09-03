import { Locator, Page, expect } from '@playwright/test';
import { Logger } from '../../helpers/logger.helper';

/**
 * The two pre-login modals — Forgot Password and Unlock User.
 *
 * They are the same widget twice. Both render a two-step dialog (username -> OTP)
 * whose every control carries the same id shape, differing only by prefix:
 *
 *   #forgot_username  #forgot_username_err  #forgot_otp  #forgot_otp_err
 *   #unlock_username  #unlock_username_err  #unlock_otp  #unlock_otp_err
 *   ...and _submit_btn, _cancel_btn, _resend_otp_btn, _otp_userid for each.
 *
 * So this is one component parameterised by prefix rather than two near-identical
 * page objects. A change to the shared markup is then a one-line fix, and any test
 * written for one modal can be pointed at the other.
 *
 * Verified against webqa: opening one modal blocks the other (the Bootstrap backdrop
 * intercepts the link), and cancelling clears both the field and its error.
 */
export type PreLoginModalKind = 'forgot' | 'unlock';

const TRIGGERS: Record<PreLoginModalKind, string> = {
  forgot: '#forgotPasswordLink',
  unlock: '#unlockUserLink',
};

const CONTAINERS: Record<PreLoginModalKind, string> = {
  forgot: '#forgotModal',
  unlock: '#unlockModal',
};

export class PreLoginOtpModal {
  readonly kind: PreLoginModalKind;

  private readonly page: Page;
  private readonly logger: Logger;

  readonly trigger: Locator;
  readonly container: Locator;
  readonly title: Locator;

  readonly usernameInput: Locator;
  readonly usernameError: Locator;
  readonly otpInput: Locator;
  readonly otpError: Locator;
  readonly hiddenUserId: Locator;

  readonly submitButton: Locator;
  readonly cancelButton: Locator;
  readonly resendButton: Locator;

  constructor(page: Page, kind: PreLoginModalKind) {
    this.page = page;
    this.kind = kind;
    this.logger = new Logger(`PreLoginOtpModal:${kind}`);

    this.trigger = page.locator(TRIGGERS[kind]);
    this.container = page.locator(CONTAINERS[kind]);
    this.title = page.locator(`${CONTAINERS[kind]}Title`);

    this.usernameInput = page.locator(`#${kind}_username`);
    this.usernameError = page.locator(`#${kind}_username_err`);
    this.otpInput = page.locator(`#${kind}_otp`);
    this.otpError = page.locator(`#${kind}_otp_err`);
    this.hiddenUserId = page.locator(`#${kind}_otp_userid`);

    this.submitButton = page.locator(`#${kind}_submit_btn`);
    this.cancelButton = page.locator(`#${kind}_cancel_btn`);
    this.resendButton = page.locator(`#${kind}_resend_otp_btn`);
  }

  // ─── Actions ──────────────────────────────────────────────────────────────
  /**
   * Opens the dialog, retrying the click if it does not take.
   *
   * The trigger is an `<a href="#">` whose behaviour comes entirely from a click
   * handler bound by the page script. Between DOMContentLoaded and that script
   * running, the link is present, visible and enabled — and clicking it does
   * nothing at all. Playwright's actionability checks cannot see the difference,
   * so a single click races the page and loses often enough to be flaky.
   *
   * Retrying is the honest fix: a click that opens the dialog proves the handler is
   * bound, and one that does not is indistinguishable from the page not being ready.
   */
  async open(attempts = 3): Promise<void> {
    this.logger.info(`Opening the ${this.kind} modal`);

    for (let attempt = 1; attempt <= attempts; attempt++) {
      await this.trigger.click();

      const opened = await this.container
        .waitFor({ state: 'visible', timeout: 5_000 })
        .then(() => true)
        .catch(() => false);

      if (opened) {
        // Bootstrap animates the dialog in; acting mid-transition drops clicks.
        await expect(this.usernameInput).toBeVisible();
        return;
      }

      this.logger.warn(
        `${TRIGGERS[this.kind]} did not open ${CONTAINERS[this.kind]} ` +
          `(attempt ${attempt}/${attempts}) — the click handler is probably not bound yet.`
      );
    }

    throw new Error(
      `The ${this.kind} dialog never opened after ${attempts} clicks on ` +
        `${TRIGGERS[this.kind]}. The link is rendered but its click handler is not ` +
        `working — check the login page script for an error.`
    );
  }

  async close(): Promise<void> {
    await this.cancelButton.click();
    await expect(this.container).toBeHidden();
  }

  async isOpen(): Promise<boolean> {
    return this.container.isVisible().catch(() => false);
  }

  /** True once the dialog has advanced past the username step. */
  async isOnOtpStep(): Promise<boolean> {
    return this.otpInput.isVisible().catch(() => false);
  }

  async fillUsername(value: string): Promise<void> {
    await this.usernameInput.fill('');
    await this.usernameInput.pressSequentially(value, { delay: 5 });
  }

  /** Submits the current step — "Generate OTP" on step 1, "Verify" on step 2. */
  async submit(): Promise<void> {
    await this.submitButton.click();
  }

  /**
   * Requests an OTP for `username` and reports whether the dialog advanced.
   *
   * Returns false rather than throwing when it does not: a refusal is a legitimate
   * outcome for a non-existent or non-locked account, and several tests assert
   * exactly that.
   */
  async requestOtp(username: string, timeout = 15_000): Promise<boolean> {
    await this.fillUsername(username);
    await this.submit();
    return this.otpInput
      .waitFor({ state: 'visible', timeout })
      .then(() => true)
      .catch(() => false);
  }

  async fillOtp(code: string): Promise<void> {
    await this.otpInput.fill('');
    await this.otpInput.pressSequentially(code, { delay: 20 });
  }

  async resend(): Promise<void> {
    await this.resendButton.click();
  }

  // ─── Reading state ────────────────────────────────────────────────────────
  async usernameValue(): Promise<string> {
    return this.usernameInput.inputValue();
  }

  async otpValue(): Promise<string> {
    return this.otpInput.inputValue();
  }

  /**
   * Visible error text for a step right now, or '' when the field is clean.
   *
   * Reads once and does not wait — use it to assert an error is *absent*. To
   * assert one is present, use waitForError: the dialog validates over the
   * network and fills the field a few hundred milliseconds later, so an
   * immediate read returns '' and the test reports "the app showed no error"
   * when the app was about to show one.
   */
  async errorFor(field: 'username' | 'otp'): Promise<string> {
    const locator = field === 'username' ? this.usernameError : this.otpError;
    if (!(await locator.isVisible().catch(() => false))) return '';
    return ((await locator.textContent()) ?? '').trim();
  }

  /**
   * Waits for a field's error to be populated, and returns it.
   *
   * Returns '' if nothing appears within the timeout, so the caller decides
   * whether that is a failure — several tests treat a silent refusal as the
   * defect itself.
   */
  async waitForError(field: 'username' | 'otp', timeout = 10_000): Promise<string> {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const text = await this.errorFor(field);
      if (text) return text;
      await this.page.waitForTimeout(200);
    }
    return '';
  }

  /** Waits for a message on either step — whichever the dialog decides to use. */
  async waitForAnyError(timeout = 10_000): Promise<string> {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const text = await this.anyError();
      if (text) return text;
      await this.page.waitForTimeout(200);
    }
    return '';
  }

  /** Any message the modal is showing, across both steps. */
  async anyError(): Promise<string> {
    return (await this.errorFor('username')) || (await this.errorFor('otp'));
  }

  async isResendEnabled(): Promise<boolean> {
    if (!(await this.resendButton.isVisible().catch(() => false))) return false;
    const disabledAttr = await this.resendButton.getAttribute('disabled');
    const classes = (await this.resendButton.getAttribute('class')) ?? '';
    return disabledAttr === null && !/disabled/.test(classes);
  }
}
