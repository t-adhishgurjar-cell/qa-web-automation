import { Locator, Page, expect, test } from '@playwright/test';
import { DbHelper } from '../../helpers/db.helper';

/**
 * Shared bits for the v3 customer lane (Customer Mgmt, User Mgmt, Security, Login).
 *
 * The lane's own customer is 9876500010 — a Customer Admin card (parent
 * NAYAFP1013400038) and a Branch Admin card (branch NAYAFP2013400039,
 * 01_GAUTAMBUDDHANAGAR) on one mobile, created for this lane. Everything this lane
 * writes as a customer lands on that customer and nowhere else.
 */
export const LANE_CUSTOMER = {
  mobile: '9876500010',
  parentId: 'NAYAFP1013400038',
  firstBranchId: 'NAYAFP2013400039',
  firstBranchLocation: '01_GAUTAMBUDDHANAGAR',
} as const;

/** Records what the application actually showed, for the report. */
export function observed(description: string): void {
  test.info().annotations.push({ type: 'observed', description });
}

/** Normalised visible text. */
export async function textOf(locator: Locator): Promise<string> {
  return ((await locator.innerText().catch(() => '')) || '').replace(/\s+/g, ' ').trim();
}

export type DialogKind = 'success' | 'failure' | 'error' | 'confirmation';

const DIALOGS: Record<DialogKind, { root: string; text: string }> = {
  success: { root: '#success-mess-popup', text: '#success-mess-text' },
  failure: { root: '#failer-mess-popup', text: '#failer-mess-text' },
  error: { root: '#error-mess-popup', text: '#error-mess-text' },
  confirmation: { root: '#confirmation-mess-popup', text: '#confirmation-mess-text' },
};

/**
 * The layout's four message dialogs. They are always in the DOM; only `.show`
 * means open, so nothing here waits on presence.
 */
export class Dialogs {
  constructor(private readonly page: Page) {}

  /** Waits for the first dialog of the given kinds to open; null when none does. */
  async next(timeout = 15_000, kinds: DialogKind[] = ['success', 'failure', 'error', 'confirmation']): Promise<{ kind: DialogKind; text: string } | null> {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      for (const kind of kinds) {
        if (await this.page.locator(`${DIALOGS[kind].root}.show`).count()) {
          await this.page.waitForTimeout(200);
          const text = await textOf(this.page.locator(DIALOGS[kind].text));
          return { kind, text };
        }
      }
      await this.page.waitForTimeout(200);
    }
    return null;
  }

  /** Any open modal's text (for screens with their own modals). */
  async anyOpenText(): Promise<string> {
    return (await this.page.locator('.modal.show').allInnerTexts()).join(' | ').replace(/\s+/g, ' ').trim();
  }

  /** Closes message dialogs (OK / Cancel / X), leaving the page usable. */
  async dismissAll(): Promise<void> {
    for (let i = 0; i < 3; i++) {
      const open = this.page.locator('.modal.show');
      if (!(await open.count())) return;
      const button = open.last().locator(
        'button[data-bs-dismiss="modal"]:visible, #confirmation-cancel-btn:visible, .btn-close:visible',
      ).last();
      await button.click({ timeout: 5_000 }).catch(() => undefined);
      await this.page.waitForTimeout(400);
    }
  }
}

/** Polls a DB read until `ok` holds or the timeout passes; returns the last value. */
export async function pollDb<T>(read: () => Promise<T>, ok: (v: T) => boolean, timeout = 20_000): Promise<T> {
  const deadline = Date.now() + timeout;
  let last = await read();
  while (!ok(last) && Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 1_000));
    last = await read();
  }
  return last;
}

/** The branches of a parent customer, from CustomerMaster. */
export async function branchesOfParent(parentCustomerId: string): Promise<Array<{ CustomerId: string; BranchLocation: string; Status: number; MobileNo: string; BranchManagerName: string | null }>> {
  return DbHelper.query(
    `SELECT b.CustomerId, ISNULL(b.BranchLocation, '') AS BranchLocation, b.Status, ISNULL(b.MobileNo, '') AS MobileNo, b.BranchManagerName
       FROM dbo.CustomerMaster b JOIN dbo.CustomerMaster p ON b.ParentId = p.Id
      WHERE p.CustomerId = @id ORDER BY b.Id`,
    { id: parentCustomerId },
  );
}

/** The page is a real screen, not the app's HTTP-200 "Unauthorized Access" page or the login. */
export async function assertServed(page: Page, what: string): Promise<void> {
  await expect(page, `${what}: landed on the login page`).not.toHaveURL(/\/Home\/Login|\/$/i);
  await expect(page, `${what}: the app answered with Unauthorized Access`).not.toHaveTitle(/Unauthori[sz]ed/i);
}

/** True when the app refused the route (Unauthorized page, redirect to dashboard/login, or a denial message). */
export async function isRefused(page: Page): Promise<{ refused: boolean; how: string }> {
  const title = await page.title();
  const url = page.url();
  const body = (await page.locator('body').innerText().catch(() => '')).slice(0, 4000);
  if (/unauthori[sz]ed/i.test(title)) return { refused: true, how: `title "${title}"` };
  if (/access denied|not authori[sz]ed|unauthori[sz]ed access|do not have (the )?permission/i.test(body)) return { refused: true, how: 'denial message on page' };
  if (/Home\/Login|Dashboard\/Index|NayaraDashboard/i.test(url)) return { refused: true, how: `redirected to ${url}` };
  return { refused: false, how: `served "${title}" at ${url}` };
}
