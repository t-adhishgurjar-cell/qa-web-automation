import * as fs from 'fs';
import * as path from 'path';
import type { Page } from '@playwright/test';
import { test, expect } from '../../../src/fixtures/session.fixtures';
import { LANES } from '../../../src/config/test-accounts';
import { caseTitle, notExecutable, REASON } from '../../../src/helpers/v3-sheet.helper';
import { DbHelper } from '../../../src/helpers/db.helper';
import { FuelVoucherPage, BULK_HEADER, dmy, ymd } from '../../../src/pages/v3/financial/fuel-voucher.page';
import { writeWorkbook } from '../../../src/pages/v3/financial/sfl-claim.page';
import { FUNDED, walletBalance, waitForBalance, round2, maxVoucherId, vouchersIssuedSince } from '../../../src/pages/v3/financial/finance-data';
import { attachOnFailure, observed, deviation } from '../../../src/pages/v3/financial/evidence';

/**
 * Fuel Voucher — v3 sheet W-0117..W-0126 and F-164..F-171, as the funded FO parent
 * (Customer Admin, 9999303778, NAYAFP1020900195).
 *
 * ── Money ─────────────────────────────────────────────────────────────────
 * Every voucher is ₹1 (the sheet's ₹700 / ₹300 are illustrative) and every voucher a test
 * issues is cancelled in the same test, which refunds the issuer — the afterEach sweeps any
 * that a failing test left behind. The ledger is read before and after.
 *
 * ── Recipients ────────────────────────────────────────────────────────────
 * FO and OD: 9999301778, the lane's OD mobile, which holds both an FO parent
 * (NAYAFP1020900045) and an OD parent (NAYAFP3023400268). NFO: QA's newest active NFO
 * parent, NAYAFP1023400354 (9878987800) — it receives ₹1 vouchers that are cancelled at once.
 */

const OD_MOBILE = '9999301778';
const FO_RECIPIENT = { mobile: OD_MOBILE, customerId: 'NAYAFP1020900045', type: 'FO' };
const OD_RECIPIENT = { mobile: OD_MOBILE, customerId: 'NAYAFP3023400268', type: 'OD' };
const NFO_RECIPIENT = { mobile: '9878987800', customerId: 'NAYAFP1023400354', type: 'NFO' };
/** A branch (child) of the FO recipient. */
const CHILD_OF_RECIPIENT = 'NAYAFP2020900046';

let caPage: Page | undefined;
let voucherBase = 0;

test.beforeEach(async () => { voucherBase = await maxVoucherId(); });

test.afterEach(async ({}, testInfo) => {
  await attachOnFailure(testInfo, [caPage]);
  // Sweep: cancel anything this test issued and left active, so the wallet is refunded.
  const left = (await vouchersIssuedSince(FUNDED.parentId, voucherBase)).filter(v => v.VoucherStatus === 601);
  if (left.length && caPage && !caPage.isClosed()) {
    const fv = new FuelVoucherPage(caPage);
    await fv.navigateTo(FuelVoucherPage.manageRoute);
    for (const v of left) {
      const code = (await DbHelper.query<{ VoucherCode: string }>(`SELECT VoucherCode FROM dbo.FuelVoucherDetails WHERE ID = @id`, { id: v.ID }))[0]?.VoucherCode;
      if (code) await fv.cancelViaService(code);
    }
    testInfo.annotations.push({ type: 'cleanup', description: `cancelled ${left.length} voucher(s) left active` });
  }
});

async function asCustomer(sessionFor: (a: typeof LANES.financial.customerAdmin) => Promise<Page>): Promise<FuelVoucherPage> {
  caPage = await sessionFor(LANES.financial.customerAdmin);
  return new FuelVoucherPage(caPage);
}

async function voucherCode(id: string): Promise<string> {
  return (await DbHelper.query<{ VoucherCode: string }>(`SELECT VoucherCode FROM dbo.FuelVoucherDetails WHERE ID = @id`, { id }))[0].VoucherCode;
}

