import type { Page } from '@playwright/test';
import { test, expect } from '../../../src/fixtures/session.fixtures';
import { LANES } from '../../../src/config/test-accounts';
import { caseTitle } from '../../../src/helpers/v3-sheet.helper';
import { DbHelper } from '../../../src/helpers/db.helper';
import { SuspensePage, SUSPENSE_COLUMNS } from '../../../src/pages/v3/financial/suspense.page';
import { AppDialogs } from '../../../src/pages/v3/financial/app-dialogs';
import { attachOnFailure, observed } from '../../../src/pages/v3/financial/evidence';
import { openFromSidebar } from '../../../src/pages/v3/financial/sidebar';

/**
 * Suspense Transactions — v3 sheet W-0137..W-0146. FP Admin (9061909500), read-only
 * except W-0138, which submits a deliberately invalid Virtual Account Number and expects
 * the claim to be refused (a valid one would credit a customer). W-0139 uses the lane's
 * Customer Admin as the user without access.
 */

let fpPage: Page | undefined;
let caPage: Page | undefined;
test.afterEach(async ({}, testInfo) => attachOnFailure(testInfo, [fpPage, caPage]));

const UNCLAIMED = 802;

async function openSuspense(sessionFor: (a: typeof LANES.financial.fpAdmin) => Promise<Page>): Promise<SuspensePage> {
  fpPage = await sessionFor(LANES.financial.fpAdmin);
  const s = new SuspensePage(fpPage);
  await s.open();
  return s;
}

async function unclaimedCount(): Promise<number> {
  const r = await DbHelper.query<{ N: number }>(`SELECT COUNT(*) AS N FROM dbo.EFTRechargeUnclaimedAccount WHERE RechargeStatus = @s AND StatusFlag = 1`, { s: UNCLAIMED });
  return Number(r[0]?.N ?? 0);
}

