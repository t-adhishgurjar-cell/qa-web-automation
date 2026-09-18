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
 * Four tabs — Basic Information, Address, Branch & Meeting, NFO Details — and
 * three outcomes rather than two:
 *
 *   Next                  advance through the tabs
 *   Reject                end the application
 *   Send for Correction   return it to the maker
 *
 * Only the first is used here. A suite that rejects or returns real
 * applications as a side effect of testing is a bad neighbour on a shared QA
 * environment.
 *
 * ── The last tab is not built like the other three ────────────────────────
 * Measured on reference 1000514858. The first three tabs carry <button>
 * controls; NFO Details carries <a> controls, and its completing control is
 * labelled "Reviewed":
 *
 *   Basic Information   button Next | Reject | Send for Correction
 *   Address             button Previous | Next | Reject | Send for Correction
 *   Branch & Meeting    button Previous | Next | Reject | Send for Correction
 *   NFO Details         a      Previous | REVIEWED | Reject | Send for Correction
 *
 * Both halves of that mattered. A button-only search finds nothing on the last
 * tab, and "Reviewed" is not a word any list of submit synonyms would contain,
 * so the walk reported "no completing control found" while looking straight at
 * it — and reported the page as offering only a sidebar pin and the avatar,
 * because those were the only two <button>s left on screen. Every locator here
 * now covers anchors as well as buttons.
 *
 * The control itself is declarative rather than a form submit:
 *
 *   <a id="btnApprove" data-action="ApproveCustomer" data-args="[105]" href="#">
 *
 * data-args carries the target status, which is a useful confirmation that
 * "Reviewed" is the hop to 105 and not something else.
 *
 * ── Remarks is mandatory, and says so quietly ─────────────────────────────
 * Clicking "Reviewed" with #Remarks empty produces no modal, no request and no
 * navigation — only an inline <span id="Remarks_error"> appearing beside the
 * field. The click looks like it did nothing at all, which cost a long detour
 * through 404s and delegated-handler theories before the field was found by
 * diffing what became visible after the click. Remarks is filled before
 * finishing, and any inline .error text is folded into the returned message so
 * a future validation rule reports itself instead of looking inert.
 *
 * ── The acknowledgements ──────────────────────────────────────────────────
 * reviewerPanDocAck and reviewerBankDocAck are the reviewer confirming they
 * looked at the uploaded PAN and bank documents. They are the review's whole
 * substance — a reviewer who ticks neither has not reviewed anything — so they
 * are ticked explicitly rather than left to whatever the page defaults to.
 */
/**
 * Wording the application uses when it refuses to advance. Matched so a
 * validation modal is never mistaken for the review completing.
 */
const VALIDATION_COMPLAINT = /failure|please confirm|is required|mandatory|kindly/i;

export class ReviewCustomerPage extends BasePage {
  readonly referenceNumber = this.page.locator('#CheckerApplicationReferenceNumber');
  readonly panAcknowledgement = this.page.locator('#reviewerPanDocAck');
  readonly bankAcknowledgement = this.page.locator('#reviewerBankDocAck');
  /** Mandatory. The reviewer's note, and the last thing that blocks "Reviewed". */
  readonly remarks = this.page.locator('#Remarks');

  constructor(page: Page) {
    super(page);
  }

  async open(reference: string): Promise<void> {
    await this.navigateTo(`/Customer/ReviewCustomerDetails?ReferenceNo=${reference}`);
    await this.referenceNumber.waitFor({ state: 'visible', timeout: 30_000 });
  }

  /**
   * Ticks both document acknowledgements, where the page offers them, and
   * confirms they took.
   *
   * Silence here is expensive. The server refuses Next with "Please confirm
   * that the PAN card document is uploaded." and the walk then stalls on the
   * first tab — a failure that surfaces three stages later as a status that
   * never moved, with nothing pointing back at an unticked box. So the result
   * is verified and returned rather than assumed.
   */
  async acknowledgeDocuments(): Promise<{ ticked: string[]; refused: string[] }> {
    const ticked: string[] = [];
    const refused: string[] = [];

    for (const box of [this.panAcknowledgement, this.bankAcknowledgement]) {
      const id = (await box.getAttribute('id').catch(() => null)) ?? 'unknown';
      if (!(await box.isVisible().catch(() => false))) continue;
      if (await box.isChecked().catch(() => false)) {
        ticked.push(id);
        continue;
      }

      await box.check({ timeout: 10_000 }).catch(async () => {
        // Checkboxes in this application are routinely visually hidden with a
        // styled label in front of them, so a direct check() can be refused on
        // an element the user clicks happily.
        await this.page.locator(`label[for="${id}"]`).click({ timeout: 5_000 }).catch(() => undefined);
      });
      await this.page.waitForTimeout(400);

      if (await box.isChecked().catch(() => false)) ticked.push(id);
      else refused.push(id);
    }

    if (refused.length) {
      this.logger.warn(`Acknowledgement(s) would not tick: ${refused.join(', ')}`);
    }
    return { ticked, refused };
  }

