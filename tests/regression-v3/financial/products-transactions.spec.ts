import type { Page } from '@playwright/test';
import { test, expect } from '../../../src/fixtures/session.fixtures';
import { LANES } from '../../../src/config/test-accounts';
import { caseTitle } from '../../../src/helpers/v3-sheet.helper';
import { ProductsTransactionsPage } from '../../../src/pages/v3/financial/products-transactions.page';
import { FUNDED } from '../../../src/pages/v3/financial/finance-data';
import { attachOnFailure, observed, deviation } from '../../../src/pages/v3/financial/evidence';

/**
 * Manage Products & Transactions — v3 sheet W-0471..W-0476 (search side only; nothing is
 * saved). The sheet's precondition is a Customer Admin, but 1.4.0 serves this screen to
 * the FP Admin only — the Customer Admin is refused with "Unauthorized Access", which the
 * first test records — so the cases run as the lane's FP Admin against the funded
 * customer's branch.
 */

const CUSTOMER = FUNDED.parentId;
const BRANCH = FUNDED.outstandingBranch;

let fpPage: Page | undefined;
let caPage: Page | undefined;
test.afterEach(async ({}, testInfo) => attachOnFailure(testInfo, [fpPage, caPage]));

async function openScreen(sessionFor: (a: typeof LANES.financial.fpAdmin) => Promise<Page>): Promise<ProductsTransactionsPage> {
  fpPage = await sessionFor(LANES.financial.fpAdmin);
  const pt = new ProductsTransactionsPage(fpPage);
  await pt.open();
  return pt;
}

test.describe('v3 Financial — Manage Products & Transactions', () => {
  test.describe.configure({ timeout: 120_000 });

  test(caseTitle(['W-0473', 'W-0474', 'W-0475'], 'searching a valid Customer ID loads the Products and Transaction Types sections with their two columns'), async ({ sessionFor }) => {
    caPage = await sessionFor(LANES.financial.customerAdmin);
    await caPage.goto(ProductsTransactionsPage.route, { waitUntil: 'domcontentloaded' });
    const caText = (await caPage.locator('.content').first().innerText()).replace(/\s+/g, ' ');
    observed(`as Customer Admin: "${caText.slice(0, 160)}"`);
    if (/Unauthorized/i.test(caText)) deviation('The Customer Admin is refused this screen ("Unauthorized Access"); the case is executed as the FP Admin, the role 1.4.0 serves it to.');

    const pt = await openScreen(sessionFor);
    await pt.typeCustomerId(CUSTOMER);
    await expect(pt.searchButton).toBeEnabled();
    await pt.searchButton.click();
    const shown = await pt.dialogs.next(6_000, ['failure', 'error']);
    if (shown) observed(`search ${CUSTOMER}: dialog ${JSON.stringify(shown)}`);
    await expect(pt.details, 'W-0473: the result sections load').toBeVisible({ timeout: 20_000 });
    await expect(pt.productsToggle, 'W-0474: Products section').toBeVisible();
    await expect(pt.transactionsToggle, 'W-0475: Transaction Types section').toBeVisible();
    const productHeads = [await pt.productsAvailableHeader.innerText(), await pt.productsAllowedHeader.innerText()].map(t => t.trim());
    const txnHeads = (await fpPage!.locator('#edTransactionsCollapse').innerText()).replace(/\s+/g, ' ');
    const products = { available: await pt.productsAvailable.innerText(), allowed: await pt.productsAllowed.innerText() };
    const txns = { available: await pt.transactionsAvailable.innerText(), allowed: await pt.transactionsAllowed.innerText() };
    observed(`name "${await pt.customerName.inputValue()}"; product headers ${JSON.stringify(productHeads)}; products ${JSON.stringify(products).slice(0, 300)}; txn ${JSON.stringify(txns).slice(0, 300)}`);
    deviation('The two columns are headed "Disabled" / "Enabled" in 1.4.0; the sheet calls them "Available" / "Allowed".');
    expect(productHeads, 'W-0474: Products has its Available (Disabled) and Allowed (Enabled) columns').toEqual(['Disabled', 'Enabled']);
    expect(txnHeads, 'W-0475: Transaction Types has its Available (Disabled) and Allowed (Enabled) columns').toMatch(/Disabled.*Enabled/);
    expect(`${products.available}${products.allowed}`.trim(), 'W-0474: the customer\'s products are listed').not.toBe('');
    expect(`${txns.available}${txns.allowed}`.trim(), 'W-0475: the customer\'s transaction types are listed').not.toBe('');
  });

  test(caseTitle(['W-0471'], 'an invalid Customer ID gives an empty result or an error, without a crash'), async ({ sessionFor }) => {
    const pt = await openScreen(sessionFor);
    await pt.typeCustomerId('INVALID999');
    const typed = await pt.customerId.inputValue();
    if (await pt.searchButton.isEnabled()) await pt.searchButton.click();
    const shown = await pt.dialogs.next(15_000, ['failure', 'error']);
    const inline = (await pt.customerIdError.innerText().catch(() => '')).trim();
    const noRecord = (await pt.noRecord.innerText().catch(() => '')).trim();
    observed(`typed "${typed}"; dialog ${JSON.stringify(shown)}; inline "${inline}"; no-record "${noRecord}"`);
    expect(`${shown?.text ?? ''} ${inline} ${noRecord}`.trim(), 'an error message or empty result is shown').not.toBe('');
    await expect(pt.details, 'no customer data is loaded').toBeHidden();
    await expect(fpPage!.locator('body'), 'no crash / exception page').not.toContainText(/exception|stack trace|Server Error/i);
  });

  test(caseTitle(['W-0472'], 'a blank Customer ID is refused: Customer ID is required and the search is blocked'), async ({ sessionFor }) => {
    const pt = await openScreen(sessionFor);
    await pt.customerId.fill('');
    const enabled = await pt.searchButton.isEnabled();
    if (enabled) await pt.searchButton.click();
    const shown = await pt.dialogs.next(4_000, ['failure', 'error']);
    const inline = (await pt.customerIdError.innerText().catch(() => '')).trim();
    observed(`Search ${enabled ? 'enabled' : 'disabled'}; dialog ${JSON.stringify(shown)}; inline "${inline}"`);
    await expect(pt.details, 'search blocked — nothing loads').toBeHidden();
    expect(enabled ? (shown?.text ?? inline) : 'blocked', 'search blocked').toBeTruthy();
    expect.soft(`${shown?.text ?? ''} ${inline}`, 'Validation error "Customer ID is required" — Search is simply disabled with no message').toMatch(/Customer ID (is )?required|Please enter Customer ID/i);
  });

  test(caseTitle(['W-0476'], 'Reset clears the Customer ID and hides the results'), async ({ sessionFor }) => {
    const pt = await openScreen(sessionFor);
    await pt.typeCustomerId(CUSTOMER);
    await pt.searchButton.click();
    await expect(pt.details).toBeVisible({ timeout: 20_000 });
    // The sheet's step: a Branch Customer ID in the field, then RESET.
    await pt.customerId.fill(BRANCH).catch(() => undefined);
    await pt.resetButton.click();
    await pt.dialogs.next(2_000, ['confirmation']).then(async d => { if (d) await pt.dialogs.confirmYes.click(); });
    await expect(pt.customerId, 'Customer ID field cleared').toHaveValue('');
    await expect(pt.details, 'results hidden').toBeHidden();
  });
});
