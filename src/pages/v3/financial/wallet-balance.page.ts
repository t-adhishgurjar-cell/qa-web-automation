import { Page } from '@playwright/test';
import { BasePage } from '../../base.page';

/**
 * View Wallet Balance — /Financial/ShowWalletBalance (Wallet Management menu).
 *
 * Customer Admin view: Customer ID is prefilled and disabled; the only filter is the
 * "Branch Location" select (default "All branches"), which reloads the balance cards and
 * the branch grid. FP Admin gets an editable Customer ID instead.
 */
export class WalletBalancePage extends BasePage {
  static readonly route = '/Financial/ShowWalletBalance';

  readonly heading = this.page.getByText('Customer Wallet Balance', { exact: true });
  readonly customerId = this.page.getByRole('textbox', { name: /Customer ID/i }).first();
  readonly branchGridRows = this.page.locator('table tbody tr');

  constructor(page: Page) {
    super(page);
  }

  async open(): Promise<void> {
    await this.navigateTo(WalletBalancePage.route);
    await this.heading.waitFor({ state: 'visible', timeout: 30_000 });
    await this.settle();
  }

  /**
   * Changes the Branch Location filter to the first specific branch (or back to the
   * default) so the page issues its balance POST. The select is hidden behind a styled
   * control, so the value is set directly and the change event fired.
   */
  async pickBranch(index = 1): Promise<string> {
    const picked = await this.page.evaluate(i => {
      const sel = Array.from(document.querySelectorAll('select')).find(s =>
        Array.from(s.options).some(o => /all branches/i.test(o.text))
      ) as HTMLSelectElement | undefined;
      if (!sel || sel.options.length === 0) return '';
      const opt = sel.options[Math.min(i, sel.options.length - 1)];
      sel.value = opt.value;
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      const jq = (window as unknown as { jQuery?: (el: Element) => { trigger: (e: string) => void } }).jQuery;
      jq?.(sel).trigger('change');
      return opt.text.trim();
    }, index);
    await this.settle();
    return picked;
  }
}