  /**
   * Walks the review to its end and returns what the application said.
   *
   * The tabs are walked by clicking Next until it is gone, rather than a fixed
   * count: a Fleet application has more tabs than an OD one, and a blind walk
   * either stops early or times out on a page that has already finished.
   */
  async review(
    reference: string,
    maxSteps = 6,
    remark = 'Reviewed by QA automation — documents verified.'
  ): Promise<{ steps: number; message: string }> {
    await this.open(reference);

    let steps = 0;
    let acknowledged: { ticked: string[]; refused: string[] } = { ticked: [], refused: [] };
    for (let i = 0; i < maxSteps; i += 1) {
      const result = await this.acknowledgeDocuments();
      if (result.ticked.length || result.refused.length) acknowledged = result;

      // :visible is not optional here. Every tab pane carries its own Next, and
      // the inactive ones stay in the DOM — so an unfiltered .first() resolves
      // to a hidden button from a tab that is not on screen, reports itself
      // invisible, and the walk stops after one step on a page that is plainly
      // still offering Next. This application does the same thing with its
      // wizard footer and its radio inputs.
      // Anchors included: the last tab renders its controls as <a>, so a
      // button-only search cannot tell "the walk has finished" from "the walk
      // is on a tab whose controls are a different element".
      const next = this.page
        .locator(
          'button:visible:has-text("Next"), input[type=button][value="Next"]:visible, ' +
            'a:visible:has-text("Next")'
        )
        .filter({ hasNotText: /previous/i })
        .first();

      if (!(await next.isVisible().catch(() => false))) break;

      await next.click({ timeout: 10_000 }).catch(() => undefined);
      await this.page.waitForTimeout(2_500);
      steps += 1;

      const said = await this.dismissDialog();
      if (said) {
        // A "Failure / Please confirm…" modal is the server refusing to
        // advance, not the review completing. Returning it as the outcome
        // message made a stalled walk read like a finished one, so it is
        // reported as the blocker it is.
        if (VALIDATION_COMPLAINT.test(said)) {
          throw new Error(
            `The review would not advance past step ${steps}: “${said}”\n\n` +
              `This is the server refusing Next, not a completed review. The ` +
              `usual cause is an unticked document acknowledgement — ` +
              `#reviewerPanDocAck / #reviewerBankDocAck — which acknowledgeDocuments() ` +
              `reported as ${JSON.stringify(acknowledged)}.`
          );
        }
        return { steps, message: said };
      }
    }

    // The last tab ends the walk, and its final control is not another Next.
    // It sits below the fold, so scroll before looking: an element outside the
    // viewport is still "visible" to Playwright but the page may not have
    // rendered it yet, and reading the button list without scrolling gives a
    // misleading picture of what this screen offers.
    await this.page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await this.page.waitForTimeout(1_200);

    const offered = await this.page.evaluate(() =>
      Array.from(
        document.querySelectorAll('button, input[type=submit], input[type=button], a[href], a[onclick], a.btn')
      )
        .filter(el => {
          const r = (el as HTMLElement).getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        })
        .map(
          el =>
            `<${el.tagName.toLowerCase()}>${(el as HTMLElement).id || '(no id)'}:` +
            `"${(el.textContent || (el as HTMLInputElement).value || '').replace(/\s+/g, ' ').trim()}"`
        )
    );
    this.logger.info(`Final review step offers: ${offered.join(' | ')}`);

    // Deliberately excludes Reject and Send for Correction. Both are real
    // outcomes and neither belongs in a test that is proving the happy path —
    // rejecting or returning a live application as a side effect would be a
    // write this suite has no business making.
    // "Reviewed" is the measured label on the NFO Details tab and belongs in
    // this list explicitly — no list of submit synonyms would have guessed it.
    const finish = this.page
      .locator(
        'button:visible, input[type=submit]:visible, input[type=button]:visible, a:visible'
      )
      .filter({ hasText: /reviewed|submit|approve|forward|confirm|complete|proceed/i })
      .filter({ hasNotText: /reject|correction|previous|cancel/i })
      .first();

    if (await finish.isVisible().catch(() => false)) {
      await this.enterRemarks(remark);

      const label = ((await finish.textContent()) ?? '').replace(/\s+/g, ' ').trim();
      this.logger.info(`Completing the review with "${label}"`);
      await finish.click({ timeout: 10_000 }).catch(() => undefined);
      await this.page.waitForTimeout(3_000);

      // Accept the confirmation first — it is a question, not a result.
      const confirmed = await this.acceptConfirmation();
      if (confirmed) {
        this.logger.info(`Confirmed: "${confirmed}"`);
        await this.page.waitForTimeout(3_000);
      }

      const said = await this.dismissDialog();
      if (said) return { steps, message: said };
      if (confirmed) return { steps, message: `confirmed: ${confirmed}` };

      // No modal is not the same as success here. Client-side validation
      // refuses in silence, so the inline complaints are read before reporting
      // an empty message that a caller would have to interpret as "worked".
      const complaints = await this.inlineErrors();
      return {
        steps,
        message: complaints.length
          ? `the page refused without a dialog: ${complaints.join('; ')}`
          : '',
      };
    }

    return {
      steps,
      message:
        (await this.dismissDialog()) ||
        `no completing control found on the final review step; it offered: ${offered.join(' | ')}`,
    };
  }

