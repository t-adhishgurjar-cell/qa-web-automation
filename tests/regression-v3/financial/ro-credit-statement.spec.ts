import type { Page } from '@playwright/test';
import { test, expect } from '../../../src/fixtures/session.fixtures';
import { LANES } from '../../../src/config/test-accounts';
import { caseTitle, notExecutable } from '../../../src/helpers/v3-sheet.helper';
import { RoCreditStatementPage, STATEMENT_COLUMNS } from '../../../src/pages/v3/financial/ro-credit-statement.page';
import { FUNDED } from '../../../src/pages/v3/financial/finance-data';
import { attachOnFailure, observed, deviation } from '../../../src/pages/v3/financial/evidence';
import { openFromSidebar } from '../../../src/pages/v3/financial/sidebar';

/**
 * RO Credit Statement — v3 sheet W-0147..W-0156 (read-only screen).
 *
 * Data: the funded customer's branch 01_Dadri (NAYAFP2020900196) bought on RO credit at
 * 47002TA002 in Sep and Oct 2026 (dbo.ROCreditMonthlyBalance), so those are the month,
 * branch and RO filters exercised. The sheet's "Jun-26" is illustrative; it names a month
 * with data, which for this customer is Sep 2026.
 */

const OD_LOGIN_REFUSED = 'The lane\'s OD account (9999301778) is refused at sign-in with "Invalid username or password." for the configured password; the suite stops using it to avoid a lockout, so no OD session is available.';
const YEAR = 2026;
const MONTH = 9;
const BRANCH = FUNDED.outstandingBranch;
const RO = '47002TA002';

let caPage: Page | undefined;
test.afterEach(async ({}, testInfo) => attachOnFailure(testInfo, [caPage]));

async function openStatement(sessionFor: (a: typeof LANES.financial.customerAdmin) => Promise<Page>): Promise<RoCreditStatementPage> {
  caPage = await sessionFor(LANES.financial.customerAdmin);
  const st = new RoCreditStatementPage(caPage);
  await st.open();
  return st;
}

