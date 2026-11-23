import { Locator, Page } from '@playwright/test';
import { BasePage } from '../../base.page';
import { AppDialogs } from './app-dialogs';

/**
 * Wallet Recharge By PG — /PgRecharge/WalletRecharge.
 *
 * ── The Customer ID field depends on who is signed in ─────────────────────
 * wallet-recharge-customer-id.js renders one of three controls, chosen server-side:
 *   editable     (FP Admin)        #wrEditableCustomerInput — any customer may be typed
 *   parentChoice (Customer Admin)  #wrSelfCustomerDisplay, read-only, plus "Recharge for"
 *                                  Self / Branch (#wrRechargeScope, a SumoSelect)
 *   locked       (Branch Admin)    #wrLockedCustomerDisplay, read-only
 * so the Customer ID validation cases can only be driven from the FP Admin.
 *
 * ── There is no gateway picker in 1.4.0 ──────────────────────────────────
 * The page script carries a single default gateway, `{ bankName: "PG" }`, and never
 * renders a selection card or a "Selected PG" field. Proceed calls
 * GetCustomerDetailsForRechargeByPg (the server enforces ₹1.00 – ₹1,00,000.00 there),
 * opens the shared confirmation dialog, and Yes calls InsertRechargeByPg and redirects
 * through ProceedToPgCheckout to the Pine Labs (Plural UAT) checkout.
 */
export class WalletRechargePage extends BasePage {
  static readonly route = '/PgRecharge/WalletRecharge';

  readonly heading = this.page.locator('p.box-head-title').first();
  readonly rechargeDetailsSection = this.page.getByText('Recharge details', { exact: true });
  readonly editableCustomerId = this.page.locator('#wrEditableCustomerInput');
  readonly selfCustomerId = this.page.locator('#wrSelfCustomerDisplay');
  readonly lockedCustomerId = this.page.locator('#wrLockedCustomerDisplay');
  readonly hiddenCustomerId = this.page.locator('#CustomerId');
  readonly amount = this.page.locator('#RechargeAmount');
  readonly scope = this.page.locator('#wrRechargeScope');
  readonly customerIdError = this.page.locator('#CustomerIdErr');
  readonly amountError = this.page.locator('#RechargeAmountErr');
  readonly proceed = this.page.locator('#btnProceed');
  readonly reset = this.page.locator('#btnReset');
  readonly statusLink = this.page.getByRole('link', { name: /View Wallet Recharge Status/i });
  readonly dialogs = new AppDialogs(this.page);

  /** What the sheet calls the gateway controls; looked up by wording because no ids exist. */
  readonly pgSelectionCard = this.page.locator('#wrPgSection, .pg-card, [class*="pg-select"], input[name*="PG" i][type=radio], input[name*="gateway" i]');
  readonly selectedPgField = this.page.locator('#SelectedPg, #selectedPg, input[id*="SelectedPG" i]');
  readonly getTransactionStatusButton = this.page.getByRole('button', { name: /Get Transaction Status/i });

  constructor(page: Page) {
    super(page);
  }

  async open(): Promise<void> {
    await this.navigateTo(WalletRechargePage.route);
    await this.amount.waitFor({ state: 'visible', timeout: 30_000 });
    // The customer-id control is initialised on DOM ready and fetches child branches.
    await this.settle();
  }

  /** Types into the amount box the way a user would, so the input sanitiser runs. */
  async typeAmount(value: string): Promise<string> {
    await this.amount.fill('');
    await this.amount.pressSequentially(value, { delay: 20 });
    await this.amount.blur();
    return this.amount.inputValue();
  }

  async typeCustomerId(value: string): Promise<string> {
    await this.editableCustomerId.fill('');
    await this.editableCustomerId.pressSequentially(value, { delay: 20 });
    await this.editableCustomerId.blur();
    await this.settle(4_000);
    return this.editableCustomerId.inputValue();
  }

  /** The confirmation dialog's body, which names the customer and the amount. */
  confirmationText(): Locator {
    return this.dialogs.text('confirmation');
  }

  async clearForm(): Promise<void> {
    await this.dialogs.dismissAll();
    await this.reset.click();
    await this.customerIdError.waitFor({ state: 'attached' });
  }
}
