import { Page } from '@playwright/test';
import { BasePage } from '../base.page';

/**
 * Review Customer — /Customer/ReviewCustomerDetails?ReferenceNo=…
 *
 * The stage between maker and checker, and the one no suite had ever opened.
 *
 * A DSA's onboarding form does not go straight to approval. It lands at status
 * 102, Pending for Review, and waits for a TSM of the same division — review is
 * hierarchical, and TSMDivisionMapping decides who can see what. Only once a
 * reviewer has passed it does it reach 105 and the checker's queue.
 *
 * That is why a form raised in the wrong division sits forever: it is not
 * rejected, it is simply invisible to every reviewer who might act on it.
 *
 * ── The screen ────────────────────────────────────────────────────────────
 * Laid out like the checker's, and it offers three outcomes rather than two:
 *
 *   Next                  advance through the tabs
 *   Reject                end the application
 *   Send for Correction   return it to the maker
 *
 * Only the first is used here. A suite that rejects or returns real
 * applications as a side effect of testing is a bad neighbour on a shared QA
 * environment.
 *
 * ── The acknowledgements ──────────────────────────────────────────────────
 * reviewerPanDocAck and reviewerBankDocAck are the reviewer confirming they
 * looked at the uploaded PAN and bank documents. They are the review's whole
 * substance — a reviewer who ticks neither has not reviewed anything — so they
 * are ticked explicitly rather than left to whatever the page defaults to.
 */
export class ReviewCustomerPage extends BasePage {
  readonly referenceNumber = this.page.locator('#CheckerApplicationReferenceNumber');
  readonly panAcknowledgement = this.page.locator('#reviewerPanDocAck');
  readonly bankAcknowledgement = this.page.locator('#reviewerBankDocAck');

  constructor(page: Page) {
    super(page);
  }

  async open(reference: string): Promise<void> {
    await this.navigateTo(`/Customer/ReviewCustomerDetails?ReferenceNo=${reference}`);
    await this.referenceNumber.waitFor({ state: 'visible', timeout: 30_000 });
  }

  /** Ticks both document acknowledgements, where the page offers them. */
  async acknowledgeDocuments(): Promise<void> {
    for (const box of [this.panAcknowledgement, this.bankAcknowledgement]) {
      if (!(await box.isVisible().catch(() => false))) continue;
      if (await box.isChecked().catch(() => false)) continue;
      await box.check({ timeout: 10_000 }).catch(async () => {
        // Checkboxes in this application are routinely visually hidden with a
        // styled label in front of them, so a direct check() can be refused on
        // an element the user clicks happily.
        const id = await box.getAttribute('id');
        if (id) await this.page.locator(`label[for="${id}"]`).click({ timeout: 5_000 }).catch(() => undefined);
      });
      await this.page.waitForTimeout(400);
    }
  }

  /**
   * Walks the review to its end and returns what the application said.
   *
   * The tabs are walked by clicking Next until it is gone, rather than a fixed
   * count: a Fleet application has more tabs than an OD one, and a blind walk
   * either stops early or times out on a page that has already finished.
   */
  async review(reference: string, maxSteps = 6): Promise<{ steps: number; message: string }> {
    await this.open(reference);

    let steps = 0;
    for (let i = 0; i < maxSteps; i += 1) {
      await this.acknowledgeDocuments();

      // :visible is not optional here. Every tab pane carries its own Next, and
      // the inactive ones stay in the DOM — so an unfiltered .first() resolves
      // to a hidden button from a tab that is not on screen, reports itself
      // invisible, and the walk stops after one step on a page that is plainly
      // still offering Next. This application does the same thing with its
      // wizard footer and its radio inputs.
      const next = this.page
        .locator('button:visible:has-text("Next"), input[type=button][value="Next"]:visible')
        .filter({ hasNotText: /previous/i })
        .first();

      if (!(await next.isVisible().catch(() => false))) break;

      await next.click({ timeout: 10_000 }).catch(() => undefined);
      await this.page.waitForTimeout(2_500);
      steps += 1;

      const said = await this.dismissDialog();
      if (said) return { steps, message: said };
    }

    // The last tab ends the walk, and its final control is not another Next.
    // It sits below the fold, so scroll before looking: an element outside the
    // viewport is still "visible" to Playwright but the page may not have
    // rendered it yet, and reading the button list without scrolling gives a
    // misleading picture of what this screen offers.
    await this.page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await this.page.waitForTimeout(1_200);

    const offered = await this.page.evaluate(() =>
      Array.from(document.querySelectorAll('button, input[type=submit], input[type=button]'))
        .filter(el => {
          const r = (el as HTMLElement).getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        })
        .map(el => `${(el as HTMLElement).id || '(no id)'}:"${(el.textContent || (el as HTMLInputElement).value || '').replace(/\s+/g, ' ').trim()}"`)
    );
    this.logger.info(`Final review step offers: ${offered.join(' | ')}`);

    // Deliberately excludes Reject and Send for Correction. Both are real
    // outcomes and neither belongs in a test that is proving the happy path —
    // rejecting or returning a live application as a side effect would be a
    // write this suite has no business making.
    const finish = this.page
      .locator(
        'button:visible, input[type=submit]:visible, input[type=button]:visible'
      )
      .filter({ hasText: /submit|approve|forward|confirm|complete|proceed/i })
      .filter({ hasNotText: /reject|correction|previous|cancel/i })
      .first();

    if (await finish.isVisible().catch(() => false)) {
      const label = ((await finish.textContent()) ?? '').replace(/\s+/g, ' ').trim();
      this.logger.info(`Completing the review with "${label}"`);
      await finish.click({ timeout: 10_000 }).catch(() => undefined);
      await this.page.waitForTimeout(3_000);
      return { steps, message: await this.dismissDialog() };
    }

    return {
      steps,
      message:
        (await this.dismissDialog()) ||
        `no completing control found on the final review step; it offered: ${offered.join(' | ')}`,
    };
  }

  /** Closes any modal and returns what it said. */
  async dismissDialog(): Promise<string> {
    const modal = this.page.locator('.modal.show').first();
    if (!(await modal.isVisible().catch(() => false))) return '';

    const said = ((await modal.textContent()) ?? '').replace(/\s+/g, ' ').trim();
    await modal
      .locator('button.btn-close, .btn-primary, button:has-text("OK")')
      .first()
      .click({ timeout: 5_000 })
      .catch(() => undefined);
    await this.page.waitForTimeout(1_000);
    return said;
  }
}
