import { Page, Locator, expect } from '@playwright/test';
import { Logger } from '../helpers/logger.helper';

export abstract class BasePage {
  protected readonly page: Page;
  protected readonly logger: Logger;

  constructor(page: Page) {
    this.page = page;
    this.logger = new Logger(this.constructor.name);
  }

  // ─── Navigation ───────────────────────────────────────────────────────────
  async navigateTo(path: string = ''): Promise<void> {
    this.logger.info(`Navigating to: ${path}`);
    await this.page.goto(path, { waitUntil: 'domcontentloaded' });
    await this.waitForPageLoad();
  }

  async waitForPageLoad(): Promise<void> {
    await this.page.waitForLoadState('domcontentloaded');
  }

  async getPageTitle(): Promise<string> {
    return this.page.title();
  }

  async getCurrentUrl(): Promise<string> {
    return this.page.url();
  }

  // ─── Element Actions ──────────────────────────────────────────────────────
  async clickElement(locator: Locator, options?: { force?: boolean }): Promise<void> {
    this.logger.info(`Clicking element: ${locator}`);
    await locator.waitFor({ state: 'visible' });
    await locator.click(options);
  }

  /**
   * Values never written to the log, whatever field they land in.
   *
   * Everything this framework knows that is worth hiding. Matching on the value
   * rather than on the field is deliberate: a password typed into a
   * confirmation box, a re-entry check or a search field is the same secret,
   * and field-based masking misses all three.
   */
  private static secrets(): string[] {
    return [
      process.env.TEST_PASSWORD,
      process.env.FP_ADMIN_PASS,
      process.env.CUSTOMER_ADMIN_PASS,
      process.env.PARENT_ADMIN_PASS,
      process.env.DB_PASSWORD,
      process.env.OFFICE_API_KEY,
      process.env.RO_API_KEY,
    ].filter((v): v is string => !!v && v.length > 3);
  }

  /** Replaces any known secret with a marker, leaving everything else legible. */
  protected redact(value: string): string {
    let out = value;
    for (const secret of BasePage.secrets()) {
      if (out.includes(secret)) out = out.split(secret).join('********');
    }
    return out;
  }

  /**
   * Fills an input, logging the value with any known secret masked.
   *
   * The log used to carry the password verbatim — "Filling input with value:
   * <the real password>" — into every run log and every Allure attachment. The
   * value is still logged because seeing what was typed is most of this log's
   * usefulness; it is the secrets that are removed, not the visibility.
   */
  async fillInput(locator: Locator, value: string): Promise<void> {
    this.logger.info(`Filling input with value: ${this.redact(value)}`);
    await locator.waitFor({ state: 'visible' });
    await locator.clear();
    await locator.fill(value);
  }

  async selectOption(locator: Locator, value: string): Promise<void> {
    this.logger.info(`Selecting option: ${value}`);
    await locator.selectOption(value);
  }

  async getElementText(locator: Locator): Promise<string> {
    await locator.waitFor({ state: 'visible' });
    return (await locator.textContent()) ?? '';
  }

  async isElementVisible(locator: Locator): Promise<boolean> {
    return locator.isVisible();
  }

  async isElementEnabled(locator: Locator): Promise<boolean> {
    return locator.isEnabled();
  }

  async hoverOver(locator: Locator): Promise<void> {
    await locator.hover();
  }

  async scrollIntoView(locator: Locator): Promise<void> {
    await locator.scrollIntoViewIfNeeded();
  }

  // ─── Wait Utilities ───────────────────────────────────────────────────────
  async waitForElement(locator: Locator, timeout = 30_000): Promise<void> {
    await locator.waitFor({ state: 'visible', timeout });
  }

  async waitForURL(url: string | RegExp): Promise<void> {
    await this.page.waitForURL(url);
  }

  async waitForMs(ms: number): Promise<void> {
    await this.page.waitForTimeout(ms);
  }

  // ─── Assertions ───────────────────────────────────────────────────────────
  async assertElementVisible(locator: Locator, message?: string): Promise<void> {
    await expect(locator, message).toBeVisible();
  }

  async assertElementText(locator: Locator, expectedText: string): Promise<void> {
    await expect(locator).toHaveText(expectedText);
  }

  async assertPageTitle(expectedTitle: string): Promise<void> {
    await expect(this.page).toHaveTitle(expectedTitle);
  }

  async assertURL(expectedUrl: string | RegExp): Promise<void> {
    await expect(this.page).toHaveURL(expectedUrl);
  }

  async assertElementCount(locator: Locator, count: number): Promise<void> {
    await expect(locator).toHaveCount(count);
  }

  // ─── Screenshot ───────────────────────────────────────────────────────────
  async takeScreenshot(name: string): Promise<void> {
    await this.page.screenshot({
      path: `test-results/screenshots/${name}-${Date.now()}.png`,
      fullPage: true,
    });
  }
}
