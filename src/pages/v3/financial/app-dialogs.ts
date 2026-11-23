import { Locator, Page } from '@playwright/test';

/**
 * The four application-wide message dialogs every FleetPlus screen shares.
 *
 * They live permanently in the layout (#success-mess-popup, #failer-mess-popup,
 * #error-mess-popup, #confirmation-mess-popup) and are opened by the page scripts'
 * showSuccessModal / showFailureModal / showErrorModal / showConfirmationModal. Only
 * `.show` means a dialog is open — the markup is always in the DOM — so every wait
 * here is on `.modal.show`, never on presence.
 */
export type DialogKind = 'success' | 'failure' | 'error' | 'confirmation';

export interface DialogShown {
  kind: DialogKind;
  text: string;
}

const IDS: Record<DialogKind, { root: string; text: string; ok: string }> = {
  success: { root: '#success-mess-popup', text: '#success-mess-text', ok: '#success-mess-popup button[data-bs-dismiss="modal"]' },
  failure: { root: '#failer-mess-popup', text: '#failer-mess-text', ok: '#failer-mess-popup button[data-bs-dismiss="modal"]' },
  error: { root: '#error-mess-popup', text: '#error-mess-text', ok: '#error-mess-popup button[data-bs-dismiss="modal"]' },
  confirmation: { root: '#confirmation-mess-popup', text: '#confirmation-mess-text', ok: '#confirmation-ok-btn' },
};

export class AppDialogs {
  constructor(private readonly page: Page) {}

  open(kind: DialogKind): Locator {
    return this.page.locator(`${IDS[kind].root}.show`);
  }

  text(kind: DialogKind): Locator {
    return this.page.locator(IDS[kind].text);
  }

  get confirmYes(): Locator {
    return this.page.locator('#confirmation-ok-btn');
  }

  get confirmNo(): Locator {
    return this.page.locator('#confirmation-cancel-btn');
  }

  /**
   * Waits for whichever dialog opens first and says which one it was.
   * Returns null when none opens within the timeout — callers decide whether
   * that is a failure, because "nothing happened" is sometimes the finding.
   */
  async next(timeout = 15_000, kinds: DialogKind[] = ['success', 'failure', 'error', 'confirmation']): Promise<DialogShown | null> {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      for (const kind of kinds) {
        if (await this.open(kind).count()) {
          // The text is written just before .show is added; give it a beat to settle.
          await this.page.waitForTimeout(150);
          const text = ((await this.text(kind).innerText().catch(() => '')) || '').replace(/\s+/g, ' ').trim();
          return { kind, text };
        }
      }
      await this.page.waitForTimeout(200);
    }
    return null;
  }

  /** Closes whatever message dialog is open (OK / Cancel), leaving the page usable. */
  async dismissAll(): Promise<void> {
    for (const kind of ['success', 'failure', 'error'] as DialogKind[]) {
      if (await this.open(kind).count()) {
        await this.page.locator(IDS[kind].ok).last().click().catch(() => undefined);
        await this.open(kind).waitFor({ state: 'detached', timeout: 5_000 }).catch(() => undefined);
      }
    }
    if (await this.open('confirmation').count()) {
      await this.confirmNo.click().catch(() => undefined);
      await this.open('confirmation').waitFor({ state: 'detached', timeout: 5_000 }).catch(() => undefined);
    }
  }
}
