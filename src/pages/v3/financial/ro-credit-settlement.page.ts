import { Locator, Page } from '@playwright/test';
import { BasePage } from '../../base.page';
import { AppDialogs } from './app-dialogs';

/**
 * RO Credit Settlement — /Customer/RoCreditSettlement (ro-credit-settlement.js).
 *
 * Home: Customer ID / Customer Name (disabled, prefilled), Available Wallet Balance and a
 * branch grid (#rcsBranchOutstandingTbl) with "Outstanding (FP Settleable)" and
 * "Outstanding (Offline Settleable)" per branch and a Pay button. Everything on it comes
 * from one POST to /Customer/SearchROSettlement, whose JSON carries the wallet balances,
 * branch and RO lists and the monthly breakup — the source of truth the grid is checked
 * against.
 *
 * Pay opens #rcsPayModal:
 *   step 1  one card per retail outlet (.rcs-ro-select-option) and the Total Outstanding;
 *           Close (#rcsBtnModalClose) returns to the home page
 *   step 2  Full amount (#rcsAmountFull + months count) or Partial amount
 *           (#rcsAmountPartial + #rcsPartialPayAmount), the month breakup, Pay from
 *           Parent (#rcsWalletParent) or Child (#rcsWalletChild) wallet, then Continue
 *           (#rcsBtnPayContinue) — which reveals the OTP section and sends the OTP —
 *           and Pay (#rcsBtnSubmitPayment), which validates the OTP and calls
 *           /Customer/PayRoOutstanding.
 */
export class RoCreditSettlementPage extends BasePage {
  static readonly route = '/Customer/RoCreditSettlement';
  static readonly searchUrl = '/Customer/SearchROSettlement';
  static readonly payUrl = '/Customer/PayRoOutstanding';

  readonly title = this.page.locator('p.box-head-title').first();
  readonly customerId = this.page.locator('#customerId');
  readonly customerName = this.page.locator('#customerName');
  readonly walletBalance = this.page.locator('#rcsPageWalletBalance');
  readonly grid = this.page.locator('#rcsBranchOutstandingTbl');
  readonly gridRows = this.page.locator('#rcsBranchOutstandingTbl tbody tr[data-branch-uid]');
  readonly modal = this.page.locator('#rcsPayModal');
  readonly modalOpen = this.page.locator('#rcsPayModal.show');
  readonly roCards = this.page.locator('#rcsRoCardList .rcs-ro-select-option');
  readonly totalOutstanding = this.page.locator('#rcsRoStepTotalBalance');
  readonly closeButton = this.page.locator('#rcsBtnModalClose');
  readonly full = this.page.locator('#rcsAmountFull');
  readonly fullMonths = this.page.locator('#rcsFullMonthCount');
  readonly partial = this.page.locator('#rcsAmountPartial');
  readonly partialAmount = this.page.locator('#rcsPartialPayAmount');
  readonly partialError = this.page.locator('#rcsPartialAmountError');
  readonly selectedTotal = this.page.locator('#rcsPaymentSelectedTotal');
  readonly breakupTotal = this.page.locator('#rcsPaymentBreakupTotal');
  readonly parentWallet = this.page.locator('#rcsWalletParent');
  readonly childWallet = this.page.locator('#rcsWalletChild');
  readonly parentInsufficient = this.page.locator('#rcsModalParentWalletInsufficient');
  readonly childInsufficient = this.page.locator('#rcsModalChildWalletInsufficient');
  readonly continueButton = this.page.locator('#rcsBtnPayContinue');
  readonly payButton = this.page.locator('#rcsBtnSubmitPayment');
  readonly otpSection = this.page.locator('#rcsPayOtpSection');
  readonly otpInput = this.page.locator('#rcsPayOtpInput');
  readonly otpError = this.page.locator('#rcsPayOtpError');
  readonly dialogs = new AppDialogs(this.page);

  constructor(page: Page) {
    super(page);
  }

  /** Opens the page and returns the SearchROSettlement payload it was built from. */
  async open(): Promise<SettlementSearch> {
    const responseP = this.page.waitForResponse(r => r.url().includes(RoCreditSettlementPage.searchUrl), { timeout: 60_000 });
    await this.navigateTo(RoCreditSettlementPage.route);
    const json = await (await responseP).json();
    await this.settle();
    return json.data as SettlementSearch;
  }

  row(branchUid: string): Locator {
    return this.page.locator(`#rcsBranchOutstandingTbl tbody tr[data-branch-uid="${branchUid}"]`);
  }

  async openPay(branchUid: string): Promise<void> {
    await this.row(branchUid).getByRole('button', { name: 'Pay' }).click();
    await this.modalOpen.waitFor({ state: 'visible', timeout: 15_000 });
    await this.roCards.first().waitFor({ state: 'visible', timeout: 15_000 });
  }

  async selectRo(index = 0): Promise<void> {
    await this.roCards.nth(index).click();
    await this.partial.waitFor({ state: 'attached' });
    await this.page.locator('#rcsModalPart2').waitFor({ state: 'visible', timeout: 10_000 });
  }

  async enterPartial(amount: string): Promise<string> {
    await this.partial.check({ force: true });
    await this.partialAmount.fill('');
    await this.partialAmount.pressSequentially(amount, { delay: 20 });
    await this.partialAmount.blur();
    await this.page.waitForTimeout(300);
    return this.partialAmount.inputValue();
  }

  async closeModal(): Promise<void> {
    if (await this.modalOpen.count()) {
      const back = this.page.locator('#rcsBtnModalBack');
      if (await this.closeButton.isVisible()) await this.closeButton.click();
      else if (await back.isVisible()) {
        await back.click();
        await this.closeButton.click();
      } else await this.page.locator('#rcsPayModal .btn-close').click();
      await this.modalOpen.waitFor({ state: 'detached', timeout: 10_000 }).catch(() => undefined);
    }
  }
}

export interface SettlementSearch {
  customerId: string;
  customerName: string;
  parentWalletBalance: number;
  childWalletBalance: number;
  totalOutstandingFp: number;
  totalOutstandingOffline: number;
  partialPayMinVal: number;
  partialPayMaxVal: number;
  branches: Array<{ branchLocation: string; branchUid: string; roCount: number; outstandingFp: number; outstandingOffline: number; walletBalance: number }>;
  roList: Array<{ roCode: string; roName: string; roArea: string; branchUid: string; outstandingFp: number; outstandingOffline: number }>;
  monthlyBreakup: Array<{ roCode: string; branchUid: string; year: number; month: number; outstanding: number; monthLabel: string }>;
}

/** "₹4,262.00" -> 4262 */
export function rupees(text: string): number {
  return Number(String(text).replace(/[^\d.-]/g, ''));
}
