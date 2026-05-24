import { Page } from '@playwright/test';
import { BasePage } from './base.page';

export class TermsPage extends BasePage {
  private readonly termsHeader = this.page.locator('text=/terms(?: and| &) conditions/i');
  private readonly acceptButton = this.page.getByRole('button', { name: /accept|agree|continue|submit|yes/i });

  constructor(page: Page) {
    super(page);
  }

  async isLoaded(timeout = 8000): Promise<boolean> {
    return this.termsHeader.isVisible({ timeout }).catch(() => false);
  }

  async accept(): Promise<void> {
    await this.clickElement(this.acceptButton, { force: true });
    await this.waitForPageLoad();
  }
}
