import type { Page, Request } from '@playwright/test';
import { test, expect } from '../../../src/fixtures/session.fixtures';
import { LANES } from '../../../src/config/test-accounts';
import { caseTitle } from '../../../src/helpers/v3-sheet.helper';
import { DbHelper } from '../../../src/helpers/db.helper';
import { WalletRechargePage } from '../../../src/pages/v3/financial/wallet-recharge.page';
import { PgCheckoutPage } from '../../../src/pages/v3/financial/pg-checkout.page';
import { FUNDED, walletBalance, waitForBalance, round2 } from '../../../src/pages/v3/financial/finance-data';
import { attachOnFailure, observed, deviation } from '../../../src/pages/v3/financial/evidence';
import { openFromSidebar } from '../../../src/pages/v3/financial/sidebar';

/**
 * Wallet Recharge By PG — v3 sheet, Web W-0001..W-0022 and Financial F-120..F-131.
 *
 * Two roles, because the Customer ID control differs by role (see WalletRechargePage):
 * the Customer ID validations need the FP Admin's free-text field; everything the
 * customer does — amounts, confirmation, the gateway — runs as the funded customer's
 * Customer Admin (9999303778), recharging its own wallet.
 *
 * ── Money ─────────────────────────────────────────────────────────────────
 * One completed recharge of ₹1 per run (the gateway's minimum is ₹1.00), through the
 * Pine Labs UAT checkout and BillDesk's net-banking simulator choosing State Bank of
 * India, as the client asked. It is a genuine credit to NAYAFP1020900195 and is reported
 * rather than reversed: a PG credit has no reversal path from the web application.
 * The failure case uses the simulator's Failure outcome and moves nothing.
 */

const fp = () => LANES.financial.fpAdmin;
const ca = () => LANES.financial.customerAdmin;

let fpPage: Page | undefined;
let caPage: Page | undefined;

test.afterEach(async ({}, testInfo) => attachOnFailure(testInfo, [fpPage, caPage]));

async function asFp(sessionFor: (a: typeof LANES.financial.fpAdmin) => Promise<Page>): Promise<WalletRechargePage> {
  fpPage = await sessionFor(fp());
  const wr = new WalletRechargePage(fpPage);
  await wr.open();
  return wr;
}

async function asCustomer(sessionFor: (a: typeof LANES.financial.customerAdmin) => Promise<Page>): Promise<WalletRechargePage> {
  caPage = await sessionFor(ca());
  const wr = new WalletRechargePage(caPage);
  await wr.open();
  return wr;
}

/** Counts the requests a step makes to one endpoint. */
function countRequests(page: Page, path: string): { count: () => number; stop: () => void } {
  let n = 0;
  const on = (r: Request) => { if (r.url().includes(path) && r.method() === 'POST') n++; };
  page.on('request', on);
  return { count: () => n, stop: () => page.off('request', on) };
}

