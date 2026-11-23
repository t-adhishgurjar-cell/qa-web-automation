import { Page } from '@playwright/test';
import { BasePage } from '../../base.page';
import { AppDialogs } from './app-dialogs';

/**
 * Fuel Voucher — the three customer-side screens.
 *
 *   /FuelVoucher/FuelVoucherDetails        Manage Fuel Voucher: search, list, Cancel
 *                                          (button.fv-cancel-voucher[data-voucher-code];
 *                                          cancelling refunds the issuer's wallet)
 *   /FuelVoucher/RenderGenerateVoucherPage Generate Voucher: Recipient Mobile → the
 *                                          recipient's Customer IDs (#RecipientCustomerId),
 *                                          Amount (whole rupees), Valid Through; Generate →
 *                                          confirmation (Confirm) → /FuelVoucher/GenerateVoucher
 *   /FuelVoucher/BulkGenerateFuelVoucher   Bulk: Download Template, Upload (#bfvFileInput),
 *                                          preview grid, Submit (#bfvBtnIssueAll) → server
 *                                          validation → confirmation (Yes) →
 *                                          /FuelVoucher/IssueBulkVouchers
 *
 * The bulk template's columns: Recipient Mobile No | Recipient Customer ID | Amount |
 * Valid Through (DD-MM-YYYY).
 */
export const BULK_HEADER = ['Recipient Mobile No', 'Recipient Customer ID', 'Amount', 'Valid Through (DD-MM-YYYY)'];

export class FuelVoucherPage extends BasePage {
  static readonly manageRoute = '/FuelVoucher/FuelVoucherDetails';
  static readonly generateRoute = '/FuelVoucher/RenderGenerateVoucherPage';
  static readonly bulkRoute = '/FuelVoucher/BulkGenerateFuelVoucher';

  // Generate
  readonly recipientMobile = this.page.locator('#RecipientMobileNo');
  readonly recipientCustomerId = this.page.locator('#RecipientCustomerId');
  readonly amount = this.page.locator('#Amount');
  readonly validThrough = this.page.locator('#ValidThrough');
  readonly generate = this.page.locator('#btnGenerateVoucher');
  readonly walletBalanceText = this.page.locator('#PrepaidBalanceText');

  // Bulk
  readonly bulkFile = this.page.locator('#bfvFileInput');
  readonly bulkUpload = this.page.locator('#bfvBtnPickUpload');
  readonly bulkRows = this.page.locator('#bfvPreviewBody tr');
  readonly bulkSubmit = this.page.locator('#bfvBtnIssueAll');
  readonly bulkSummary = this.page.locator('#bfvTotalDisplay, #bfvTotalRecordsDisplay').first();

  readonly dialogs = new AppDialogs(this.page);

  constructor(page: Page) {
    super(page);
  }

  async openGenerate(): Promise<void> {
    await this.navigateTo(FuelVoucherPage.generateRoute);
    await this.recipientMobile.waitFor({ state: 'visible', timeout: 30_000 });
    await this.settle();
  }

  async openBulk(): Promise<void> {
    await this.navigateTo(FuelVoucherPage.bulkRoute);
    await this.bulkUpload.waitFor({ state: 'visible', timeout: 30_000 });
    await this.settle();
  }

  /** Types the recipient's mobile and waits for their Customer IDs to load. */
  async enterRecipient(mobile: string): Promise<string[]> {
    await this.recipientMobile.fill('');
    // The lookup is debounced (400 ms) after the tenth digit, then posted.
    const lookup = this.page.waitForResponse(r => r.url().includes('/FuelVoucher/GetCustomersByMobile'), { timeout: 20_000 });
    await this.recipientMobile.pressSequentially(mobile, { delay: 20 });
    await this.recipientMobile.blur();
    this.lastLookup = await (await lookup).text().catch(() => '');
    await this.page.waitForTimeout(300);
    return (await this.recipientCustomerId.locator('option').allInnerTexts()).map(o => o.trim());
  }

  /** The raw GetCustomersByMobile answer from the last enterRecipient, for the report. */
  lastLookup = '';

  async chooseRecipientCustomer(customerId: string): Promise<void> {
    await this.page.evaluate(v => {
      const $ = (window as unknown as { jQuery: (s: string) => { val: (x: string) => { trigger: (e: string) => void } } }).jQuery;
      $('#RecipientCustomerId').val(v).trigger('change');
    }, customerId);
  }

  async uploadBulk(file: string): Promise<void> {
    await this.bulkFile.setInputFiles(file);
    await this.settle(5_000);
  }

  /**
   * Cancels a voucher through the page's own request (the same jQuery call the Cancel button
   * makes), for cleanup of vouchers a test issued. Returns the service's answer.
   */
  async cancelViaService(voucherCode: string): Promise<{ success: boolean; message?: string }> {
    return this.page.evaluate(code => new Promise(resolve => {
      const jq = (window as unknown as { jQuery: { ajax: (o: unknown) => void } }).jQuery;
      jq.ajax({
        url: '/FuelVoucher/CancelVoucher', type: 'POST', contentType: 'application/json',
        data: JSON.stringify({ VoucherCode: code }),
        success: (r: { success: boolean; message?: string }) => resolve(r),
        error: (x: { status: number }) => resolve({ success: false, message: `HTTP ${x.status}` }),
      });
    }), voucherCode);
  }
}

/** DD-MM-YYYY, `days` from today. */
export function dmy(days: number): string {
  const d = new Date(Date.now() + days * 86_400_000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}-${p(d.getMonth() + 1)}-${d.getFullYear()}`;
}

/** YYYY-MM-DD, `days` from today (the date input's value format). */
export function ymd(days: number): string {
  const d = new Date(Date.now() + days * 86_400_000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
