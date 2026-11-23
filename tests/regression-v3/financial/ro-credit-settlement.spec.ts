import type { Page, Route } from '@playwright/test';
import { test, expect } from '../../../src/fixtures/session.fixtures';
import { LANES } from '../../../src/config/test-accounts';
import { caseTitle, notExecutable } from '../../../src/helpers/v3-sheet.helper';
import { DbHelper } from '../../../src/helpers/db.helper';
import { RoCreditSettlementPage, SettlementSearch, rupees } from '../../../src/pages/v3/financial/ro-credit-settlement.page';
import { FUNDED, walletBalance, waitForBalance, round2, transactionOtp } from '../../../src/pages/v3/financial/finance-data';
import { attachOnFailure, observed, deviation } from '../../../src/pages/v3/financial/evidence';
import { openFromSidebar } from '../../../src/pages/v3/financial/sidebar';

/**
 * RO Credit Settlement — v3 sheet W-0085..W-0104 and F-152..F-163.
 *
 * The funded customer's branch 01_Dadri (NAYAFP2020900196) owes RANK BHAIRAV PETROLIUM
 * (47002TA002) for Sep and Oct 2026, ₹4,262 in all, FP-settleable. One settlement per run:
 * a partial ₹1 from the parent wallet, which the oldest month absorbs. It is a real
 * repayment and is reported, not reversed — there is no un-pay.
 *
 * ── Insufficient balance cannot happen naturally here ─────────────────────
 * Both wallets hold far more than the whole outstanding, so W-0088 / W-0089 rewrite the
 * SearchROSettlement response in the browser to present a ₹0.50 wallet — the screen's own
 * guard is what is under test. The server is not asked to pay.
 */

const OD_LOGIN_REFUSED = 'The lane\'s OD account (9999301778) is refused at sign-in with "Invalid username or password." for the configured password; the suite stops using it to avoid a lockout, so no OD session is available.';
const BRANCH = FUNDED.outstandingBranch;

let caPage: Page | undefined;
let baPage: Page | undefined;
test.afterEach(async ({}, testInfo) => attachOnFailure(testInfo, [caPage, baPage]));

async function asCustomer(sessionFor: (a: typeof LANES.financial.customerAdmin) => Promise<Page>): Promise<{ rcs: RoCreditSettlementPage; data: SettlementSearch }> {
  caPage = await sessionFor(LANES.financial.customerAdmin);
  const rcs = new RoCreditSettlementPage(caPage);
  const data = await rcs.open();
  return { rcs, data };
}

async function fpOutstandingByBranch(): Promise<Record<string, number>> {
  const rows = await DbHelper.query<{ CustomerId: string; Total: number }>(
    `SELECT b.CustomerId, SUM(b.Outstanding) AS Total
       FROM dbo.ROCreditMonthlyBalance b
       JOIN dbo.CustomerMaster cm ON cm.CustomerId = b.CustomerId
       JOIN dbo.CustomerMaster p ON p.Id = cm.ParentId
      WHERE p.CustomerId = @parent AND b.StatusFlag = 1 AND b.Outstanding > 0
      GROUP BY b.CustomerId`,
    { parent: FUNDED.parentId }
  );
  return Object.fromEntries(rows.map(r => [r.CustomerId, Number(r.Total)]));
}

async function monthOutstanding(customerId: string, year: number, month: number): Promise<number> {
  const rows = await DbHelper.query<{ Outstanding: number }>(
    `SELECT TOP 1 Outstanding FROM dbo.ROCreditMonthlyBalance WHERE CustomerId = @customerId AND [Year] = @year AND [Month] = @month AND ROCode = '47002TA002'`,
    { customerId, year, month }
  );
  return Number(rows[0]?.Outstanding ?? NaN);
}

/** Presents one wallet as too small to pay ₹1 — the guard under test is the screen's. */
async function withPoorWallet(page: Page, which: 'parent' | 'child'): Promise<void> {
  await page.unroute(`**${RoCreditSettlementPage.searchUrl}`);
  await page.route(`**${RoCreditSettlementPage.searchUrl}`, async (route: Route) => {
    const response = await route.fetch();
    const json = await response.json();
    if (which === 'parent') json.data.parentWalletBalance = 0.5;
    else {
      json.data.childWalletBalance = 0.5;
      for (const b of json.data.branches ?? []) b.walletBalance = 0.5;
    }
    await route.fulfill({ response, json });
  });
}