/** Cancels through the Manage Fuel Voucher screen's own request and checks the refund landed. */
async function cancelAll(fv: FuelVoucherPage, ids: string[]): Promise<void> {
  await fv.navigateTo(FuelVoucherPage.manageRoute);
  for (const id of ids) {
    const r = await fv.cancelViaService(await voucherCode(id));
    expect(r.success, `voucher ${id} cancelled (${r.message ?? ''})`).toBe(true);
  }
}

function bulkFile(name: string, rows: Array<[string, string, string, string]>): string {
  return writeWorkbook(test.info().outputPath('vouchers'), name, BULK_HEADER, rows);
}

/** Upload → Submit → (server validation) → confirmation Yes. Returns the last dialog seen. */
async function submitBulk(fv: FuelVoucherPage, file: string): Promise<{ kind: string; text: string } | null> {
  await fv.openBulk();
  await fv.uploadBulk(file);
  const parse = await fv.dialogs.next(3_000, ['failure', 'error']);
  if (parse) return parse;
  await fv.bulkSubmit.click();
  const first = await fv.dialogs.next(30_000);
  if (first?.kind !== 'confirmation') return first;
  await fv.dialogs.confirmYes.click();
  return fv.dialogs.next(60_000, ['success', 'failure', 'error']);
}

