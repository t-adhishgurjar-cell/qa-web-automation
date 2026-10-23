import { Page } from '@playwright/test';
import { BasePage } from './base.page';

export class TermsPage extends BasePage {
  private readonly termsHeader = this.page.locator('text=/terms(?: and| &) conditions/i');
  private readonly acceptButton = this.page.getByRole('button', { name: /accept|agree|continue|submit|yes/i });

  constructor(page: Page) {
    super(page);
  }

  async isLoaded(timeout = 8000): Promise<boolean> {
    // isVisible() ignores its timeout, so this was answering from the DOM as it
    // stood rather than waiting the caller's budget out.
    return this.termsHeader
      .waitFor({ state: 'visible', timeout })
      .then(() => true)
      .catch(() => false);
  }

  async accept(): Promise<void> {
    await this.clickElement(this.acceptButton, { force: true });
    await this.waitForPageLoad();
  }
  /**
   * The post-login agreement screen (release 1.4.0): "Please read and agree to: <doc>",
   * "Document 1 of N", a checkbox and an "Accept & Continue" button that stays disabled
   * until the box is ticked. Shown to RO logins at least. Accepts every document in turn
   * and returns how many it accepted; 0 when the screen is not shown.
   */
  async acceptAllIfPresent(timeout = 5_000): Promise<number> {
    const agree = this.page.getByRole('checkbox', { name: /read and agree/i });
    const proceed = this.page.getByRole('button', { name: /accept\s*&\s*continue/i });
    let accepted = 0;
    // Whichever arrives first: the dashboard means there is nothing to accept, so a login
    // that has no agreement does not pay the timeout.
    await this.page.locator('#sidebarMenu').or(agree).first()
      .waitFor({ state: 'visible', timeout: 20_000 }).catch(() => undefined);
    if (!(await agree.isVisible().catch(() => false))) return 0;
    for (let doc = 0; doc < 10; doc++) {
      const shown = await agree.waitFor({ state: 'visible', timeout: doc === 0 ? timeout : 10_000 }).then(() => true).catch(() => false);
      if (!shown) break;
      // The box stays disabled until the document has been read: an IntersectionObserver
      // on #termsReadSentinel, below the PDF, unlocks it once it scrolls into view.
      for (let i = 0; i < 10 && (await agree.isDisabled().catch(() => false)); i++) {
        await this.page.locator('#termsReadSentinel').scrollIntoViewIfNeeded().catch(() => undefined);
        await this.page.mouse.wheel(0, 4000);
        await this.page.waitForTimeout(500);
      }
      const marker = await this.page.locator('text=/Document \\d+ of \\d+/').first().textContent().catch(() => '');
      await agree.check({ force: true });
      await proceed.click();
      accepted++;
      // Either the next document or the destination.
      await this.page.waitForFunction(
        (prev) => !document.body.innerText.includes(prev ?? '') || !!document.querySelector('#sidebarMenu'),
        marker, { timeout: 20_000 }
      ).catch(() => undefined);
    }
    return accepted;
  }
}