test.describe('v3 Financial — Wallet Recharge By PG', () => {
  test.describe.configure({ timeout: 120_000 });

  // ── Customer ID: only the FP Admin can type one ─────────────────────────
  test(caseTitle(['W-0001', 'F-120'], 'an unknown Customer ID is refused with an error on Proceed'), async ({ sessionFor }) => {
    const wr = await asFp(sessionFor);
    await wr.typeCustomerId('NAYAFP0000000000');
    await wr.typeAmount('10');
    await wr.proceed.click();
    const shown = await wr.dialogs.next(15_000);
    observed(`dialog: ${JSON.stringify(shown)}; field error: "${await wr.customerIdError.innerText()}"`);
    expect(shown?.kind, 'W-0001: an unknown Customer ID must raise an error, not the recharge confirmation').toMatch(/failure|error/);
    expect(shown?.text, 'W-0001: the error must say something').toBeTruthy();
  });

  test(caseTitle(['W-0002', 'F-121'], 'a blank Customer ID raises the Customer ID validation'), async ({ sessionFor }) => {
    const wr = await asFp(sessionFor);
    await wr.typeAmount('10');
    await wr.proceed.click();
    await expect(wr.customerIdError, 'W-0002: Customer ID validation must appear').toHaveText(/Please enter customer ID/i);
    expect(await wr.dialogs.open('confirmation').count(), 'W-0002: no confirmation may open').toBe(0);
  });

  test(caseTitle(['W-0003', 'F-122'], 'special characters in Customer ID are not accepted as a customer'), async ({ sessionFor }) => {
    const wr = await asFp(sessionFor);
    const typed = await wr.typeCustomerId('@#$%^&*!');
    await wr.typeAmount('10');
    await wr.proceed.click();
    const shown = await wr.dialogs.next(15_000);
    observed(`field kept "${typed}"; on Proceed: ${JSON.stringify(shown)}; field error "${await wr.customerIdError.innerText()}"`);
    const refusedAtEntry = !/[^A-Z0-9]/i.test(typed);
    const refusedAtProceed = !!shown && shown.kind !== 'confirmation';
    if (!refusedAtEntry) deviation('The field accepts special characters as typed; the format is refused only when Proceed is pressed.');
    expect(refusedAtEntry || refusedAtProceed, 'W-0003: special characters must not be accepted as a Customer ID').toBe(true);
    expect(shown?.kind, 'W-0003: the recharge confirmation must not open for an invalid format').not.toBe('confirmation');
  });

  test(caseTitle(['W-0012', 'F-127'], 'a valid Customer ID is accepted and carried into the confirmation'), async ({ sessionFor }) => {
    const wr = await asFp(sessionFor);
    await wr.typeCustomerId(FUNDED.parentId);
    await wr.typeAmount('1');
    await wr.proceed.click();
    const shown = await wr.dialogs.next(15_000);
    observed(JSON.stringify(shown));
    expect(shown?.kind, 'W-0012: a valid Customer ID must reach the confirmation').toBe('confirmation');
    expect(shown?.text, 'W-0012: the confirmation names the customer').toContain(FUNDED.parentId);
    await wr.dialogs.confirmNo.click();
  });

  test(caseTitle(['W-0011', 'F-126'], 'all fields blank: the three mandatory-field messages appear'), async ({ sessionFor }) => {
    const wr = await asFp(sessionFor);
    await wr.proceed.click();
    const shown = await wr.dialogs.next(4_000, ['failure', 'error']);
    const cust = (await wr.customerIdError.innerText()).trim();
    const amt = (await wr.amountError.innerText()).trim();
    observed(`Customer ID error "${cust}"; Amount error "${amt}"; pop-up ${JSON.stringify(shown)}`);
    expect.soft(cust, 'W-0011: "Please enter customer ID." for Customer ID').toMatch(/Please enter customer ID/i);
    expect.soft(amt, 'W-0011: "Please enter amount" for Amount').toMatch(/Please enter amount/i);
    expect.soft(shown?.text ?? '(no pop-up)', 'W-0011: "Please select one payment gateway." pop-up — 1.4.0 has no gateway selection to leave blank, so this message can no longer be raised')
      .toMatch(/Please select one payment gateway/i);
  });

  // ── Customer Admin: the customer's own recharge ────────────────────────
  test(caseTitle(['W-0009', 'F-124'], 'Wallet Recharge By PG opens from the menu with Payment Gateway and Recharge Details sections'), async ({ sessionFor }) => {
    caPage = await sessionFor(ca());
    await openFromSidebar(caPage, 'Wallet Management', WalletRechargePage.route);
    const wr = new WalletRechargePage(caPage);
    await expect(wr.heading, 'W-0009: page heading').toHaveText(/Wallet Recharge By PG/i);
    await expect(wr.rechargeDetailsSection, 'W-0009: Recharge Details section').toBeVisible();
    const pgSection = caPage.getByText(/^\s*Payment Gateway\s*$/i);
    observed(`Payment Gateway section elements found: ${await pgSection.count()}`);
    await expect.soft(pgSection.first(), 'W-0009: a Payment Gateway section must be visible — 1.4.0 renders none (single default gateway "PG")').toBeVisible({ timeout: 3_000 });
  });

  test(caseTitle(['W-0010', 'F-125'], 'all listed UI elements are present'), async ({ sessionFor }) => {
    const wr = await asCustomer(sessionFor);
    await expect.soft(wr.selfCustomerId, 'Customer ID field').toBeVisible();
    await expect.soft(wr.selfCustomerId, 'Customer ID prefilled with the session customer').toHaveValue(FUNDED.parentId);
    await expect.soft(wr.amount, 'Amount field').toBeVisible();
    await expect.soft(wr.proceed, 'Proceed button').toBeVisible();
    await expect.soft(wr.reset, 'Reset button').toBeVisible();
    await expect.soft(wr.statusLink.or(wr.getTransactionStatusButton).first(), 'Get Transaction Status (rendered as "View Wallet Recharge Status")').toBeVisible();
    observed(`Selected PG fields: ${await wr.selectedPgField.count()}, PG selection cards: ${await wr.pgSelectionCard.count()}`);
    expect.soft(await wr.selectedPgField.count(), 'W-0010: "Selected PG" field is missing from the screen').toBeGreaterThan(0);
    expect.soft(await wr.pgSelectionCard.count(), 'W-0010: PG selection card is missing from the screen').toBeGreaterThan(0);
  });

  test(caseTitle(['W-0004', 'F-123'], 'an amount below the minimum raises a minimum-amount validation'), async ({ sessionFor }) => {
    const wr = await asCustomer(sessionFor);
    await wr.typeAmount('0.50');
    await wr.proceed.click();
    const shown = await wr.dialogs.next(15_000);
    observed(JSON.stringify(shown));
    expect(shown?.kind, 'W-0004: below-minimum must not reach the confirmation').toMatch(/failure|error/);
    expect(shown?.text, 'W-0004: the message must state the minimum').toMatch(/more or equal to 1(\.00)?|minimum/i);
  });

  test(caseTitle(['W-0005'], 'a negative amount is rejected'), async ({ sessionFor }) => {
    const wr = await asCustomer(sessionFor);
    const kept = await wr.typeAmount('-500');
    observed(`typed "-500", field holds "${kept}"`);
    expect(kept, 'W-0005: the minus sign must not be accepted').not.toContain('-');
  });

  test(caseTitle(['W-0006'], 'an amount above the limit raises a limit validation'), async ({ sessionFor }) => {
    const wr = await asCustomer(sessionFor);
    const kept = await wr.typeAmount('9999999999');
    await wr.proceed.click();
    const shown = await wr.dialogs.next(15_000);
    observed(`field "${kept}"; ${JSON.stringify(shown)}`);
    expect(shown?.kind, 'W-0006: a very large amount must be refused').toMatch(/failure|error/);
    expect(shown?.text, 'W-0006: the message must state the limit').toMatch(/less or equal to|maximum|limit/i);
  });

  test(caseTitle(['W-0014', 'F-129'], 'a zero amount is not allowed'), async ({ sessionFor }) => {
    const wr = await asCustomer(sessionFor);
    await wr.typeAmount('0');
    await wr.proceed.click();
    const shown = await wr.dialogs.next(5_000);
    const err = (await wr.amountError.innerText()).trim();
    observed(`amount error "${err}"; dialog ${JSON.stringify(shown)}`);
    expect(shown?.kind, 'W-0014: zero must not reach the confirmation').not.toBe('confirmation');
    expect(err || shown?.text || '', 'W-0014: a validation must say the amount is invalid').toMatch(/valid amount|more or equal|amount/i);
  });

  test(caseTitle(['W-0016', 'F-131'], 'alphabetic characters are not accepted in Amount'), async ({ sessionFor }) => {
    const wr = await asCustomer(sessionFor);
    const kept = await wr.typeAmount('abcXYZ');
    observed(`typed "abcXYZ", field holds "${kept}"`);
    expect(kept, 'W-0016: letters must not be accepted').not.toMatch(/[A-Za-z]/);
  });

  test(caseTitle(['W-0017'], 'special characters are not accepted in Amount'), async ({ sessionFor }) => {
    const wr = await asCustomer(sessionFor);
    const kept = await wr.typeAmount('@#$%^&*');
    observed(`typed "@#$%^&*", field holds "${kept}"`);
    expect(kept, 'W-0017: special characters must not be accepted').not.toMatch(/[@#$%^&*]/);
  });

  test(caseTitle(['W-0015', 'F-130'], 'a decimal amount is handled to two places'), async ({ sessionFor }) => {
    const wr = await asCustomer(sessionFor);
    const kept = await wr.typeAmount('1.555');
    observed(`typed "1.555", field holds "${kept}"`);
    expect(kept, 'W-0015: amount is held to two decimal places').toBe('1.55');
    await wr.proceed.click();
    const shown = await wr.dialogs.next(15_000);
    observed(JSON.stringify(shown));
    expect(shown?.kind, 'W-0015: a two-decimal amount is a valid recharge amount').toBe('confirmation');
    expect(shown?.text, 'W-0015: the confirmation carries the decimal amount').toContain('₹1.55');
    await wr.dialogs.confirmNo.click();
  });

  test(caseTitle(['W-0013', 'F-128', 'W-0019'], 'a valid amount is accepted and Proceed opens the confirmation'), async ({ sessionFor }) => {
    const wr = await asCustomer(sessionFor);
    await wr.typeAmount('10');
    await wr.proceed.click();
    const shown = await wr.dialogs.next(15_000);
    observed(JSON.stringify(shown));
    await expect(wr.amountError, 'W-0013: no amount validation for ₹10').toHaveText('');
    expect(shown?.kind, 'W-0019: Proceed with valid details opens the confirmation pop-up').toBe('confirmation');
    await wr.dialogs.confirmNo.click();
  });

  test(caseTitle(['W-0018'], 'selecting a payment gateway checks it and shows it in Selected PG'), async ({ sessionFor }) => {
    const wr = await asCustomer(sessionFor);
    const cards = await wr.pgSelectionCard.count();
    const selected = await wr.selectedPgField.count();
    observed(`gateway selection controls: ${cards}; Selected PG fields: ${selected}. The page script hard-codes one gateway ("PG") and renders no choice.`);
    expect(cards, 'W-0018: there is no payment-gateway option to select on this screen').toBeGreaterThan(0);
    expect(selected, 'W-0018: there is no "Selected PG" field to show the choice').toBeGreaterThan(0);
  });

  test(caseTitle(['W-0020', 'W-0021'], 'the confirmation shows the recharge details; No closes it and stays on the page'), async ({ sessionFor }) => {
    const wr = await asCustomer(sessionFor);
    await wr.typeAmount('2');
    await wr.proceed.click();
    const shown = await wr.dialogs.next(15_000);
    observed(JSON.stringify(shown));
    expect(shown?.kind, 'W-0020: confirmation opens').toBe('confirmation');
    const text = shown?.text ?? '';
    expect.soft(text, 'W-0020: Customer ID shown').toContain(FUNDED.parentId);
    expect.soft(text, 'W-0020: Amount shown').toContain('₹2');
    await expect.soft(wr.dialogs.confirmYes, 'W-0020: Yes button').toHaveText(/Yes/);
    await expect.soft(wr.dialogs.confirmNo, 'W-0020: No button').toHaveText(/No/);
    expect.soft(text, 'W-0020: the PG name must be shown — the dialog names only customer and amount').toMatch(/\bPG\b|gateway|Pine/i);

    await wr.dialogs.confirmNo.click();
    await expect(wr.dialogs.open('confirmation'), 'W-0021: No closes the pop-up').toHaveCount(0);
    expect(caPage!.url(), 'W-0021: user remains on the recharge page').toContain(WalletRechargePage.route);
    await expect(wr.amount, 'W-0021: the entered amount is still there').toHaveValue('2');
  });

  test(caseTitle(['W-0007'], 'a failed bank payment shows a failed-transaction message and credits nothing'), async ({ sessionFor }) => {
    test.setTimeout(6 * 60_000);
    const wr = await asCustomer(sessionFor);
    const page = caPage!;
    const before = await walletBalance(FUNDED.parentId);
    await wr.typeAmount('1');
    await wr.proceed.click();
    expect((await wr.dialogs.next(15_000))?.kind).toBe('confirmation');
    await wr.dialogs.confirmYes.click();

    const pg = new PgCheckoutPage(page);
    await pg.waitForCheckout();
    const bank = await pg.payBySbiNetBanking();
    await pg.simulateBank(bank, 'Failure');
    const failed = page.getByText('Payment not completed!');
    await expect(failed, 'W-0007: the gateway must report the failed payment').toBeVisible({ timeout: 90_000 });
    observed(`gateway: "${(await page.locator('.failed-sublabel').first().innerText().catch(() => '')).trim()}"`);

    await pg.cancelBackToMerchant();
    await pg.waitForMerchantReturn();
    const shown = await wr.dialogs.next(20_000);
    const body = (await page.locator('.content').first().innerText().catch(() => '')).replace(/\s+/g, ' ');
    observed(`FleetPlus callback: ${page.url()} — dialog ${JSON.stringify(shown)}`);
    expect(`${shown?.text ?? ''} ${body}`, 'W-0007: FleetPlus shows the failed-transaction message').toMatch(/Transaction Failed/i);
    await wr.dialogs.dismissAll();
    expect(await walletBalance(FUNDED.parentId), 'W-0007: a failed payment credits nothing').toBeCloseTo(before, 2);
  });

  test(caseTitle(['W-0022', 'W-0008'], 'Yes goes to the payment page; a rapid double click starts one transaction; SBI net banking completes and credits the wallet'), async ({ sessionFor }) => {
    test.setTimeout(6 * 60_000);
    const wr = await asCustomer(sessionFor);
    const page = caPage!;
    const before = await walletBalance(FUNDED.parentId);
    const maxPgId = Number((await DbHelper.query<{ M: number | null }>(`SELECT MAX(Id) AS M FROM dbo.PGRechargeDetails`))[0]?.M ?? 0);

    await wr.typeAmount('1');
    const details = countRequests(page, '/PgRecharge/GetCustomerDetailsForRechargeByPg');
    await wr.proceed.dblclick();
    expect((await wr.dialogs.next(15_000))?.kind, 'W-0008: the double click still opens the confirmation').toBe('confirmation');
    await page.waitForTimeout(1_500);
    details.stop();
    observed(`GetCustomerDetailsForRechargeByPg calls from a double click on Proceed: ${details.count()}`);

    const inserts = countRequests(page, '/PgRecharge/InsertRechargeByPg');
    await wr.dialogs.confirmYes.click();
    const pg = new PgCheckoutPage(page);
    await pg.waitForCheckout();
    inserts.stop();
    observed(`InsertRechargeByPg calls after the double-clicked Proceed and one Yes: ${inserts.count()}`);
    expect(page.url(), 'W-0022: Yes redirects to the payment page').toMatch(/pinepg\.in/);
    expect.soft(await pg.amountShown(), 'W-0022: the gateway carries the amount').toMatch(/₹\s*1\.00/);

    const created = await DbHelper.query<{ Id: number; OrderId: string; CustomerId: string; Amount: number }>(
      `SELECT Id, OrderId, CustomerId, Amount FROM dbo.PGRechargeDetails WHERE Id > @maxPgId AND CustomerId = @cid`,
      { maxPgId, cid: FUNDED.parentId }
    );
    observed(`PGRechargeDetails rows created: ${JSON.stringify(created)}`);
    expect.soft(inserts.count(), 'W-0008: only one recharge may be initiated').toBe(1);
    expect.soft(created.length, 'W-0008: exactly one gateway order recorded').toBe(1);

    const bank = await pg.payBySbiNetBanking();
    await pg.simulateBank(bank, 'Success');
    await pg.waitForMerchantReturn(150_000);
    const shown = await wr.dialogs.next(30_000);
    const body = (await page.locator('.content').first().innerText().catch(() => '')).replace(/\s+/g, ' ');
    observed(`callback ${page.url()}: dialog ${JSON.stringify(shown)}; page "${body.slice(0, 300)}"`);
    await wr.dialogs.dismissAll();

    const after = await waitForBalance(FUNDED.parentId, round2(before + 1), 60_000);
    test.info().annotations.push({ type: 'money', description: `PG recharge ₹1 to ${FUNDED.parentId}: ${before} -> ${after}` });
    expect(after, 'W-0022: the completed SBI net-banking payment credits ₹1 to the wallet').toBeCloseTo(round2(before + 1), 2);
    expect(`${shown?.text ?? ''} ${body}`, 'W-0022: FleetPlus confirms the successful recharge').toMatch(/success/i);
  });
});
