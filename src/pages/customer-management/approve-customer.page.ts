import { Locator, Page, expect } from '@playwright/test';
import { BasePage } from '../base.page';

/**
 * Customer approval — the checker half of maker-checker.
 *
 * /Customer/ValidateNewCustomer lists applications at status 105 and each row
 * links to a three-tab review. Approving moves the record to 101 (Active), and
 * that is the only thing that arms usp_AddUser's CustomerMaster check: an
 * application anywhere earlier in onboarding blocks no mobile at all.
 *
 * Which makes this page the last link in a chain the matrix depends on
 * entirely — Add Customer, consent, approval — and until it is automated, every
 * "existing customer" precondition has to be borrowed from real data.
 *
 * ── Who can use it ────────────────────────────────────────────────────────
 * Applications made by a Nayara user go straight to approval; ones made by a
 * non-Nayara user pass through /Customer/CustomerOnboardingReviewer first.
 * The FP_ADMIN this suite signs in as holds both, so no second account is
 * needed — confirmed against QA rather than assumed.
 *
 * ── Two behaviours worth knowing ──────────────────────────────────────────
 *
 * 1. Approve lives on the third tab only. The first two offer Next, Reject and
 *    Send for Correction; #btnApprove does not exist until Branch & Meeting is
 *    open. A test that looks for it on arrival finds nothing and reports the
 *    application as broken.
 *
 * 2. The row is reached by clicking, not by navigating. Consistent with the
 *    rest of this application, where a directly-loaded page renders without its
 *    action footer.
 */

/** What the maker submitted, retyped by the checker to satisfy the gate. */
export interface ReentryValues {
  pan: string;
  bankAccountNumber: string;
  /** Mandatory. The decision is refused outright without it. */
  remarks?: string;
}

export interface ApprovalOutcome {
  approved: boolean;
  /** Whatever the app said, for the report. */
  message: string;
}

export class ApproveCustomerPage extends BasePage {
  private readonly queue = '/Customer/ValidateNewCustomer';

  readonly referenceFilter = this.page.locator('#coaReferenceId');
  readonly quickFilter = this.page.locator('#coaGridQuickFilter');
  readonly rows = this.page.locator('table tbody tr');

  readonly basicInformationTab = this.page.locator('#BasicInformationTab');
  readonly addressTab = this.page.locator('#AddressTab');
  readonly branchMeetingTab = this.page.locator('#BranchMeetingTab');

  readonly panVerifyInput = this.page.locator('#approverPanVerifyInput');
  readonly panVerifyButton = this.page.locator('#btnApproverVerifyPan');
  readonly bankVerifyInput = this.page.locator('#approverBankAccountVerifyInput');
  readonly bankVerifyButton = this.page.locator('#btnApproverVerifyBankAccount');

  readonly remarks = this.page.locator('#Remarks');
  readonly remarksError = this.page.locator('#Remarks_error');

  readonly approveButton = this.page.locator('#btnApprove');
  readonly rejectButton = this.page.locator('#btnReject');

  private readonly activeModal = this.page.locator('.modal.show');

  constructor(page: Page) {
    super(page);
  }

  async openQueue(): Promise<void> {
    await this.navigateTo(this.queue);
    await this.rows.first().waitFor({ state: 'visible', timeout: 30_000 });
  }

  /**
   * Waits for one reference's row, filtering the grid down to it.
   *
   * Waiting for "a row" is not the same as waiting for *this* row: the grid
   * renders immediately and fills in over the next few seconds, so a lookup made
   * on arrival reports a genuinely-queued application as absent. The quick
   * filter also removes any dependence on which page of the grid it landed on.
   */
  private async findRow(reference: string): Promise<boolean> {
    await this.quickFilter.fill(reference);
    await this.page.waitForTimeout(1_500);

    return expect
      .poll(async () => this.approvalLink(reference).count(), {
        timeout: 20_000,
        message: `waiting for ${reference} to appear in the approval queue`,
      })
      .toBeGreaterThan(0)
      .then(() => true)
      .catch(() => false);
  }

  /** True when the reference is sitting in the approval queue. */
  async isPending(reference: string): Promise<boolean> {
    await this.openQueue();
    return this.findRow(reference);
  }

  private approvalLink(reference: string) {
    return this.page.locator(`a[href*="ReferenceNo=${reference}"]`).first();
  }

  /**
   * Opens the review for one application.
   *
   * Clicked from the queue rather than navigated to — see note 2.
   */
  async openReview(reference: string): Promise<void> {
    await this.openQueue();

    if (!(await this.findRow(reference))) {
      throw new Error(
        `Reference ${reference} is not in the approval queue. It is either not ` +
          `at status 105 yet — consent may still be outstanding — or it was ` +
          `approved already.`
      );
    }

    await this.clickElement(this.approvalLink(reference));
    await this.basicInformationTab.waitFor({ state: 'visible', timeout: 30_000 });
  }