test.describe('v3 Financial — RO Credit Statement', () => {
  test.describe.configure({ timeout: 120_000 });

  test(caseTitle(['W-0150', 'W-0151'], 'page loads with month picker, Branch UID, RO/CMS Code, Search, Reset and the statement grid'), async ({ sessionFor }) => {
    caPage = await sessionFor(LANES.financial.customerAdmin);
    await openFromSidebar(caPage, 'RO Credit Management', RoCreditStatementPage.route);
    const st = new RoCreditStatementPage(caPage);
    await expect(st.title, 'W-0150: page heading').toHaveText(/RO Credit Statement/i);
    await expect(st.month, 'W-0151: month picker').toBeVisible();
    await expect(st.monthToggle, 'W-0151: month picker button').toBeVisible();
    await expect(caPage.locator('#roadBranchUid + .CaptionCont, .SumoSelect:has(#roadBranchUid)').first(), 'W-0151: Branch UID dropdown').toBeVisible();
    await expect(st.roCode, 'W-0151: RO / CMS Code textbox').toBeVisible();
    await expect(st.searchButton, 'W-0151: Search').toBeVisible();
    await expect(st.resetButton, 'W-0151: Reset').toBeVisible();
    await expect(st.grid, 'W-0150: statement grid').toBeAttached();
    const headers = (await st.grid.locator('thead th').allInnerTexts()).map(h => h.trim()).filter(Boolean);
    observed(`grid columns: ${headers.join(' | ')}`);
    expect(headers, 'W-0150: the statement grid columns').toEqual([...STATEMENT_COLUMNS]);
    // The branch list is fetched after page load (/Customer/GetRoAccountDetailBranches).
    await expect.poll(() => st.branch.locator('option').count(), { timeout: 20_000 }).toBeGreaterThan(1);
    const branches = await st.branch.locator('option').allInnerTexts();
    expect(branches.join(' '), 'W-0151: the customer\'s branches are offered').toContain(BRANCH);
  });

  test(caseTitle(['W-0153'], 'Search by Month shows only that month\'s records'), async ({ sessionFor }) => {
    const st = await openStatement(sessionFor);
    await st.pickMonth(YEAR, MONTH);
    const items = await st.search();
    const rows = await st.table();
    observed(`Sep 2026: ${rows.length} rows; months ${[...new Set(rows.map(r => r.Month))].join(', ')}`);
    expect(rows.length, 'records exist for Sep 2026').toBeGreaterThan(0);
    expect(rows.length, 'grid shows what the service returned').toBe(Math.min(items.length, 10));
    for (const r of rows) expect(r.Month, 'only the selected month').toMatch(RoCreditStatementPage.monthLabels(YEAR, MONTH));
  });

  test(caseTitle(['W-0154'], 'Search by Branch UID shows only that branch\'s records'), async ({ sessionFor }) => {
    const st = await openStatement(sessionFor);
    await st.chooseBranch(BRANCH);
    await st.search();
    const rows = await st.table();
    observed(`${BRANCH}: ${rows.length} rows`);
    expect(rows.length, 'records exist for the branch').toBeGreaterThan(0);
    for (const r of rows) expect(r['Branch Location UID'], 'only the selected branch').toBe(BRANCH);
  });

  test(caseTitle(['W-0155'], 'Search by RO Code shows only that RO\'s records'), async ({ sessionFor }) => {
    const st = await openStatement(sessionFor);
    await st.roCode.fill(RO);
    await st.search();
    const rows = await st.table();
    observed(`${RO}: ${rows.length} rows`);
    expect(rows.length, 'records exist for the RO').toBeGreaterThan(0);
    for (const r of rows) expect(r['RO Code'], 'only the selected RO').toBe(RO);
  });

  test(caseTitle(['W-0152', 'W-0156'], 'Month, Branch UID and RO Code together return the matching records'), async ({ sessionFor }) => {
    const st = await openStatement(sessionFor);
    await st.pickMonth(YEAR, MONTH);
    await st.chooseBranch(BRANCH);
    await st.roCode.fill(RO);
    await st.search();
    const rows = await st.table();
    observed(`combined: ${JSON.stringify(rows)}`);
    expect(rows.length, 'W-0152: matching records displayed').toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.Month, 'W-0156: month filter applied').toMatch(RoCreditStatementPage.monthLabels(YEAR, MONTH));
      expect(r['Branch Location UID'], 'W-0156: branch filter applied').toBe(BRANCH);
      expect(r['RO Code'], 'W-0156: RO filter applied').toBe(RO);
    }
  });

  test(caseTitle(['W-0147'], 'month boundary: the current month is the last selectable and returns its records'), async ({ sessionFor }) => {
    const st = await openStatement(sessionFor);
    const now = new Date();
    const cy = now.getFullYear();
    const cm = now.getMonth() + 1;
    await st.monthToggle.click();
    await st.monthButton(cm).waitFor({ state: 'visible' });
    const states = await Promise.all(Array.from({ length: 12 }, (_, i) => st.monthButton(i + 1).isDisabled()));
    observed(`year ${cy}: disabled months ${states.map((d, i) => (d ? i + 1 : null)).filter(Boolean).join(',') || 'none'}`);
    expect(states[cm - 1], 'the current month is selectable').toBe(false);
    if (cm < 12) expect(states[cm], 'the month after the current one is not selectable').toBe(true);
    await st.monthButton(cm).click();
    const items = await st.search();
    const rows = await st.table();
    observed(`current month ${cm}/${cy}: ${items.length} records from the service, ${rows.length} shown`);
    expect(rows.length, 'records of the boundary month are retrieved').toBeGreaterThan(0);
    for (const r of rows) expect(r.Month).toMatch(RoCreditStatementPage.monthLabels(cy, cm));
    if (cy !== YEAR) deviation(`Boundary taken at the current month ${cm}/${cy}.`);
  });

  test(caseTitle(['W-0148'], 'an invalid RO / CMS Code is restricted with a client-side validation'), async ({ sessionFor }) => {
    const st = await openStatement(sessionFor);
    await st.roCode.pressSequentially('@#$%!*', { delay: 20 });
    const value = await st.roCode.inputValue();
    await st.searchButton.click();
    await caPage!.waitForTimeout(1_000);
    const msg = (await st.roCodeError.innerText().catch(() => '')).trim();
    observed(`typed "@#$%!*": field holds "${value}", inline error "${msg}"`);
    expect(value, 'the invalid characters are restricted (not accepted into the field)').toBe('');
    // A well-formed code that matches nothing, for the record.
    await st.roCode.fill('ZZ99999ZZ');
    const items = await st.search();
    observed(`unknown code ZZ99999ZZ: ${items.length} records; grid "${(await st.rows.first().innerText().catch(() => '')).trim()}"`);
    expect.soft(msg, 'a client-side validation message is shown — the field silently strips the characters and shows none').not.toBe('');
  });

  notExecutable(['W-0149'], 'OD customer: Net Outstanding shown for a branch with zero repayment', OD_LOGIN_REFUSED);
});