test.describe('v3 Financial — RO Credit Settlement', () => {
  test.describe.configure({ timeout: 180_000 });

  test(caseTitle(['W-0092', 'F-156'], 'page load as Customer Admin shows Customer ID, Name, outstanding records and wallet balance'), async ({ sessionFor }) => {
    caPage = await sessionFor(LANES.financial.customerAdmin);
    const responseP = caPage.waitForResponse(r => r.url().includes(RoCreditSettlementPage.searchUrl), { timeout: 60_000 });
    await openFromSidebar(caPage, 'RO Credit Management', RoCreditSettlementPage.route);
    await responseP;
    const rcs = new RoCreditSettlementPage(caPage);
    await expect(rcs.title, 'page heading').toHaveText(/RO Credit Settlement/i);
    await expect(rcs.customerId, 'Customer ID').toHaveValue(FUNDED.parentId);
    await expect(rcs.customerName, 'Customer Name').not.toHaveValue('');
    await expect(rcs.gridRows.first(), 'outstanding records').toBeVisible();
    await expect(rcs.walletBalance, 'Available Wallet Balance').toHaveText(/₹\s*[\d,]+/);
    expect(rupees(await rcs.walletBalance.innerText()), 'balance shown equals the ledger').toBeCloseTo(await walletBalance(FUNDED.parentId), 2);
  });

  test(caseTitle(['W-0095', 'F-159'], 'every FP-settleable branch is listed with the correct outstanding'), async ({ sessionFor }) => {
    const { rcs, data } = await asCustomer(sessionFor);
    const db = await fpOutstandingByBranch();
    observed(`DB FP outstanding by branch ${JSON.stringify(db)}; API ${JSON.stringify(data.branches)}`);
    expect(Object.keys(db).length, 'precondition: FP-settleable outstanding exists').toBeGreaterThan(0);
    for (const [branchUid, total] of Object.entries(db)) {
      const cells = await rcs.row(branchUid).locator('td').allInnerTexts();
      observed(`row ${branchUid}: ${cells.join(' | ')}`);
      expect(cells.length, `branch ${branchUid} must be listed`).toBeGreaterThan(5);
      expect(rupees(cells[4]), `branch ${branchUid}: Outstanding (FP Settleable) equals the ledger`).toBeCloseTo(total, 2);
    }
    expect(await rcs.gridRows.count(), 'no branch without FP outstanding is listed').toBe(Object.keys(db).length);
  });

  test(caseTitle(['W-0096', 'F-160'], 'every Offline-settleable branch is listed with the correct outstanding'), async ({ sessionFor }) => {
    const { rcs, data } = await asCustomer(sessionFor);
    const headers = (await rcs.grid.locator('thead th').allInnerTexts()).map(h => h.trim());
    expect(headers, 'the Offline Settleable column exists').toContain('Outstanding (Offline Settleable)');
    for (const b of data.branches) {
      const cells = await rcs.row(b.branchUid).locator('td').allInnerTexts();
      expect(rupees(cells[5]), `branch ${b.branchUid}: Offline Settleable equals the service figure`).toBeCloseTo(b.outstandingOffline, 2);
    }
    observed(`total offline outstanding ${data.totalOutstandingOffline}; per branch ${JSON.stringify(data.branches.map(b => [b.branchUid, b.outstandingOffline]))}`);
    if (data.totalOutstandingOffline === 0) deviation('No offline-settleable outstanding exists for the funded customer; the column is verified to render the service figure (₹0.00) for every branch.');
  });

  test(caseTitle(['W-0097', 'F-161', 'W-0098', 'F-162'], 'Pay opens the popup listing outlets and outstanding; Close returns to the settlement page'), async ({ sessionFor }) => {
    const { rcs, data } = await asCustomer(sessionFor);
    await rcs.openPay(BRANCH);
    const ros = data.roList.filter(r => r.branchUid === BRANCH);
    await expect(rcs.roCards, 'W-0097: one card per outlet with outstanding').toHaveCount(ros.length);
    for (const ro of ros) {
      const card = rcs.roCards.filter({ hasText: ro.roCode });
      await expect(card, `W-0097: outlet ${ro.roCode} listed`).toContainText(ro.roName);
      expect(rupees(await card.locator('.wallet-stat-card__body').innerText().then(t => (t.match(/₹[\d,.]+/) ?? ['0'])[0])), `W-0097: ${ro.roCode} outstanding`).toBeCloseTo(ro.outstandingFp, 2);
    }
    expect(rupees(await rcs.totalOutstanding.innerText()), 'W-0097: total outstanding').toBeCloseTo(ros.reduce((s, r) => s + r.outstandingFp, 0), 2);
    await rcs.closeButton.click();
    await expect(rcs.modalOpen, 'W-0098: popup closed').toHaveCount(0);
    await expect(rcs.gridRows.first(), 'W-0098: back on the settlement home page').toBeVisible();
    expect(caPage!.url()).toContain(RoCreditSettlementPage.route);
  });

  test(caseTitle(['W-0099', 'F-163', 'W-0100'], 'selecting an outlet opens payment; Full amount with every month selects the whole outstanding'), async ({ sessionFor }) => {
    const { rcs, data } = await asCustomer(sessionFor);
    await rcs.openPay(BRANCH);
    await rcs.selectRo(0);
    await expect(caPage!.locator('#rcsPaymentRoCode'), 'W-0099: the chosen outlet is carried into payment').toHaveText(data.roList[0].roCode);
    await rcs.full.check({ force: true });
    const months = data.monthlyBreakup.filter(m => m.branchUid === BRANCH && m.roCode === data.roList[0].roCode);
    await rcs.fullMonths.selectOption(String(months.length));
    await rcs.parentWallet.check({ force: true });
    const selected = rupees(await rcs.selectedTotal.innerText());
    const total = rupees(await rcs.breakupTotal.innerText());
    observed(`full amount, ${months.length} month(s): selected ₹${selected} of ₹${total}`);
    expect(selected, 'W-0100: full outstanding selected').toBeCloseTo(total, 2);
    expect(total, 'W-0100: total equals the outlet outstanding').toBeCloseTo(data.roList[0].outstandingFp, 2);
    await expect(rcs.continueButton, 'W-0100: ready to continue').toBeEnabled();
    await rcs.closeModal();
  });

  test(caseTitle(['W-0085', 'F-152', 'W-0086', 'F-153', 'W-0087', 'F-154'], 'partial amount: zero, negative and above-outstanding are refused with their messages'), async ({ sessionFor }) => {
    const { rcs, data } = await asCustomer(sessionFor);
    await rcs.openPay(BRANCH);
    await rcs.selectRo(0);

    await rcs.enterPartial('0');
    const zeroMsg = (await rcs.partialError.innerText().catch(() => '')).trim();
    observed(`0 -> "${zeroMsg}"`);
    expect(zeroMsg, 'W-0085: "Enter a valid partial settlement amount."').toMatch(/Enter a valid partial settlement amount/i);
    await expect(rcs.continueButton, 'W-0085: cannot continue').toBeDisabled();

    const kept = await rcs.enterPartial('-100');
    observed(`-100 -> field "${kept}"`);
    expect(kept, 'W-0086: the minus sign is restricted').not.toContain('-');

    const over = Math.ceil(data.roList[0].outstandingFp) + 500;
    await rcs.enterPartial(String(over));
    const overMsg = (await rcs.partialError.innerText().catch(() => '')).trim();
    observed(`${over} -> "${overMsg}"`);
    expect(overMsg, 'W-0087: "Partial amount cannot exceed (outstanding)."').toMatch(/Partial amount cannot exceed \(\s*[\d,]+\.\d{2}\s*\)/i);
    expect(overMsg, 'W-0087: names the actual outstanding').toContain(data.roList[0].outstandingFp.toLocaleString('en-IN', { minimumFractionDigits: 2 }));
    await expect(rcs.continueButton, 'W-0087: cannot continue').toBeDisabled();
    await rcs.closeModal();
  });

  for (const [ids, which] of [[['W-0088', 'F-155'], 'parent'], [['W-0089'], 'child']] as const) {
    test(caseTitle([...ids], `${which} wallet below the amount: Insufficient balance is shown and it cannot pay`), async ({ sessionFor }) => {
      caPage = await sessionFor(LANES.financial.customerAdmin);
      await withPoorWallet(caPage, which);
      try {
        const rcs = new RoCreditSettlementPage(caPage);
        await rcs.open();
        deviation(`The ${which} wallet balance presented to the screen was rewritten to ₹0.50 in the browser (the real wallets hold more than the whole outstanding); the screen's insufficient-balance guard is what is tested.`);
        await rcs.openPay(BRANCH);
        await rcs.selectRo(0);
        await rcs.enterPartial('1');
        const poor = which === 'parent' ? rcs.parentWallet : rcs.childWallet;
        const hint = which === 'parent' ? rcs.parentInsufficient : rcs.childInsufficient;
        await poor.check({ force: true }).catch(() => undefined);
        const state = { checked: await poor.isChecked(), disabled: await poor.isDisabled(), hint: await hint.isVisible(), continueEnabled: await rcs.continueButton.isEnabled(), partialError: (await rcs.partialError.innerText().catch(() => '')).trim() };
        observed(`${which} wallet ₹0.50, amount ₹1: ${JSON.stringify(state)}`);
        expect(state.checked, `the ${which} wallet cannot be chosen to pay`).toBe(false);
        await expect(hint, `"Insufficient balance" is displayed against the ${which} wallet`).toBeVisible();
        await expect(hint).toHaveText(/Insufficient balance/i);
        await rcs.closeModal();
      } finally {
        await caPage.unroute(`**${RoCreditSettlementPage.searchUrl}`);
      }
    });
  }

  test(caseTitle(['W-0101', 'W-0102', 'W-0090', 'W-0103', 'W-0104'], 'partial ₹1 is accepted, Continue asks for the OTP, a wrong OTP is refused, the right one pays and the parent wallet is debited'), async ({ sessionFor }) => {
    const { rcs, data } = await asCustomer(sessionFor);
    const oldest = data.monthlyBreakup.filter(m => m.branchUid === BRANCH).sort((a, b) => a.year * 12 + a.month - (b.year * 12 + b.month))[0];
    const parentBefore = await walletBalance(FUNDED.parentId);
    const monthBefore = await monthOutstanding(BRANCH, oldest.year, oldest.month);

    await rcs.openPay(BRANCH);
    await rcs.selectRo(0);
    await rcs.enterPartial('1');
    await expect(rcs.partialError, 'W-0101: ₹1 accepted — no partial-amount error').toHaveCount(0);
    expect(rupees(await rcs.selectedTotal.innerText()), 'W-0101: ₹1 selected').toBeCloseTo(1, 2);
    await rcs.parentWallet.check({ force: true });
    await expect(rcs.continueButton, 'W-0101: can continue').toBeEnabled();

    const otp = await transactionOtp(FUNDED.mobile);
    await rcs.continueButton.click();
    await expect(rcs.otpSection, 'W-0102: the OTP entry is shown').toBeVisible({ timeout: 20_000 });
    await expect(rcs.otpInput, 'W-0102: OTP box in view').toBeInViewport({ timeout: 10_000 });
    const code = await otp();

    await rcs.otpInput.fill(code === '000000' ? '111111' : '000000');
    await rcs.payButton.click();
    await expect(rcs.otpError, 'W-0090: an invalid OTP is refused with a message').toBeVisible({ timeout: 20_000 });
    const invalidMsg = (await rcs.otpError.innerText()).trim();
    observed(`wrong OTP -> "${invalidMsg}"`);
    expect(invalidMsg, 'W-0090: Invalid OTP message').toMatch(/invalid|incorrect|wrong/i);
    expect(await walletBalance(FUNDED.parentId), 'W-0090: nothing paid on a wrong OTP').toBeCloseTo(parentBefore, 2);

    await rcs.otpInput.fill(code);
    const payP = caPage!.waitForResponse(r => r.url().includes(RoCreditSettlementPage.payUrl), { timeout: 60_000 });
    await rcs.payButton.click();
    const pay = await payP;
    observed(`PayRoOutstanding ${pay.status()}: ${(await pay.text()).slice(0, 300)}`);
    const shown = await rcs.dialogs.next(30_000);
    observed(`dialog ${JSON.stringify(shown)}`);
    expect(shown?.kind, 'W-0103: payment successful').toBe('success');
    expect(shown?.text, 'W-0103: success message').toMatch(/Payment of .*1\.00.* was Successful/i);
    await rcs.dialogs.dismissAll();

    const parentAfter = await waitForBalance(FUNDED.parentId, round2(parentBefore - 1));
    const monthAfter = await monthOutstanding(BRANCH, oldest.year, oldest.month);
    test.info().annotations.push({ type: 'money', description: `RO settlement ₹1: parent ${parentBefore}->${parentAfter}; ${BRANCH} ${oldest.monthLabel} outstanding ${monthBefore}->${monthAfter}` });
    expect(parentAfter, 'W-0104: parent wallet reduced by the payment').toBeCloseTo(round2(parentBefore - 1), 2);
    expect(monthAfter, 'W-0103: the oldest month\'s outstanding reduced by ₹1').toBeCloseTo(round2(monthBefore - 1), 2);
  });

  test(caseTitle(['W-0093', 'F-157'], 'page load as Branch Admin shows Customer ID, Name, outstanding records and wallet balance'), async ({ sessionFor }) => {
    baPage = await sessionFor(LANES.financial.branchAdmin);
    caPage = undefined;
    const rcs = new RoCreditSettlementPage(baPage);
    const data = await rcs.open();
    observed(`branch view: ${JSON.stringify({ customerId: data.customerId, name: data.customerName, branches: data.branches, child: data.childWalletBalance })}`);
    await expect(rcs.title).toHaveText(/RO Credit Settlement/i);
    await expect(rcs.customerId, 'Customer ID').not.toHaveValue('');
    await expect(rcs.customerName, 'Customer Name').not.toHaveValue('');
    await expect(rcs.walletBalance, 'Available Wallet Balance').toHaveText(/₹\s*[\d,]+/);
    await expect(rcs.gridRows.first(), 'outstanding records').toBeVisible();
    const shownId = await rcs.customerId.inputValue();
    expect(rupees(await rcs.walletBalance.innerText()), 'balance shown is the signed-in wallet\'s ledger balance').toBeCloseTo(await walletBalance(shownId), 2);
  });

  notExecutable(['W-0094', 'F-158'], 'page load for an OD customer', OD_LOGIN_REFUSED);

  test(caseTitle(['W-0091'], 'an OTP submitted after it expired is refused'), async ({ sessionFor }) => {
    test.setTimeout(16 * 60_000);
    const { rcs } = await asCustomer(sessionFor);
    const parentBefore = await walletBalance(FUNDED.parentId);
    await rcs.openPay(BRANCH);
    await rcs.selectRo(0);
    await rcs.enterPartial('1');
    await rcs.parentWallet.check({ force: true });
    const otp = await transactionOtp(FUNDED.mobile);
    await rcs.continueButton.click();
    await expect(rcs.otpSection).toBeVisible({ timeout: 20_000 });
    const generateError = (await rcs.otpError.innerText().catch(() => '')).trim();
    test.skip(/wait/i.test(generateError), `the OTP could not be issued: "${generateError}"`);
    const code = await otp();
    const validity = Number(await caPage!.locator('#roCreditSettlementPageRoot').getAttribute('data-rcs-otp-validity-seconds')) || 600;
    observed(`OTP validity ${validity}s; waiting it out`);
    await caPage!.waitForTimeout((validity + 15) * 1000);
    const timer = (await caPage!.locator('#rcsPayOtpExpiryTimer').innerText()).trim();
    await rcs.otpInput.fill(code);
    await rcs.payButton.click().catch(() => undefined);
    await expect(rcs.otpError).toBeVisible({ timeout: 20_000 });
    const screenMsg = (await rcs.otpError.innerText()).trim();
    // The server's own verdict on the stale code, independent of the page's countdown.
    const server = await caPage!.evaluate(async ([cid, otpCode]) => {
      const res = await fetch('/Customer/RoCreditSettlementValidateOtp', { method: 'POST', headers: { 'Content-Type': 'application/json; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest' }, body: JSON.stringify({ customerId: cid, otp: otpCode }) });
      return res.text();
    }, [FUNDED.parentId, code] as const);
    observed(`timer "${timer}"; screen "${screenMsg}"; server ${server.slice(0, 300)}`);
    expect(screenMsg, 'the expiry is reported (OTP Expired)').toMatch(/expired/i);
    expect(server, 'the server also refuses the expired OTP').not.toMatch(/"otpValid"\s*:\s*true/i);
    expect(await walletBalance(FUNDED.parentId), 'nothing paid').toBeCloseTo(parentBefore, 2);
    await rcs.closeModal();
  });
});