  /**
   * Completes the four-eyes re-entry checks, then approves.
   *
   * The two Verify buttons are the gate. Per /js/approve-customer.js, the submit
   * path calls isPanVerifyOk() and isBankVerifyOk(), each of which is satisfied
   * only when its button is *disabled and reads "Verified"* — and nothing else
   * makes that happen. Skip them and Approve is silently inert: no message, no
   * validation, no request, no clue.
   *
   * They are not external lookups. The checker retypes the value and the page
   * compares it client-side against what the maker submitted ("PAN does not
   * match."). So automating them means passing back the same values the test
   * used to create the customer — which the caller necessarily knows.
   */
  async approve(reference: string, reentry: ReentryValues): Promise<ApprovalOutcome> {
    await this.openReview(reference);

    await this.verifyField('PAN', this.panVerifyInput, this.panVerifyButton, reentry.pan);
    await this.verifyField(
      'bank account',
      this.bankVerifyInput,
      this.bankVerifyButton,
      reentry.bankAccountNumber
    );

    for (const tab of [this.addressTab, this.branchMeetingTab]) {
      await this.clickElement(tab);
      await this.page.waitForTimeout(2_000);
    }

    await expect(
      this.approveButton,
      'Approve is missing from the Branch & Meeting tab'
    ).toBeVisible({ timeout: 20_000 });

    // Mandatory, and the reason an otherwise-complete approval does nothing:
    // window.ApproveCustomer() reads #Remarks first and returns outright when it
    // is empty, writing "Please enter Remarks" into #Remarks_error. No modal, no
    // request, no disabled button — the click simply evaporates.
    await this.fillInput(this.remarks.first(), reentry.remarks ?? 'Approved by automated regression run.');

    await this.clickElement(this.approveButton);
    await this.page.waitForTimeout(2_000);

    const refused = ((await this.remarksError.first().textContent().catch(() => '')) ?? '').trim();
    if (refused) throw new Error(`Approve was refused before submitting: ${refused}`);

    await this.confirmDecision();
    const message = await this.dismissOutcomeDialog();
    // Deliberately not inferred from the absence of an error: an inert click
    // leaves an empty message, and reading that as success is how this page
    // reported "approved" while the record sat untouched at 105. The caller
    // confirms against the database.
    return { approved: /approved|success/i.test(message), message };
  }

  /**
   * Answers the "I have verified and confirmed…" prompt.
   *
   * Matched by its label rather than by position: the modal offers
   * "Yes, approve" alongside "Cancel", and taking whichever button comes first
   * is a coin toss that silently abandons the approval when it loses.
   */
  private async confirmDecision(): Promise<void> {
    const confirm = this.page
      .locator('.modal.show')
      .getByRole('button', { name: /^yes,\s*(approve|send|reject)/i })
      .first();

    if (!(await confirm.isVisible({ timeout: 15_000 }).catch(() => false))) {
      throw new Error(
        'The approval confirmation prompt never appeared, so the decision was ' +
          'never submitted. Something rejected it before that point.'
      );
    }

    this.logger.info('Confirming the approval');
    await confirm.click();
    await this.page.waitForTimeout(6_000);
  }

  /**
   * Satisfies one re-entry check, or explains why it could not.
   *
   * A field with no stored value has no check to satisfy — isPanVerifyOk()
   * returns true when actualPan() is empty — so a missing input is skipped
   * rather than treated as a failure.
   */
  private async verifyField(
    label: string,
    input: Locator,
    button: Locator,
    value: string
  ): Promise<void> {
    if (!(await input.count())) {
      this.logger.info(`No ${label} re-entry field on this application; nothing to verify`);
      return;
    }

    await this.fillInput(input, value);
    await this.clickElement(button);
    await this.page.waitForTimeout(1_500);

    await expect(
      button,
      `The ${label} re-entry check did not pass. The page compares what is typed ` +
        `against the submitted value, so "${value}" does not match what the maker ` +
        `entered — Approve will stay inert until it does.`
    ).toHaveText(/verified/i, { timeout: 15_000 });

    this.logger.info(`${label} re-entry check passed`);
  }

  /**
   * Reads and clears whatever dialog the approval raised.
   *
   * Left open it swallows the next click, and the failure then surfaces
   * somewhere else entirely.
   */
  private async dismissOutcomeDialog(): Promise<string> {
    let message = '';

    for (let attempt = 0; attempt < 3; attempt++) {
      const modal = this.activeModal.first();
      if (!(await modal.isVisible().catch(() => false))) break;

      const text = ((await modal.textContent().catch(() => '')) ?? '').replace(/\s+/g, ' ').trim();
      if (text && !message) message = text;

      const button = modal.locator('button:visible, .btn:visible').first();
      if (!(await button.isVisible().catch(() => false))) break;
      await button.click().catch(() => undefined);
      await this.page.waitForTimeout(1_000);
    }

    if (message) this.logger.info(`Approval dialog: ${message}`);
    return message;
  }
}
