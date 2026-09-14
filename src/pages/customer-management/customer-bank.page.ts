import { Page } from '@playwright/test';
import { BasePage } from '../base.page';

/**
 * Add Customer Bank Account — /Financial/AddBankDetails — and its checker,
 * Bank Account Approvals — /Financial/BankApprovals.
 *
 * A maker-checker pair, the same shape as customer onboarding: submitting
 * writes to RawCustomerBankDetails, and only approval moves it into
 * CustomerBankDetails. A test that stops at "Submitted successfully" has
 * verified half a feature — the account does not exist to the rest of the
 * system until the checker acts.
 *
 * ── The form is not on the page until you ask for it ──────────────────────
 * /Financial/AddBankDetails opens with a single search box. BankName,
 * AccountNumber, IFSCCode and the cancelled-cheque upload are all in the DOM
 * from the start but hidden; #btnShowAddForm reveals them, and only after a
 * customer has been found. Filling them without that step silently does
 * nothing, because the fields are not interactable and TargetCustomerID is
 * still empty.
 */
export class CustomerBankPage extends BasePage {
  private readonly addRoute = '/Financial/AddBankDetails';
  private readonly approveRoute = '/Financial/BankApprovals';

  // ── Maker: find the customer ─────────────────────────────────────────────
  readonly searchCustomerId = this.page.locator('#searchCustomerId');
  readonly searchButton = this.page.locator('#btnSearchBankDetails');
  readonly showAddFormButton = this.page.locator('#btnShowAddForm');

  // ── Maker: the form itself, hidden until revealed ────────────────────────
  readonly targetCustomerId = this.page.locator('#TargetCustomerID');
  readonly bankName = this.page.locator('#BankName');
  readonly accountHolderName = this.page.locator('#BankAccountHolderName');
  readonly accountNumber = this.page.locator('#BankAccountNumber');
  readonly ifscCode = this.page.locator('#IFSCCode');
  readonly chequeUpload = this.page.locator('#CancelledCheque');

  // ── Checker ──────────────────────────────────────────────────────────────
  readonly approvalCustomerId = this.page.locator('#CustomerID');
  readonly approvalFrom = this.page.locator('#FromDate');
  readonly approvalTo = this.page.locator('#ToDate');
  readonly approvalFilter = this.page.locator('#baSearchFilter');

  constructor(page: Page) {
    super(page);
  }

  async openAddForm(): Promise<void> {
    await this.navigateTo(this.addRoute);
    await this.searchCustomerId.waitFor({ state: 'visible', timeout: 30_000 });
  }

  async openApprovals(): Promise<void> {
    await this.navigateTo(this.approveRoute);
    await this.approvalCustomerId.waitFor({ state: 'visible', timeout: 30_000 });
  }

  readonly resultsTable = this.page.locator('#bankDetailsTbl');

  /** The grid's "nothing here" row, as the table component words it. */
  private static readonly EMPTY_ROW = /no data|no record|not found|nothing to show|empty/i;

  /**
   * Finds a customer. Returns false when the id matches nobody.
   *
   * Two earlier signals were wrong and both failed quietly, which is why this
   * one logs what it saw:
   *
   *   #btnShowAddForm  — visible from page load, before any search. Using it
   *                      made an id belonging to nobody look like a success.
   *   TargetCustomerID — stays empty in both cases.
   *   rows containing the customer id — the grid lists the customer's bank
   *                      accounts, not their id, so it never matches.
   *
   * What actually differs is the placeholder: an unknown id leaves the table
   * with a single "no data" row, a known one fills it with real accounts. A
   * customer with no accounts yet would also show the placeholder, so this
   * answers "has accounts to show", and the caller treats a false as "cannot
   * proceed" rather than "does not exist".
   */
  async findCustomer(customerId: string): Promise<boolean> {
    this.logger.info(`Searching bank details for ${customerId || '(blank)'}`);
    await this.searchCustomerId.fill(customerId);
    await this.clickElement(this.searchButton);
    await this.page.waitForTimeout(3_000);

    if (!customerId.trim()) return false;

    const rows = await this.resultsTable.locator('tbody tr').allTextContents();
    const real = rows
      .map(r => r.replace(/\s+/g, ' ').trim())
      .filter(r => r && !CustomerBankPage.EMPTY_ROW.test(r));

    this.logger.info(
      `${customerId}: ${rows.length} row(s), ${real.length} real. ` +
        `First: "${(rows[0] ?? '').replace(/\s+/g, ' ').trim().slice(0, 70)}"`
    );
    return real.length > 0;
  }

  async revealForm(): Promise<void> {
    await this.clickElement(this.showAddFormButton);
    await this.bankName.waitFor({ state: 'visible', timeout: 15_000 });
  }

  async fillAccount(details: BankAccountDetails): Promise<void> {
    await this.fillInput(this.bankName, details.bankName);
    await this.fillInput(this.accountHolderName, details.accountHolderName);
    await this.fillInput(this.accountNumber, details.accountNumber);
    await this.fillInput(this.ifscCode, details.ifscCode);
    if (details.chequeFile && (await this.chequeUpload.count())) {
      await this.chequeUpload.setInputFiles(details.chequeFile);
      await this.page.waitForTimeout(1_500);
    }
  }

