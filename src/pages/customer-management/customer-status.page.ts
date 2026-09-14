import { Locator, Page, expect } from '@playwright/test';
import { BasePage } from '../base.page';

/**
 * Activate / Deactivate Customer — /Customer/ManageCustomerStatus.
 *
 * Two flows share one screen. The single flow searches a customer ID and offers
 * one button; the bulk flow takes a spreadsheet and a radio choice. They are
 * modelled separately because they fail in different ways and only the single
 * flow can be exercised without uploading a file.
 *
 * ── The button label is the status ────────────────────────────────────────
 * There is no status field on the single flow. #btnSingleAction reads
 * "Deactivate" for an active customer and "Activate" for an inactive one — the
 * action available, not the state held. Reading it as the state gets the answer
 * exactly backwards, which is why currentStatus() inverts it explicitly rather
 * than leaving the caller to remember.
 *
 * ── Everything interesting starts hidden ──────────────────────────────────
 * #btnSingleAction, #mcsResultsTbl, the export buttons and the confirmation
 * modal are all in the DOM before a search runs. Waiting on presence rather
 * than visibility passes instantly and proves nothing.
 */
export class CustomerStatusPage extends BasePage {
  private readonly route = '/Customer/ManageCustomerStatus';

  // ── Single flow ──────────────────────────────────────────────────────────
  readonly searchInput = this.page.locator('#searchInput');
  readonly searchButton = this.page.locator('#btnSearch');
  readonly singleAction = this.page.locator('#btnSingleAction');
  readonly resetButton = this.page.locator('#btnResetPage');

  // ── Bulk flow ────────────────────────────────────────────────────────────
  readonly bulkActivate = this.page.locator('#bulkActivate');
  readonly bulkDeactivate = this.page.locator('#bulkDeactivate');
  readonly bulkFileInput = this.page.locator('#bulkFileInput');
  readonly bulkTemplateButton = this.page.locator('#btnBulkDownloadTemplate');
  readonly processBulkButton = this.page.locator('#btnProcessBulk');
  readonly bulkHelpButton = this.page.locator('#btnBulkUploadHelp');

  // ── Results and exports ──────────────────────────────────────────────────
  readonly resultsTable = this.page.locator('#mcsResultsTbl');
  readonly resultsFilter = this.page.locator('#mcsResultsSearchFilter');
  readonly exportExcel = this.page.locator('#btnMcsResultsExcel');
  readonly exportPdf = this.page.locator('#btnMcsResultsPdf');

  // ── Confirmation ─────────────────────────────────────────────────────────
  readonly confirmOk = this.page.locator('#confirmation-ok-btn');
  readonly confirmCancel = this.page.locator('#confirmation-cancel-btn');
  readonly confirmClose = this.page.locator('#confirmation-mess-close-btn');

  constructor(page: Page) {
    super(page);
  }

  async open(): Promise<void> {
    await this.navigateTo(this.route);
    await this.searchInput.waitFor({ state: 'visible', timeout: 30_000 });
  }

  /** True when the screen rendered its own controls rather than a login page. */
  async isAccessible(): Promise<boolean> {
    if (/login/i.test(this.page.url())) return false;
    return this.searchInput.isVisible().catch(() => false);
  }

  async search(customerId: string): Promise<void> {
    this.logger.info(`Searching customer ${customerId || '(blank)'}`);
    await this.searchInput.fill(customerId);
    await this.clickElement(this.searchButton);
    await this.page.waitForTimeout(2_500);
  }

  /**
   * The action the screen is offering, or null when it offers none.
   *
   * Null is a real answer — an unknown customer leaves the button hidden — and
   * is distinct from a blank label.
   */
  async availableAction(): Promise<'Activate' | 'Deactivate' | null> {
    if (!(await this.singleAction.isVisible().catch(() => false))) return null;
    const text = ((await this.singleAction.textContent()) ?? '').trim();
    if (/^deactivate$/i.test(text)) return 'Deactivate';
    if (/^activate$/i.test(text)) return 'Activate';
    return null;
  }

  /**
   * The customer's current status, inferred from the offered action.
   *
   * The screen shows what you may do next, not what is true now. A customer
   * offered "Deactivate" is Active.
   */
  async currentStatus(): Promise<'Active' | 'Inactive' | null> {
    const action = await this.availableAction();
    if (action === 'Deactivate') return 'Active';
    if (action === 'Activate') return 'Inactive';
    return null;
  }

  /**
   * Whatever the page is telling the user, from any of its surfaces.
   *
   * Includes the browser's own constraint-validation message. That one is
   * rendered by the browser chrome, not the document, so no DOM query finds it
   * — and concluding "the app says nothing" without checking it would report a
   * defect that is really native validation doing its job.
   */
  async messages(): Promise<string[]> {
    const texts = await this.page
      .locator('.modal.show, .toast:visible, .alert:visible, .invalid-feedback:visible, .text-danger:visible')
      .allTextContents();

    const native = await this.searchInput
      .evaluate((el: HTMLInputElement) => el.validationMessage || '')
      .catch(() => '');

    return [...texts, native]
      .map(t => t.replace(/\s+/g, ' ').trim())
      // The form marks empty required fields with a bare asterisk; those are
      // markers, not messages, and counting them as errors is how a blank-search
      // test passes for the wrong reason.
      .filter(t => t.length > 3 && /[a-z]/i.test(t));
  }

  /**
   * Clicks the offered action and confirms or cancels.
   *
   * Returns what the application said. The database decides whether the change
   * happened — an empty dialog has been read as success on other screens in this
   * application and produced a green test over an untouched record.
   */
  async act(decision: 'confirm' | 'cancel'): Promise<{ action: string; message: string }> {
    const action = (await this.availableAction()) ?? '(none offered)';
    await this.clickElement(this.singleAction);
    await this.page.waitForTimeout(1_500);

    const button = decision === 'confirm' ? this.confirmOk : this.confirmCancel;
    await expect(
      button,
      `The confirmation dialog did not appear after clicking ${action}.`
    ).toBeVisible({ timeout: 15_000 });
    await this.clickElement(button);
    await this.page.waitForTimeout(3_000);

    const message = (await this.messages()).join(' | ');
    await this.dismissAnyDialog();
    return { action, message };
  }

  /** Clears whatever modal is open so the next interaction is not swallowed. */
  async dismissAnyDialog(): Promise<void> {
    for (const control of [this.confirmOk, this.confirmClose]) {
      if (await control.isVisible().catch(() => false)) {
        await control.click({ timeout: 5_000 }).catch(() => undefined);
        await this.page.waitForTimeout(800);
      }
    }
    const generic = this.page.locator('.modal.show button.btn-close, .modal.show .btn-primary').first();
    if (await generic.isVisible().catch(() => false)) {
      await generic.click({ timeout: 5_000 }).catch(() => undefined);
      await this.page.waitForTimeout(500);
    }
  }

  /** Which of the two bulk radios is selected. */
  async selectedBulkAction(): Promise<'Activate' | 'Deactivate' | null> {
    if (await this.bulkActivate.isChecked().catch(() => false)) return 'Activate';
    if (await this.bulkDeactivate.isChecked().catch(() => false)) return 'Deactivate';
    return null;
  }

  async isVisible(locator: Locator): Promise<boolean> {
    return locator.isVisible().catch(() => false);
  }
}
