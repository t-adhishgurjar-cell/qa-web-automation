import { Page } from '@playwright/test';
import { BasePage } from '../../base.page';
import { AppDialogs } from './app-dialogs';

/**
 * Manage Products and Transactions — /Vehicle/EnableDisableProdTrans
 * (enabledisableprodtrans.js). FP Admin only in 1.4.0: a Customer Admin opening the route
 * gets "Unauthorized Access".
 *
 * Tabs Customer / Branch / Vehicle (#edNavCustomer …). On the Customer tab the id goes in
 * #CustomerId; Search (#btnSearch) stays disabled until something is typed. Results:
 * #dvDetails with two collapsible sections, Products and Transaction Types, each a pair of
 * lists headed "Disabled" (#edDropAvailable…) and "Enabled" (#edDropAllowed…) — the
 * sheet's "Available" and "Allowed".
 */
export class ProductsTransactionsPage extends BasePage {
  static readonly route = '/Vehicle/EnableDisableProdTrans';

  readonly title = this.page.locator('p.box-head-title').first();
  readonly customerTab = this.page.locator('#edNavCustomer');
  readonly customerId = this.page.locator('#CustomerId');
  readonly customerIdError = this.page.locator('#CustomerIdValErrMsg');
  readonly searchButton = this.page.locator('#btnSearch');
  readonly resetButton = this.page.locator('#btnReset');
  readonly details = this.page.locator('#dvDetails');
  readonly customerName = this.page.locator('#customerName');
  readonly productsToggle = this.page.locator('button[data-ed-collapse-target="#edProductsCollapse"]');
  readonly transactionsToggle = this.page.locator('button[data-ed-collapse-target="#edTransactionsCollapse"]');
  readonly productsAvailable = this.page.locator('#edDropAvailableProducts');
  readonly productsAllowed = this.page.locator('#edDropAllowedProducts');
  readonly productsAvailableHeader = this.page.locator('#hdrAvailableProduct');
  readonly productsAllowedHeader = this.page.locator('#hdrAllowedProduct');
  readonly transactionsAvailable = this.page.locator('#edDropAvailableTransactions');
  readonly transactionsAllowed = this.page.locator('#edDropAllowedTransactions');
  readonly noRecord = this.page.locator('#edNoRecord');
  readonly dialogs = new AppDialogs(this.page);

  constructor(page: Page) {
    super(page);
  }

  async open(): Promise<void> {
    await this.navigateTo(ProductsTransactionsPage.route);
    await this.customerTab.waitFor({ state: 'visible', timeout: 30_000 });
    await this.settle();
    await this.customerTab.click();
  }

  async typeCustomerId(id: string): Promise<void> {
    await this.customerId.fill('');
    await this.customerId.pressSequentially(id, { delay: 15 });
    await this.customerId.blur();
  }
}
