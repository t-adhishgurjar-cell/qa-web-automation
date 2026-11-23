import { Page } from '@playwright/test';
import { BasePage } from '../../base.page';

/**
 * Suspense Transactions — /Financial/UnclaimedTransactions (FP Admin, menu Admin).
 *
 * A client-side DataTable over the EFT credits that could not be matched to a customer
 * (dbo.EFTRechargeUnclaimedAccount, RechargeStatus 802). Each row's Edit opens
 * /Financial/UnclaimedTransactionDetails/<UTR>, where a Virtual Account Number can be
 * entered (#virtualAccNo) and submitted (#btnSettleTransaction) to claim the credit for a
 * customer — /Financial/SettleUnclaimedTransaction. That submit moves real money when the
 * account is valid, so the suite only ever submits a deliberately invalid one.
 */
export const SUSPENSE_COLUMNS = ['Sr No', 'UTR Number', 'Remitter Name', 'Remitter Bank Account Number', 'Remitter IFSC Code', 'Virtual Account No', 'Transaction Date', 'Amount', 'Action'] as const;

export class SuspensePage extends BasePage {
  static readonly route = '/Financial/UnclaimedTransactions';

  readonly title = this.page.locator('p.box-head-title').first();
  readonly search = this.page.locator('#uctSearchFilter');
  readonly excel = this.page.locator('#btnDownloadUCTExcel');
  readonly pdf = this.page.locator('#btnDownloadUCTPdf');
  readonly length = this.page.locator('#UnclaimedTbl_wrapper select[aria-controls="UnclaimedTbl"], #uctLengthHost select').first();
  readonly grid = this.page.locator('#UnclaimedTbl');
  readonly rows = this.page.locator('#UnclaimedTbl tbody tr');
  readonly info = this.page.locator('#UnclaimedTbl_info');
  readonly nextPage = this.page.locator('#UnclaimedTbl_wrapper button[data-dt-idx="next"], #UnclaimedTbl_wrapper .dt-paging-button.next').first();
  readonly virtualAccNo = this.page.locator('#virtualAccNo');
  readonly virtualAccNoFeedback = this.page.locator('#virtualAccNoFeedback');
  readonly submit = this.page.locator('#btnSettleTransaction');

  constructor(page: Page) {
    super(page);
  }

  async open(): Promise<void> {
    await this.navigateTo(SuspensePage.route);
    await this.rows.first().waitFor({ state: 'visible', timeout: 45_000 });
    await this.settle();
  }

  async table(): Promise<Array<Record<string, string>>> {
    const out: Array<Record<string, string>> = [];
    const n = await this.rows.count();
    for (let i = 0; i < n; i++) {
      const cells = (await this.rows.nth(i).locator('td').allInnerTexts()).map(c => c.trim());
      if (cells.length < 8) continue;
      out.push(Object.fromEntries(SUSPENSE_COLUMNS.map((c, j) => [c, cells[j] ?? ''])));
    }
    return out;
  }

  /** "Showing 1 to 10 of 214 Records" -> { from: 1, to: 10, total: 214 } */
  async infoNumbers(): Promise<{ from: number; to: number; total: number }> {
    const t = (await this.info.innerText()).replace(/,/g, '');
    const m = t.match(/(\d+)\s+to\s+(\d+)\s+of\s+(\d+)/i);
    return { from: Number(m?.[1] ?? 0), to: Number(m?.[2] ?? 0), total: Number(m?.[3] ?? 0) };
  }

  async typeSearch(text: string): Promise<void> {
    await this.search.fill('');
    await this.search.pressSequentially(text, { delay: 15 });
    await this.page.waitForTimeout(800);
  }
}
