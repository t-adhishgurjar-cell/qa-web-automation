import { DbHelper } from '../../../helpers/db.helper';
import { createOtpReader } from '../../../helpers/sms-otp.helper';

/**
 * Database reads and fixed data for the v3 financial lane.
 *
 * Every money assertion in the lane is made against dbo.CustomerLedger.PrepaidBalance,
 * not against the figure a screen prints: the screens format, round and sometimes
 * update optimistically, and the ledger is what the next transaction will be checked
 * against.
 */

/** The funded customer behind LANES.financial (9999303778). */
export const FUNDED = {
  mobile: '9999303778',
  parentId: 'NAYAFP1020900195',
  /** Branch 01_Dadri — the one branch with RO credit outstanding and a healthy wallet. */
  outstandingBranch: 'NAYAFP2020900196',
  /** Branch 01_GAUTAM BUDDHA NAGAR — zero balance; the scratch wallet for ₹1 transfers. */
  scratchBranch: 'NAYAFP2107000202',
} as const;

/**
 * A different customer, for the data-isolation case. NAYAFP1020900045 (Gurjar transport)
 * belongs to 9999301778, the lane's own OD mobile, so if the server ever honoured a
 * tampered Customer ID the side effect would land on a lane account, not a stranger's.
 */
export const FOREIGN_CUSTOMER = 'NAYAFP1020900045';

export async function walletBalance(customerId: string): Promise<number> {
  const rows = await DbHelper.query<{ PrepaidBalance: number | null }>(
    `SELECT TOP 1 PrepaidBalance FROM dbo.CustomerLedger WHERE CustomerID = @customerId`,
    { customerId }
  );
  return Number(rows[0]?.PrepaidBalance ?? 0);
}

export async function walletBalances(...ids: string[]): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const id of ids) out[id] = await walletBalance(id);
  return out;
}

/** Polls until the ledger shows `expected` (to the paisa) or the timeout passes; returns the last value. */
export async function waitForBalance(customerId: string, expected: number, timeout = 20_000): Promise<number> {
  const deadline = Date.now() + timeout;
  let last = await walletBalance(customerId);
  while (Date.now() < deadline && Math.abs(last - expected) > 0.001) {
    await new Promise(r => setTimeout(r, 1_000));
    last = await walletBalance(customerId);
  }
  return last;
}

export const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * An OTP source for a transaction OTP (fund transfer, RO settlement) on `mobile`.
 *
 * Call BEFORE the action that sends the OTP. The QA whitelist issues 123456 for the lane's
 * numbers and still logs the SMS, so the logged code is used when there is one and the
 * whitelisted value otherwise.
 */
export async function transactionOtp(mobile: string, timeout = 15_000): Promise<() => Promise<string>> {
  const read = await createOtpReader(mobile, 'Any', timeout);
  return async () => read().catch(() => process.env.TEST_OTP || '123456');
}

/** Status codes of dbo.FuelVoucherDetails.VoucherStatus, as the screens label them. */
export const VOUCHER_STATUS = { 601: 'Active', 602: 'Cancelled', 603: 'Expired', 604: 'Redeemed' } as const;

export interface VoucherRow {
  ID: string;
  CustomerId: string;
  Amount: number;
  RecipientMobileNo: string;
  RecipientCustomerId: string | null;
  VoucherStatus: number;
  VoucherExpiry: Date;
  CreatedOn: Date;
}

export async function vouchersIssuedSince(customerId: string, sinceId: number): Promise<VoucherRow[]> {
  return DbHelper.query<VoucherRow>(
    `SELECT ID, CustomerId, Amount, RecipientMobileNo, RecipientCustomerId, VoucherStatus, VoucherExpiry, CreatedOn
       FROM dbo.FuelVoucherDetails WHERE CustomerId = @customerId AND ID > @sinceId ORDER BY ID`,
    { customerId, sinceId }
  );
}

export async function maxVoucherId(): Promise<number> {
  const rows = await DbHelper.query<{ M: number | null }>(`SELECT MAX(CAST(ID AS BIGINT)) AS M FROM dbo.FuelVoucherDetails`);
  return Number(rows[0]?.M ?? 0);
}