  /**
   * Fills the reviewer's remark, if the page asks for one.
   *
   * Left as a no-op when the field is absent so this stays safe on any variant
   * of the screen that does not have it.
   */
  async enterRemarks(remark: string): Promise<void> {
    if (!(await this.remarks.isVisible().catch(() => false))) return;
    const existing = ((await this.remarks.inputValue().catch(() => '')) ?? '').trim();
    if (existing) return;
    await this.remarks.fill(remark, { timeout: 10_000 }).catch(() => undefined);
    await this.page.waitForTimeout(300);
  }

  /**
   * Accepts a confirmation dialog, if one is open, and returns what it asked.
   *
   * Returns '' when the open dialog is not a confirmation — a notice with only
   * OK belongs to dismissDialog(), and treating the two alike is what cancelled
   * the review. Only affirmative controls are ever clicked.
   */
  async acceptConfirmation(): Promise<string> {
    const modal = this.page.locator('.modal.show').first();
    if (!(await modal.isVisible().catch(() => false))) return '';

    const asked = ((await modal.textContent()) ?? '').replace(/\s+/g, ' ').trim();

    const yes = modal
      .locator('button:visible, a:visible')
      .filter({ hasText: /^\s*(yes|confirm|proceed|agree|submit)\s*$/i })
      .filter({ hasNotText: /^\s*(no|cancel|close|reject)\s*$/i })
      .first();

    if (!(await yes.isVisible().catch(() => false))) return '';

    await yes.click({ timeout: 10_000 }).catch(() => undefined);
    await this.page.waitForTimeout(1_000);
    return asked;
  }

  /** Visible inline validation messages, which this screen prefers to dialogs. */
  async inlineErrors(): Promise<string[]> {
    return this.page.evaluate(() =>
      Array.from(document.querySelectorAll('.error, .field-validation-error, .text-danger'))
        .filter(el => {
          const r = (el as HTMLElement).getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        })
        .map(el => {
          const e = el as HTMLElement;
          const text = (e.textContent || '').replace(/\s+/g, ' ').trim();
          return text ? `${e.id || e.className}: ${text}` : `${e.id || e.className}: (shown, no text)`;
        })
        .filter(Boolean)
    );
  }

  /** Closes any modal and returns what it said. */
  async dismissDialog(): Promise<string> {
    const modal = this.page.locator('.modal.show').first();
    if (!(await modal.isVisible().catch(() => false))) return '';

    const said = ((await modal.textContent()) ?? '').replace(/\s+/g, ' ').trim();

    // Order is explicit rather than left to DOM order: an OK, then the ×.
    // The old comma-selector with .first() picked whichever came first in the
    // markup, which on a YES/NO dialog was the × — cancelling the very action
    // the caller had just taken.
    const ok = modal.locator('button:visible, a:visible').filter({ hasText: /^\s*(ok|okay|close|done)\s*$/i }).first();
    const target = (await ok.isVisible().catch(() => false))
      ? ok
      : modal.locator('button.btn-close:visible').first();

    await target.click({ timeout: 5_000 }).catch(() => undefined);
    await this.page.waitForTimeout(1_000);
    return said;
  }
}
