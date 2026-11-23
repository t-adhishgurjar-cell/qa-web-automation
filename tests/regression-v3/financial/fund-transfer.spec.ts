import type { Page, Route } from '@playwright/test';
import { test, expect } from '../../../src/fixtures/session.fixtures';
import { LANES } from '../../../src/config/test-accounts';
import { caseTitle, notExecutable } from '../../../src/helpers/v3-sheet.helper';
import { DbHelper } from '../../../src/helpers/db.helper';
import { FundTransferPage } from '../../../src/pages/v3/financial/fund-transfer.page';
import { FUNDED, FOREIGN_CUSTOMER, walletBalance, waitForBalance, round2, transactionOtp } from '../../../src/pages/v3/financial/finance-data';
import { attachOnFailure, observed, deviation } from '../../../src/pages/v3/financial/evidence';
import { openFromSidebar } from '../../../src/pages/v3/financial/sidebar';

/**
 * Wallet Transfer ("Fund Transfer") — v3 sheet W-0053..W-0068 and F-132..F-141.
 *
 * Runs as the funded customer's Customer Admin. Money moved per run, all inside
 * NAYAFP1020900195's own family and all reversed:
 *   ₹1.50 parent → NAYAFP2107000202 (a zero-balance branch), then the branch's exact
 *   balance (₹1.50) back to the parent.
 * The two tamper cases (W-0066, W-0067) rewrite the ExecuteFundTransfer request in flight
 * and expect the server to refuse it; the ledgers are read before and after to prove
 * nothing moved.
 */

const OD_LOGIN_REFUSED = 'The lane\'s OD account (9999301778) is refused at sign-in with "Invalid username or password." for the configured password; the suite stops using it to avoid a lockout, so no OD session is available.';

const SCRATCH = FUNDED.scratchBranch;
const RICH_BRANCH = FUNDED.outstandingBranch;
const DECIMAL_AMOUNT = 1.5;

let caPage: Page | undefined;
test.afterEach(async ({}, testInfo) => attachOnFailure(testInfo, [caPage]));

async function openTransfer(sessionFor: (a: typeof LANES.financial.customerAdmin) => Promise<Page>): Promise<FundTransferPage> {
  caPage = await sessionFor(LANES.financial.customerAdmin);
  const ft = new FundTransferPage(caPage);
  await ft.open();
  return ft;
}

async function maxTxnId(): Promise<number> {
  const rows = await DbHelper.query<{ M: number | null }>(`SELECT MAX(CAST(Id AS BIGINT)) AS M FROM dbo.TransactionsDetail`);
  return Number(rows[0]?.M ?? 0);
}

async function txnsSince(id: number, customers: string[]): Promise<Array<{ CustomerId: string; TransAmount: number; EntryType: string; PreviousBalance: number; AfterBalance: number }>> {
  return DbHelper.query(
    `SELECT CustomerId, TransAmount, EntryType, PreviousBalance, AfterBalance FROM dbo.TransactionsDetail
      WHERE CAST(Id AS BIGINT) > @id AND CustomerId IN (${customers.map((_, i) => `@c${i}`).join(',')}) ORDER BY Id`,
    Object.fromEntries([['id', id], ...customers.map((c, i) => [`c${i}`, c])])
  );
}