test.describe('v3 Financial — Fuel Voucher', () => {
  test.describe.configure({ timeout: 240_000 });

  test(caseTitle(['W-0122', 'F-169', 'W-0126'], 'the FO parent issues a voucher to an OD parent: confirmation shown, balance deducted'), async ({ sessionFor }) => {
    const fv = await asCustomer(sessionFor);
    await fv.openGenerate();
    const before = await walletBalance(FUNDED.parentId);
    const ids = await fv.enterRecipient(OD_RECIPIENT.mobile);
    observed(`recipient ${OD_RECIPIENT.mobile} offers ${JSON.stringify(ids)}; lookup ${fv.lastLookup.slice(0, 400)}`);
    expect(ids.join(' '), 'the OD parent is offered for that mobile').toContain(OD_RECIPIENT.customerId);
    await fv.chooseRecipientCustomer(OD_RECIPIENT.customerId);
    await fv.amount.fill('1');
    await fv.validThrough.fill(ymd(2));
    await fv.generate.click();
    const confirm = await fv.dialogs.next(20_000);
    observed(`before generate: ${JSON.stringify(confirm)}`);
    expect(confirm?.kind, 'a confirmation is asked').toBe('confirmation');
    await fv.dialogs.confirmYes.click();
    const shown = await fv.dialogs.next(30_000, ['success', 'failure', 'error']);
    observed(`generate: ${JSON.stringify(shown)}`);
    expect(shown?.kind, 'W-0122: voucher issued').toBe('success');
    expect(shown?.text, 'W-0122: confirmation message').toMatch(/created successfully/i);

    const issued = await vouchersIssuedSince(FUNDED.parentId, voucherBase);
    observed(`issued ${JSON.stringify(issued)}`);
    expect(issued, 'one voucher recorded').toHaveLength(1);
    expect(issued[0].RecipientCustomerId, 'to the OD parent').toBe(OD_RECIPIENT.customerId);
    expect(Number(issued[0].Amount), 'for ₹1').toBe(1);
    const after = await waitForBalance(FUNDED.parentId, round2(before - 1));
    expect(after, 'W-0126: the issuer balance is deducted by the voucher amount').toBeCloseTo(round2(before - 1), 2);

    await cancelAll(fv, issued.map(v => v.ID));
    const refunded = await waitForBalance(FUNDED.parentId, before);
    test.info().annotations.push({ type: 'money', description: `voucher ₹1 issued and cancelled: ${before} -> ${after} -> ${refunded}` });
    expect(refunded, 'cancelling refunds the voucher').toBeCloseTo(before, 2);
  });

  notExecutable(['W-0123', 'F-170'], 'an NFO parent issues a voucher to an OD parent', `${REASON.ROLE_MISSING} The financial lane holds an FO parent (9999303778) only; no NFO parent login is configured.`);

  test(caseTitle(['W-0120', 'F-167'], 'a valid bulk upload with FO, NFO and OD recipients issues all three'), async ({ sessionFor }) => {
    const fv = await asCustomer(sessionFor);
    const before = await walletBalance(FUNDED.parentId);
    const rows = [FO_RECIPIENT, NFO_RECIPIENT, OD_RECIPIENT].map(r => [r.mobile, r.customerId, '1', dmy(2)] as [string, string, string, string]);
    const shown = await submitBulk(fv, bulkFile('AUTO_V3_bulk_3.xlsx', rows));
    observed(`bulk 3: ${JSON.stringify(shown)}`);
    const issued = await vouchersIssuedSince(FUNDED.parentId, voucherBase);
    observed(`issued ${JSON.stringify(issued.map(v => [v.RecipientMobileNo, v.RecipientCustomerId, v.Amount, v.VoucherStatus]))}`);
    expect(shown?.kind, 'success message').toBe('success');
    for (const r of [FO_RECIPIENT, NFO_RECIPIENT, OD_RECIPIENT]) {
      expect(issued.some(v => v.RecipientCustomerId === r.customerId), `${r.type} row processed — voucher created`).toBe(true);
    }
    expect(await walletBalance(FUNDED.parentId), 'three ₹1 vouchers deducted').toBeCloseTo(round2(before - 3), 2);
    await cancelAll(fv, issued.map(v => v.ID));
    expect(await waitForBalance(FUNDED.parentId, before), 'all refunded on cancel').toBeCloseTo(before, 2);
  });

  test(caseTitle(['W-0121', 'F-168'], '50 valid rows upload successfully within 30 seconds'), async ({ sessionFor }) => {
    test.setTimeout(8 * 60_000);
    const fv = await asCustomer(sessionFor);
    const before = await walletBalance(FUNDED.parentId);
    const mix = [FO_RECIPIENT, NFO_RECIPIENT, OD_RECIPIENT];
    const rows = Array.from({ length: 50 }, (_, i) => [mix[i % 3].mobile, mix[i % 3].customerId, '1', dmy(2)] as [string, string, string, string]);
    const file = bulkFile('AUTO_V3_bulk_50.xlsx', rows);
    await fv.openBulk();
    const t0 = Date.now();
    await fv.uploadBulk(file);
    // The page validates every recipient mobile with the server, then the whole sheet
    // (ValidateBulkVoucherMobiles), before it previews; a refusal arrives as an error dialog.
    const previewed = caPage!.getByText(/Total Vouchers:\s*50\b/);
    const outcome = await Promise.race([
      previewed.waitFor({ state: 'visible', timeout: 180_000 }).then(() => null),
      fv.dialogs.next(180_000, ['failure', 'error']),
    ]);
    observed(`after upload (${Date.now() - t0} ms): ${outcome ? JSON.stringify(outcome) : 'previewed'}`);
    expect(outcome, 'all 50 rows are accepted for upload').toBeNull();
    const tPreview = Date.now() - t0;
    await fv.bulkSubmit.click();
    const confirm = await fv.dialogs.next(60_000);
    expect(confirm?.kind, 'server validation passes and asks to confirm').toBe('confirmation');
    const t1 = Date.now();
    await fv.dialogs.confirmYes.click();
    const shown = await fv.dialogs.next(120_000, ['success', 'failure', 'error']);
    const tIssue = Date.now() - t1;
    const issued = await vouchersIssuedSince(FUNDED.parentId, voucherBase);
    observed(`preview ${tPreview} ms, issue ${tIssue} ms, total ${Date.now() - t0} ms; result ${JSON.stringify(shown)}; vouchers ${issued.length}`);
    test.info().annotations.push({ type: 'timing', description: `50-row upload: preview ${tPreview} ms, issue ${tIssue} ms` });
    expect(shown?.kind, 'success').toBe('success');
    expect(issued.length, 'all 50 vouchers created').toBe(50);
    expect(tPreview + tIssue, 'within 30 seconds').toBeLessThanOrEqual(30_000);
    await cancelAll(fv, issued.map(v => v.ID));
    expect(await waitForBalance(FUNDED.parentId, before, 60_000), 'all refunded').toBeCloseTo(before, 2);
  });

  test(caseTitle(['W-0117', 'F-164'], 'a Child Customer ID in the recipient column is rejected with a message and no voucher'), async ({ sessionFor }) => {
    const fv = await asCustomer(sessionFor);
    const before = await walletBalance(FUNDED.parentId);
    const shown = await submitBulk(fv, bulkFile('AUTO_V3_bulk_child.xlsx', [[FO_RECIPIENT.mobile, CHILD_OF_RECIPIENT, '1', dmy(2)]]));
    observed(`child id: ${JSON.stringify(shown)}`);
    expect(shown?.kind, 'rejected').not.toBe('success');
    expect(shown?.text, 'a proper error message').toBeTruthy();
    expect(await vouchersIssuedSince(FUNDED.parentId, voucherBase), 'no voucher created').toHaveLength(0);
    expect(await walletBalance(FUNDED.parentId), 'nothing deducted').toBeCloseTo(before, 2);
  });

  test(caseTitle(['W-0118', 'F-165'], 'a past validity date is rejected'), async ({ sessionFor }) => {
    const fv = await asCustomer(sessionFor);
    const shown = await submitBulk(fv, bulkFile('AUTO_V3_bulk_past.xlsx', [[OD_RECIPIENT.mobile, OD_RECIPIENT.customerId, '1', dmy(-3)]]));
    observed(`past date: ${JSON.stringify(shown)}; preview rows ${await fv.bulkRows.count()}`);
    expect(shown?.kind, 'rejected').not.toBe('success');
    if (shown && !/Validity date cannot be in the past/i.test(shown.text)) deviation(`Message reads "${shown.text}" rather than "Validity date cannot be in the past."`);
    expect(shown?.text, 'the message says the date cannot be in the past').toMatch(/cannot be (in the past|earlier than today)/i);
    expect(await vouchersIssuedSince(FUNDED.parentId, voucherBase), 'no voucher created').toHaveLength(0);
  });

  test(caseTitle(['W-0119', 'F-166'], '.csv and .pdf files are rejected; only Excel is accepted'), async ({ sessionFor }) => {
    const fv = await asCustomer(sessionFor);
    const dir = test.info().outputPath('vouchers');
    fs.mkdirSync(dir, { recursive: true });
    for (const ext of ['csv', 'pdf']) {
      await fv.openBulk();
      const file = path.join(dir, `AUTO_V3_bulk.${ext}`);
      fs.writeFileSync(file, ext === 'csv' ? `${BULK_HEADER.join(',')}\n${OD_MOBILE},${OD_RECIPIENT.customerId},1,${dmy(2)}\n` : '%PDF-1.4\n%AUTO_V3\n');
      await fv.uploadBulk(file);
      const shown = await fv.dialogs.next(10_000);
      observed(`.${ext}: ${JSON.stringify(shown)}; preview rows ${await fv.bulkRows.count()}`);
      expect(shown?.kind, `.${ext} rejected`).toMatch(/failure|error/);
      expect(shown?.text, `.${ext}: invalid file format message`).toMatch(/Excel file/i);
      await fv.dialogs.dismissAll();
      await expect(fv.bulkRows, `.${ext}: nothing loaded`).toHaveCount(0);
    }
    expect(await vouchersIssuedSince(FUNDED.parentId, voucherBase), 'no voucher created').toHaveLength(0);
  });

  notExecutable(['W-0124', 'F-171'], 'the recipient parent redeems an active voucher before expiry',
    'Needs an active voucher addressed to a lane account and that recipient\'s login: 9999303778 holds no active received voucher in QA (its only one, #340, is already redeemed), and the lane\'s other customer, OD 9999301778, cannot sign in ("Invalid username or password.").');

  notExecutable(['W-0125'], 'redeeming a voucher after its expiry date is blocked', REASON.SYSTEM_DATE);
});