test.describe('v3 Financial — Suspense Transactions', () => {
  test.describe.configure({ timeout: 120_000 });

  test(caseTitle(['W-0140'], 'Suspense Transactions opens from the Admin menu'), async ({ sessionFor }) => {
    fpPage = await sessionFor(LANES.financial.fpAdmin);
    await openFromSidebar(fpPage, 'Admin', SuspensePage.route);
    const s = new SuspensePage(fpPage);
    await expect(s.title, 'page heading').toHaveText(/Suspense Transactions/i);
    await expect(s.rows.first(), 'grid loaded').toBeVisible();
  });

  test(caseTitle(['W-0141'], 'search, Excel, PDF, display-records, grid and Edit action are displayed'), async ({ sessionFor }) => {
    const s = await openSuspense(sessionFor);
    await expect.soft(s.search, 'Search field').toBeVisible();
    await expect.soft(s.excel, 'Export Excel button').toBeVisible();
    await expect.soft(s.pdf, 'Export PDF button').toBeVisible();
    await expect.soft(s.length, 'Display records dropdown').toBeVisible();
    await expect.soft(s.grid, 'Transaction grid').toBeVisible();
    await expect.soft(s.rows.first().locator('a[href*="UnclaimedTransactionDetails"]'), 'Edit action').toBeVisible();
    const headers = (await s.grid.locator('thead th').allInnerTexts()).map(h => h.trim());
    expect(headers, 'grid columns').toEqual([...SUSPENSE_COLUMNS]);
  });

  test(caseTitle(['W-0142'], 'every suspense transaction is listed with the correct details'), async ({ sessionFor }) => {
    const s = await openSuspense(sessionFor);
    const total = (await s.infoNumbers()).total;
    const db = await unclaimedCount();
    observed(`grid total ${total}; DB unclaimed (802) ${db}`);
    expect(total, 'all suspense transactions listed').toBe(db);
    for (const row of (await s.table()).slice(0, 5)) {
      const rec = (await DbHelper.query<{ VirtualAccountNo: string; Amount: number; RemitterIFSCCode: string; RemitterBankAccountNumber: string }>(
        `SELECT TOP 1 VirtualAccountNo, Amount, RemitterIFSCCode, RemitterBankAccountNumber FROM dbo.EFTRechargeUnclaimedAccount WHERE UTRNumber = @u AND RechargeStatus = @s`,
        { u: row['UTR Number'], s: UNCLAIMED }
      ))[0];
      expect(rec, `UTR ${row['UTR Number']} is an unclaimed record`).toBeTruthy();
      expect(row['Virtual Account No'], `${row['UTR Number']}: virtual account`).toBe(rec.VirtualAccountNo);
      expect(Number(row.Amount.replace(/,/g, '')), `${row['UTR Number']}: amount`).toBeCloseTo(Number(rec.Amount), 2);
      expect(row['Remitter IFSC Code'], `${row['UTR Number']}: IFSC`).toBe(rec.RemitterIFSCCode);
      expect(row['Remitter Bank Account Number'], `${row['UTR Number']}: remitter account`).toBe(rec.RemitterBankAccountNumber);
    }
  });

  test(caseTitle(['W-0143'], 'searching a valid UTR shows the matching transaction'), async ({ sessionFor }) => {
    const s = await openSuspense(sessionFor);
    const utr = (await s.table())[0]['UTR Number'];
    await s.typeSearch(utr);
    const rows = await s.table();
    observed(`search "${utr}": ${rows.map(r => r['UTR Number']).join(', ')}`);
    expect(rows.length, 'matching transaction displayed').toBeGreaterThan(0);
    for (const r of rows) expect(r['UTR Number'], 'only matching UTRs').toContain(utr);
  });

  test(caseTitle(['W-0137'], 'searching an invalid UTR shows No records found'), async ({ sessionFor }) => {
    const s = await openSuspense(sessionFor);
    await s.typeSearch('UTRNOSUCH000000');
    const text = (await s.rows.first().innerText()).trim();
    observed(`grid: "${text}"`);
    expect(await s.table(), 'no transactions').toHaveLength(0);
    expect(text, 'No records found message').toMatch(/No (matching )?records found/i);
  });

  test(caseTitle(['W-0145'], 'Display records 10 / 25 / 50 shows that many rows'), async ({ sessionFor }) => {
    const s = await openSuspense(sessionFor);
    const total = (await s.infoNumbers()).total;
    for (const n of [10, 25, 50]) {
      await s.length.selectOption(String(n));
      await fpPage!.waitForTimeout(500);
      const shown = (await s.table()).length;
      observed(`display ${n}: ${shown} rows (total ${total})`);
      expect(shown, `display ${n}`).toBe(Math.min(n, total));
    }
  });

  test(caseTitle(['W-0144'], 'changing page shows the records of that page'), async ({ sessionFor }) => {
    const s = await openSuspense(sessionFor);
    await s.length.selectOption('10');
    const first = (await s.table()).map(r => r['UTR Number']);
    const info1 = await s.infoNumbers();
    test.skip(info1.total <= 10, 'fewer than 11 records; nothing to page');
    await s.nextPage.click();
    await fpPage!.waitForTimeout(500);
    const second = (await s.table()).map(r => r['UTR Number']);
    const info2 = await s.infoNumbers();
    observed(`page 1 ${JSON.stringify(info1)} -> page 2 ${JSON.stringify(info2)}`);
    expect(info2.from, 'page 2 starts at record 11').toBe(11);
    expect(second.length, 'page 2 has records').toBeGreaterThan(0);
    expect(second.filter(u => first.includes(u)), 'page 2 shows different records').toHaveLength(0);
  });

  test(caseTitle(['W-0146'], 'Export Excel downloads an Excel file'), async ({ sessionFor }) => {
    const s = await openSuspense(sessionFor);
    const downloadP = fpPage!.waitForEvent('download', { timeout: 30_000 });
    await s.excel.click();
    const download = await downloadP;
    const name = download.suggestedFilename();
    const path = await download.path();
    observed(`downloaded "${name}"`);
    expect(name, 'an Excel file').toMatch(/\.xlsx?$/i);
    expect(path, 'file saved').toBeTruthy();
  });

  test(caseTitle(['W-0138'], 'an invalid Virtual Account Number is refused with a proper error'), async ({ sessionFor }) => {
    const s = await openSuspense(sessionFor);
    const row = (await s.table())[0];
    await fpPage!.locator(`a[href="/Financial/UnclaimedTransactionDetails/${row['UTR Number']}"]`).first().click();
    await s.virtualAccNo.waitFor({ state: 'visible', timeout: 30_000 });
    const before = (await DbHelper.query<{ RechargeStatus: number }>(`SELECT TOP 1 RechargeStatus FROM dbo.EFTRechargeUnclaimedAccount WHERE UTRNumber = @u`, { u: row['UTR Number'] }))[0]?.RechargeStatus;
    await s.virtualAccNo.fill('INVALIDVA00000001');
    await s.submit.click();
    const shown = await new AppDialogs(fpPage!).next(20_000);
    const inline = (await s.virtualAccNoFeedback.innerText().catch(() => '')).trim();
    observed(`UTR ${row['UTR Number']}: dialog ${JSON.stringify(shown)}; inline "${inline}"`);
    await new AppDialogs(fpPage!).dismissAll();
    expect(shown?.kind, 'the claim is refused').not.toBe('success');
    expect(`${shown?.text ?? ''} ${inline}`, 'a proper error message').toMatch(/Invalid Virtual Account Number/i);
    const after = (await DbHelper.query<{ RechargeStatus: number }>(`SELECT TOP 1 RechargeStatus FROM dbo.EFTRechargeUnclaimedAccount WHERE UTRNumber = @u`, { u: row['UTR Number'] }))[0]?.RechargeStatus;
    expect(after, 'the transaction stays in suspense').toBe(before);
  });

  test(caseTitle(['W-0139'], 'a user without access is denied the Suspense Transactions page'), async ({ sessionFor }) => {
    caPage = await sessionFor(LANES.financial.customerAdmin);
    await caPage.goto(SuspensePage.route, { waitUntil: 'domcontentloaded' });
    const body = caPage.locator('.content').first();
    await expect(body, 'access denied message').toContainText(/Unauthorized Access|do not have permission/i, { timeout: 30_000 });
    observed((await body.innerText()).replace(/\s+/g, ' ').slice(0, 200));
    await expect(caPage.locator('#UnclaimedTbl'), 'no suspense data rendered').toHaveCount(0);
    expect(await caPage.locator('#sidebarMenu a[href="/Financial/UnclaimedTransactions"]').count(), 'not offered in the menu').toBe(0);
  });
});