  /**
   * Submits the form.
   *
   * The submit control carries no stable id on this screen, so it is matched by
   * role and restricted to what is visible — this application keeps disabled
   * duplicates of its buttons in the DOM, and an id-only match has already
   * found the hidden one twice on other screens.
   */
  async submit(): Promise<string> {
    const submit = this.page
      .locator('button:visible, input[type=submit]:visible')
      .filter({ hasText: /^\s*(submit|save|add bank account)\s*$/i })
      .first();
    await submit.click({ timeout: 20_000 });
    await this.page.waitForTimeout(3_500);
    const message = (await this.messages()).join(' | ');
    await this.dismissAnyDialog();
    return message;
  }

  /** Whatever the screen is telling the user, including the native bubble. */
  async messages(): Promise<string[]> {
    const texts = await this.page
      .locator('.modal.show, .toast:visible, .alert:visible, .invalid-feedback:visible, .text-danger:visible')
      .allTextContents();
    const native = await this.accountNumber
      .evaluate((el: HTMLInputElement) => el.validationMessage || '')
      .catch(() => '');
    return [...texts, native]
      .map(t => t.replace(/\s+/g, ' ').trim())
      // Bare asterisks mark required fields and are present regardless.
      .filter(t => t.length > 3 && /[a-z]/i.test(t));
  }

  async dismissAnyDialog(): Promise<void> {
    const control = this.page
      .locator('.modal.show button.btn-close, .modal.show .btn-primary, #confirmation-ok-btn')
      .first();
    if (await control.isVisible().catch(() => false)) {
      await control.click({ timeout: 5_000 }).catch(() => undefined);
      await this.page.waitForTimeout(800);
    }
  }

  // ── Checker detail page ──────────────────────────────────────────────────
  readonly verifyInput = this.page.locator('#verifyInput');
  readonly verifyButton = this.page.locator('#btnVerify');
  readonly remarks = this.page.locator('#txtRemarks');
  readonly approveButton = this.page.locator('#btnApprove');
  readonly rejectButton = this.page.locator('#btnReject');

  /**
   * Approves a pending bank account.
   *
   * "Approve" in the queue is a link, not a button: it navigates to
   * /Financial/BankApprovalDetail?bankDetailId=<id>, where the actual decision
   * lives behind a four-eyes re-entry — the same shape as customer approval.
   * Clicking it and then waiting for a confirmation modal, which is what the
   * first version did, waits on a page the browser has already left.
   *
   * Driven by bankDetailId rather than by hunting the grid. The queue has no
   * Reference Number column and masks the account to its last two digits, so
   * matching on "****92" is both fragile and ambiguous once a customer has more
   * than one pending row — which happens as soon as a run fails halfway.
   *
   * Returns what the screen said. The database decides whether it worked.
   */
  async approve(bankDetailId: number | string, accountNumber: string): Promise<ApprovalOutcome> {
    await this.navigateTo(`/Financial/BankApprovalDetail?bankDetailId=${bankDetailId}`);
    await this.page.waitForTimeout(2_000);

    if (!(await this.approveButton.isVisible().catch(() => false))) {
      return {
        reached: false,
        verified: false,
        message: `The approval detail page for ${bankDetailId} did not render its controls.`,
      };
    }

    // The checker retypes the account number and the page compares it
    // client-side against what the maker submitted. Skipping this leaves
    // Approve inert, with no message — the same trap as the customer screen.
    let verified = false;
    if (await this.verifyInput.isVisible().catch(() => false)) {
      await this.fillInput(this.verifyInput, accountNumber);
      await this.clickElement(this.verifyButton);
      await this.page.waitForTimeout(2_000);
      verified = await this.verifyButton
        .textContent()
        .then(t => /verified/i.test(t ?? ''))
        .catch(() => false);
      this.logger.info(`Account re-entry check ${verified ? 'passed' : 'did not report verified'}`);
    }

    // Mandatory on every approval screen in this application, and silently
    // fatal when empty.
    if (await this.remarks.isVisible().catch(() => false)) {
      await this.fillInput(this.remarks, 'Approved by automated regression run.');
    }

    await this.clickElement(this.approveButton);
    await this.page.waitForTimeout(2_500);

    const confirm = this.page
      .locator('#confirmation-ok-btn, .modal.show .btn-primary')
      .first();
    if (await confirm.isVisible().catch(() => false)) {
      await confirm.click({ timeout: 10_000 }).catch(() => undefined);
      await this.page.waitForTimeout(2_500);
    }

    const message = (await this.messages()).join(' | ');
    await this.dismissAnyDialog();
    return { reached: true, verified, message };
  }
}

export interface ApprovalOutcome {
  /** Whether the detail page rendered at all. */
  reached: boolean;
  /** Whether the account re-entry check reported success. */
  verified: boolean;
  message: string;
}

export interface BankAccountDetails {
  bankName: string;
  accountHolderName: string;
  accountNumber: string;
  ifscCode: string;
  chequeFile?: string;
}
