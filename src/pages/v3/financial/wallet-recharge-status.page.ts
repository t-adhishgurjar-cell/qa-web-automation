import { Page } from '@playwright/test';
import { BasePage } from '../../base.page';

/** View Wallet Recharge Status — /PgRecharge/PgTransactionDetails. */
export class WalletRechargeStatusPage extends BasePage {
  static readonly route = '/PgRecharge/PgTransactionDetails';

  readonly searchButton = this.page.locator('#btnSearch, [id$="Search"], button:has-text("Search")').first();
  readonly resetButton = this.page.locator('#btnReset, button:has-text("Reset")').first();

  constructor(page: Page) {
    super(page);
  }

  async open(): Promise<void> {
    await this.navigateTo(WalletRechargeStatusPage.route);
    await this.settle();
  }

  async search(): Promise<void> {
    if (await this.searchButton.isVisible().catch(() => false)) {
      await this.clickElement(this.searchButton);
      await this.settle();
    }
  }
}
