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

  async fillInput(locator: Locator, value: string): Promise<void> {
    this.logger.info(`Filling input with value: ${value}`);
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
