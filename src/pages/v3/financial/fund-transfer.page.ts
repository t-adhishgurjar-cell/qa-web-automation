import { Locator, Page } from '@playwright/test';
import { BasePage } from '../../base.page';
import { AppDialogs } from './app-dialogs';

/**
 * Wallet Transfer (the sheet's "Fund Transfer") — /Financial/FundTransfer.
 *
 * Customer Admin view: the parent's Customer ID is prefilled and disabled, the grid lists
 * every branch wallet, and each row carries its own Transfer To select, Amount box and
 * Transfer button. Row values, from the page script:
 *   Transfer To  ''      Select
 *                credit  Branch wallet → Customer wallet   (branch to parent)
 *                debit   Customer wallet → Branch wallet   (parent to branch)
 * The amount box stays disabled until a direction is chosen; the client validates it
 * against the source wallet (minimum ₹0.01) and keeps Transfer disabled while invalid.
 *
 * ── Transfer is OTP-gated ─────────────────────────────────────────────────
 * Transfer opens #ftModalFundTransferOtp and calls FundTransferGenerateOtp at once;
 * Verify calls FundTransferValidateOtp, then ExecuteFundTransfer with
 * { ParentCustomerId, BranchCustomerId, Amount, TransferMode }. That last request is the
 * one the security cases tamper with.
 */
export class FundTransferPage extends BasePage {
  static readonly route = '/Financial/FundTransfer';
  static readonly executeUrl = '/Financial/ExecuteFundTransfer';

  readonly title = this.page.locator('p.box-head-title').first();
  readonly breadcrumb = this.page.locator('.breadcrumb');
  readonly customerId = this.page.locator('#customerId');
  readonly branchFilter = this.page.locator('#selBranchOfficeUid');
  readonly searchButton = this.page.locator('#btnFundTransferSearch');
  readonly parentBalance = this.page.locator('#fundTransferParentWalletBalance');
  readonly grid = this.page.locator('#txnTable');
  readonly rows = this.page.locator('#fundTransferBranchRows tr[data-branch-uid]');
  readonly gridAlert = this.page.locator('#fundTransferGridAlert');
  readonly otpModal = this.page.locator('#ftModalFundTransferOtp');
  readonly otpInput = this.page.locator('#ftFundTransferOtpInput');
  readonly otpVerify = this.page.locator('#ftBtnFundTransferVerify');
  readonly otpError = this.page.locator('#ftFundTransferOtpError');
  readonly dialogs = new AppDialogs(this.page);

  constructor(page: Page) {
    super(page);
  }

  async open(): Promise<void> {
    await this.navigateTo(FundTransferPage.route);
    await this.customerId.waitFor({ state: 'attached', timeout: 30_000 });
    await this.rows.first().waitFor({ state: 'visible', timeout: 45_000 });
    await this.settle();
  }

  /**
   * Filters the grid and clicks Search. After its own auto-search the page locks Search
   * until the filter changes, so asking again for the filter already applied finds the
   * button disabled — the grid already shows that result and there is nothing to click.
   */
  async search(branchUid = ''): Promise<void> {
    const current = await this.branchFilter.inputValue();
    await this.branchFilter.selectOption(branchUid);
    const enabled = await this.page
      .waitForFunction(() => !(document.querySelector('#btnFundTransferSearch') as HTMLButtonElement | null)?.disabled, null, { timeout: current === branchUid ? 3_000 : 30_000 })
      .then(() => true)
      .catch(() => false);
    if (enabled) {
      await this.searchButton.click();
      await this.settle();
    }
    await this.rows.first().waitFor({ state: 'visible', timeout: 30_000 });
  }

  row(branchUid: string): Locator {
    return this.page.locator(`#fundTransferBranchRows tr[data-branch-uid="${branchUid}"]`);
  }

  direction(branchUid: string): Locator {
    return this.row(branchUid).locator('select.ft-credit-debit, select[aria-label="Transfer To"]').first();
  }

  amount(branchUid: string): Locator {
    return this.row(branchUid).locator('input.ft-amount, input[placeholder="Enter amount"]').first();
  }

  feedback(branchUid: string): Locator {
    return this.row(branchUid).locator('.ft-amount-feedback').first();
  }

  transferButton(branchUid: string): Locator {
    return this.row(branchUid).locator('button.ft-transfer, button:has-text("Transfer")').first();
  }

  async branchBalance(branchUid: string): Promise<number> {
    return Number(await this.row(branchUid).getAttribute('data-branch-balance'));
  }

  async parentBalanceShown(): Promise<number> {
    const t = (await this.parentBalance.innerText()).replace(/[₹,\s]/g, '');
    return Number(t);
  }

  /** Chooses a direction and types an amount the way a user does, so the sanitiser runs. */
  async enter(branchUid: string, mode: 'credit' | 'debit' | '', amount: string): Promise<string> {
    await this.direction(branchUid).selectOption(mode);
    const box = this.amount(branchUid);
    if (mode) {
      await box.waitFor({ state: 'visible' });
      await this.page.waitForFunction(el => !(el as HTMLInputElement).disabled, await box.elementHandle(), { timeout: 5_000 });
      await box.fill('');
      await box.pressSequentially(amount, { delay: 20 });
      await box.blur();
    }
    return box.inputValue();
  }

  /** Transfer → OTP modal → Verify. Resolves once ExecuteFundTransfer has answered. */
  async transferWithOtp(branchUid: string, otp: () => Promise<string>): Promise<{ status: number; body: string }> {
    await this.transferButton(branchUid).click();
    await this.otpModal.and(this.page.locator('.show')).waitFor({ state: 'visible', timeout: 20_000 });
    const code = await otp();
    await this.otpInput.fill(code);
    const responseP = this.page.waitForResponse(r => r.url().includes(FundTransferPage.executeUrl), { timeout: 60_000 });
    await this.otpVerify.click();
    const response = await responseP;
    return { status: response.status(), body: await response.text().catch(() => '') };
  }
}
