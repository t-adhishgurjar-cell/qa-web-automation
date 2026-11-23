import { Page } from '@playwright/test';

/**
 * The payment gateway FleetPlus QA hands off to: Pine Labs Plural UAT checkout
 * (plcheckout-uat.v2.pinepg.in), whose net-banking leg runs through BillDesk's UAT
 * "Netbanking Callback Simulator" (uat1.billdesk.com/u2/websimulator). Nothing here is a
 * real bank login — the simulator offers a Status drop-down of Success / Failure and a
 * Submit button — which is what makes the happy path executable at all.
 *
 * Measured flow:
 *   checkout  ── "Netbanking" ──> bank list ── "State bank Of India" ──> POPUP window
 *   popup: billdesk callbackSimulator ── Success|Failure + Submit ──> popup closes
 *   main: plcheckout /status  (failure: "Payment not completed!", Retry / X)
 *   X ── "Yes, Cancel" ── reason ── "Cancel Payment" ──> /PgRecharge/WalletRechargePgCallback
 */
export const SBI_LABEL = /^State bank Of India$/i;

export class PgCheckoutPage {
  constructor(private readonly page: Page) {}

  async waitForCheckout(timeout = 60_000): Promise<void> {
    await this.page.waitForURL(/plcheckout.*pinepg\.in/, { timeout });
    await this.page.getByText('SELECT A PAYMENT OPTION', { exact: false }).waitFor({ timeout });
  }

  async amountShown(): Promise<string> {
    return (await this.page.locator('.total-value').first().innerText().catch(() => '')).trim();
  }

  /** Netbanking → State Bank of India; returns the simulator window the bank opens in. */
  async payBySbiNetBanking(): Promise<Page> {
    await this.page.getByText('Netbanking', { exact: true }).click();
    const bank = this.page.getByText(SBI_LABEL).first();
    await bank.waitFor({ timeout: 30_000 });
    const popupP = this.page.context().waitForEvent('page', { timeout: 60_000 });
    await bank.click();
    const popup = await popupP;
    await popup.waitForURL(/billdesk/, { timeout: 90_000 });
    await popup.locator('#status').waitFor({ timeout: 60_000 });
    return popup;
  }

  async simulateBank(popup: Page, outcome: 'Success' | 'Failure'): Promise<void> {
    await popup.locator('#status').selectOption(outcome);
    await popup.locator('input[type=submit]').click();
  }

  /** On the gateway's failure page: the X, "Yes, Cancel", a reason, "Cancel Payment". */
  async cancelBackToMerchant(): Promise<void> {
    await this.page.locator('button.close-button').click();
    await this.page.getByText('Yes, Cancel').click();
    await this.page.getByText('Changed my mind').click();
    await this.page.getByRole('button', { name: 'Cancel Payment' }).click();
  }

  async waitForMerchantReturn(timeout = 120_000): Promise<void> {
    await this.page.waitForURL(/fleetforc\.com\/PgRecharge\//i, { timeout });
    await this.page.waitForLoadState('domcontentloaded');
  }
}