test.describe('v3 Financial — Wallet Transfer (Fund Transfer)', () => {
  test.describe.configure({ timeout: 180_000 });

  test(caseTitle(['W-0059', 'F-135'], 'page load for a Customer Admin shows the prefilled customer, branch filter, balance, Search and the grid columns'), async ({ sessionFor }) => {
    caPage = await sessionFor(LANES.financial.customerAdmin);
    await openFromSidebar(caPage, 'Wallet Management', FundTransferPage.route);
    const ft = new FundTransferPage(caPage);
    await ft.rows.first().waitFor({ timeout: 45_000 });
    expect(caPage.url(), 'URL').toContain('/Financial/FundTransfer');
    const title = (await ft.title.innerText()).trim();
    const crumbs = (await ft.breadcrumb.innerText()).replace(/\s+/g, ' ').trim();
    observed(`title "${title}", breadcrumb "${crumbs}"`);
    if (!/Fund Transfer/i.test(title)) deviation(`Sheet names the page "Fund Transfer" under "Customer"; 1.4.0 titles it "${title}" under "${crumbs}" (menu: Wallet Management > Wallet Transfer).`);
    expect(title, 'page title').toMatch(/Fund Transfer|Wallet Transfer/i);
    await expect(ft.customerId, 'Customer ID prefilled').toHaveValue(FUNDED.parentId);
    await expect(ft.branchFilter.locator('option').first(), 'Branch Office UID defaults to All branch wallets').toHaveText(/All branch wallets/i);
    await expect(ft.parentBalance, 'Available Wallet Balance shown').toHaveText(/₹\s*[\d,]+/);
    await expect(ft.searchButton, 'Search button').toBeVisible();
    const headers = (await ft.grid.locator('thead th').allInnerTexts()).map(h => h.trim());
    observed(`grid columns: ${headers.join(' | ')}`);
    expect(headers, 'list columns').toEqual(['Branch Location', 'Branch Office UID', 'Branch Manager', 'Balance', 'Transfer To', 'Amount', 'Transfer']);
    const ledger = await walletBalance(FUNDED.parentId);
    expect(await ft.parentBalanceShown(), 'the balance shown is the ledger balance').toBeCloseTo(ledger, 2);
  });

  notExecutable(['W-0060', 'F-136'], 'page load for an OD customer shows No Branch Offices Found', OD_LOGIN_REFUSED);

  test(caseTitle(['W-0063', 'F-139'], 'Transfer To offers exactly Select, Branch→Parent and Parent→Branch'), async ({ sessionFor }) => {
    const ft = await openTransfer(sessionFor);
    await ft.search('');
    const options = (await ft.direction(RICH_BRANCH).locator('option').allInnerTexts()).map(o => o.trim());
    observed(`options: ${JSON.stringify(options)}`);
    expect(options, 'exactly three options').toHaveLength(3);
    expect(options[0], 'Select (default)').toBe('Select');
    expect(options[1], 'Branch wallet → Parent wallet').toMatch(/^Branch wallet\s*(->|→)\s*(Parent|Customer) wallet$/);
    expect(options[2], 'Parent wallet → Branch wallet').toMatch(/^(Parent|Customer) wallet\s*(->|→)\s*Branch wallet$/);
    if (options.some(o => /Customer wallet/.test(o))) deviation('The parent wallet is labelled "Customer wallet" in 1.4.0; the sheet says "Parent wallet".');
    await expect(ft.direction(RICH_BRANCH), 'Select is the default').toHaveValue('');
  });

  test(caseTitle(['W-0064', 'F-140'], 'Search by Branch Office UID shows only that branch'), async ({ sessionFor }) => {
    const ft = await openTransfer(sessionFor);
    const target = 'NAYAFP2107000159';
    await ft.search(target);
    await expect(ft.rows, 'only one record').toHaveCount(1);
    await expect(ft.rows.first(), 'the record is the searched branch').toHaveAttribute('data-branch-uid', target);
    const info = (await caPage!.locator('#txnTable_info').innerText().catch(() => '')).trim();
    observed(`grid info: "${info}"`);
    expect(info, 'Showing 1 record').toMatch(/1 to 1 of 1/);
  });

  test(caseTitle(['W-0056'], 'amount zero is refused with a minimum-amount validation'), async ({ sessionFor }) => {
    const ft = await openTransfer(sessionFor);
    const before = await walletBalance(FUNDED.parentId);
    await ft.enter(RICH_BRANCH, 'debit', '0');
    const msg = (await ft.feedback(RICH_BRANCH).innerText()).trim();
    observed(`feedback "${msg}"`);
    await expect(ft.transferButton(RICH_BRANCH), 'Transfer NOT possible').toBeDisabled();
    expect(await walletBalance(FUNDED.parentId), 'nothing moved').toBeCloseTo(before, 2);
    expect(msg, 'validation: "Amount must be at least ₹1.00" — the screen enforces ₹0.01 instead').toMatch(/Amount must be at least ₹\s*1\.00/);
  });

  test(caseTitle(['W-0057'], 'a negative amount is rejected by the field'), async ({ sessionFor }) => {
    const ft = await openTransfer(sessionFor);
    const kept = await ft.enter(RICH_BRANCH, 'debit', '-500');
    observed(`typed "-500", field holds "${kept}"`);
    expect(kept, 'the field rejects the minus sign').not.toContain('-');
    expect(Number(kept.replace(/,/g, '') || 0), 'no negative value is held').toBeGreaterThanOrEqual(0);
  });

  test(caseTitle(['W-0058'], 'alphabets are rejected; only numeric input is accepted'), async ({ sessionFor }) => {
    const ft = await openTransfer(sessionFor);
    const kept = await ft.enter(RICH_BRANCH, 'debit', 'ABC');
    observed(`typed "ABC", field holds "${kept}"`);
    expect(kept, 'no letters held').not.toMatch(/[A-Za-z]/);
    await expect(ft.transferButton(RICH_BRANCH), 'nothing to transfer').toBeDisabled();
  });

  test(caseTitle(['W-0054', 'F-133'], 'an amount above the parent balance is refused as insufficient and nothing moves'), async ({ sessionFor }) => {
    const ft = await openTransfer(sessionFor);
    const before = await walletBalance(FUNDED.parentId);
    const branchBefore = await walletBalance(SCRATCH);
    await ft.enter(SCRATCH, 'debit', String(Math.ceil(before) + 1000));
    const msg = (await ft.feedback(SCRATCH).innerText()).trim();
    observed(`parent ₹${before}; feedback "${msg}"`);
    expect(msg, 'Error: Insufficient funds').toMatch(/Insufficient funds/i);
    await expect(ft.transferButton(SCRATCH), 'transfer not processable').toBeDisabled();
    expect(await walletBalance(FUNDED.parentId), 'parent balance unchanged').toBeCloseTo(before, 2);
    expect(await walletBalance(SCRATCH), 'branch balance unchanged').toBeCloseTo(branchBefore, 2);
  });

  test(caseTitle(['W-0055', 'F-134'], 'an amount above the branch balance (branch → parent) is refused as insufficient'), async ({ sessionFor }) => {
    const ft = await openTransfer(sessionFor);
    const branchBefore = await walletBalance(RICH_BRANCH);
    await ft.enter(RICH_BRANCH, 'credit', String(Math.ceil(branchBefore) + 1000));
    const msg = (await ft.feedback(RICH_BRANCH).innerText()).trim();
    observed(`branch ₹${branchBefore}; feedback "${msg}"`);
    expect(msg, 'Error: Insufficient funds').toMatch(/Insufficient funds/i);
    await expect(ft.transferButton(RICH_BRANCH), 'transfer not processable').toBeDisabled();
    expect(await walletBalance(RICH_BRANCH), 'branch balance unchanged').toBeCloseTo(branchBefore, 2);
  });

  test(caseTitle(['W-0061', 'F-137', 'W-0065', 'F-141', 'W-0068'], 'parent → branch ₹1.50 succeeds, a decimal is transferred as entered, both ledgers and the transaction log agree'), async ({ sessionFor }) => {
    const ft = await openTransfer(sessionFor);
    await ft.search('');
    const parentBefore = await walletBalance(FUNDED.parentId);
    const branchBefore = await walletBalance(SCRATCH);
    const txnBase = await maxTxnId();
    const kept = await ft.enter(SCRATCH, 'debit', String(DECIMAL_AMOUNT));
    observed(`decimal typed "${DECIMAL_AMOUNT}", field holds "${kept}"; feedback "${(await ft.feedback(SCRATCH).innerText()).trim()}"`);
    await expect(ft.transferButton(SCRATCH), 'W-0065: a decimal amount is accepted for transfer').toBeEnabled();

    const otp = await transactionOtp(FUNDED.mobile);
    const res = await ft.transferWithOtp(SCRATCH, otp);
    observed(`ExecuteFundTransfer ${res.status}: ${res.body.slice(0, 300)}`);
    const shown = await ft.dialogs.next(20_000);
    observed(`dialog ${JSON.stringify(shown)}`);
    await ft.dialogs.dismissAll();
    expect(shown?.kind, 'W-0061: success message displayed').toBe('success');
    expect(shown?.text, 'W-0061: the message names the transfer').toMatch(/Successfully transferred/i);

    const parentAfter = await waitForBalance(FUNDED.parentId, round2(parentBefore - DECIMAL_AMOUNT));
    const branchAfter = await waitForBalance(SCRATCH, round2(branchBefore + DECIMAL_AMOUNT));
    test.info().annotations.push({ type: 'money', description: `₹${DECIMAL_AMOUNT} ${FUNDED.parentId} ${parentBefore}->${parentAfter}, ${SCRATCH} ${branchBefore}->${branchAfter}` });
    expect(parentAfter, 'W-0068: parent decreased by exactly the amount (decimal not rounded — Option A)').toBeCloseTo(round2(parentBefore - DECIMAL_AMOUNT), 2);
    expect(branchAfter, 'W-0068: branch increased by exactly the amount').toBeCloseTo(round2(branchBefore + DECIMAL_AMOUNT), 2);
    expect(round2(parentAfter + branchAfter), 'W-0068: total preserved').toBeCloseTo(round2(parentBefore + branchBefore), 2);

    const log = await txnsSince(txnBase, [FUNDED.parentId, SCRATCH]);
    observed(`TransactionsDetail rows: ${JSON.stringify(log)}`);
    expect(log.some(t => t.CustomerId === FUNDED.parentId && t.EntryType === 'D' && Math.abs(t.TransAmount - DECIMAL_AMOUNT) < 0.001), 'W-0061: debit logged on the parent').toBe(true);
    expect(log.some(t => t.CustomerId === SCRATCH && t.EntryType === 'C' && Math.abs(t.TransAmount - DECIMAL_AMOUNT) < 0.001), 'W-0061: credit logged on the branch').toBe(true);
  });

  test(caseTitle(['W-0062', 'F-138', 'W-0053', 'F-132'], 'branch → parent of the exact branch balance succeeds; the exact parent balance is accepted'), async ({ sessionFor }) => {
    const ft = await openTransfer(sessionFor);
    await ft.search('');
    const parentBefore = await walletBalance(FUNDED.parentId);
    const branchBefore = await walletBalance(SCRATCH);
    test.skip(branchBefore <= 0, `the scratch branch ${SCRATCH} holds nothing to send back — the parent → branch case did not complete`);

    // Boundary on the parent side, validated but not executed: moving the funded
    // customer's entire balance (~₹8.4 lakh) is outside the lane's ₹1–₹10 data rule.
    await ft.enter(RICH_BRANCH, 'debit', String(parentBefore));
    const parentExactMsg = (await ft.feedback(RICH_BRANCH).innerText()).trim();
    observed(`exact parent balance ₹${parentBefore} → feedback "${parentExactMsg}", Transfer ${await ft.transferButton(RICH_BRANCH).isEnabled() ? 'enabled' : 'disabled'}`);
    await expect(ft.transferButton(RICH_BRANCH), 'W-0053: the exact parent balance is a valid amount').toBeEnabled();
    await ft.enter(RICH_BRANCH, '', '');
    deviation('W-0053 executed on the branch wallet (its exact balance, ₹1.50) and only validated on the parent wallet, to keep money moved within ₹1–₹10.');

    await ft.enter(SCRATCH, 'credit', String(branchBefore));
    await expect(ft.transferButton(SCRATCH), 'exact branch balance accepted').toBeEnabled();
    const otp = await transactionOtp(FUNDED.mobile);
    const res = await ft.transferWithOtp(SCRATCH, otp);
    observed(`ExecuteFundTransfer ${res.status}: ${res.body.slice(0, 300)}`);
    const shown = await ft.dialogs.next(20_000);
    observed(`dialog ${JSON.stringify(shown)}`);
    await ft.dialogs.dismissAll();
    expect(shown?.kind, 'W-0062: success message displayed').toBe('success');

    const parentAfter = await waitForBalance(FUNDED.parentId, round2(parentBefore + branchBefore));
    const branchAfter = await waitForBalance(SCRATCH, 0);
    test.info().annotations.push({ type: 'money', description: `₹${branchBefore} ${SCRATCH} -> ${FUNDED.parentId}: parent ${parentBefore}->${parentAfter}, branch ${branchBefore}->${branchAfter}` });
    expect(branchAfter, 'W-0053: the branch wallet is emptied exactly').toBeCloseTo(0, 2);
    expect(parentAfter, 'W-0062: parent credited by the amount').toBeCloseTo(round2(parentBefore + branchBefore), 2);
  });

  test(caseTitle(['W-0066'], 'an amount altered after entry (DOM / request tampering) is refused by the server'), async ({ sessionFor }) => {
    const ft = await openTransfer(sessionFor);
    await ft.search('');
    const parentBefore = await walletBalance(FUNDED.parentId);
    const branchBefore = await walletBalance(SCRATCH);
    const forged = Math.ceil(parentBefore) + 100_000;
    let sent = '';
    await caPage!.route(`**${FundTransferPage.executeUrl}`, async (route: Route) => {
      const body = JSON.parse(route.request().postData() || '{}');
      body.Amount = forged;
      sent = JSON.stringify(body);
      await route.continue({ postData: sent });
    });
    try {
      // The DevTools edit of the sheet. Rewriting the input itself is caught by the page
      // script (Transfer re-validates the box against the balance and does nothing), so the
      // edit is applied where it would matter: to the request the page sends after OTP.
      await ft.enter(SCRATCH, 'debit', '1');
      const res = await ft.transferWithOtp(SCRATCH, await transactionOtp(FUNDED.mobile));
      const shown = await ft.dialogs.next(20_000);
      observed(`sent ${sent}; server ${res.status} ${res.body.slice(0, 300)}; dialog ${JSON.stringify(shown)}`);
      await ft.dialogs.dismissAll();
      expect(shown?.kind, 'the server must refuse the forged amount').not.toBe('success');
      expect(await walletBalance(FUNDED.parentId), 'DB: parent balance NOT decreased').toBeCloseTo(parentBefore, 2);
      expect(await walletBalance(SCRATCH), 'DB: branch balance unchanged').toBeCloseTo(branchBefore, 2);
      expect(`${shown?.text ?? ''}`, 'the refusal must read "Insufficient balance" — the server refuses, but says the transfer failed "due to a balance update"').toMatch(/insufficient/i);
    } finally {
      await caPage!.unroute(`**${FundTransferPage.executeUrl}`);
    }
  });

  test(caseTitle(['W-0067'], 'a Customer ID altered to another customer is refused; the other customer is untouched'), async ({ sessionFor }) => {
    const ft = await openTransfer(sessionFor);
    await ft.search('');
    const ours = await walletBalance(FUNDED.parentId);
    const branchBefore = await walletBalance(RICH_BRANCH);
    const theirs = await walletBalance(FOREIGN_CUSTOMER);
    let sent = '';
    await caPage!.route(`**${FundTransferPage.executeUrl}`, async (route: Route) => {
      const body = JSON.parse(route.request().postData() || '{}');
      body.ParentCustomerId = FOREIGN_CUSTOMER;
      sent = JSON.stringify(body);
      await route.continue({ postData: sent });
    });
    try {
      await ft.customerId.evaluate((el, v) => { (el as HTMLInputElement).removeAttribute('disabled'); (el as HTMLInputElement).value = v; }, FOREIGN_CUSTOMER);
      await ft.enter(RICH_BRANCH, 'credit', '1');
      const res = await ft.transferWithOtp(RICH_BRANCH, await transactionOtp(FUNDED.mobile));
      const shown = await ft.dialogs.next(20_000);
      observed(`sent ${sent}; server ${res.status} ${res.body.slice(0, 300)}; dialog ${JSON.stringify(shown)}`);
      await ft.dialogs.dismissAll();
      expect(shown?.kind, 'the server must reject the modified Customer ID').not.toBe('success');
    } finally {
      await caPage!.unroute(`**${FundTransferPage.executeUrl}`);
    }
    expect(await walletBalance(FOREIGN_CUSTOMER), 'other customer balance NOT affected').toBeCloseTo(theirs, 2);
    expect(await walletBalance(RICH_BRANCH), 'our branch not debited').toBeCloseTo(branchBefore, 2);
    expect(await walletBalance(FUNDED.parentId), 'our parent unchanged').toBeCloseTo(ours, 2);
  });
});
