import type { SessionAccount } from '../fixtures/session.fixtures';

/**
 * Accounts for the feature areas the suites run in.
 *
 * Each area (financial, vehicle, ro, loyalty, customer) owns its logins outright. FleetPlus
 * allows one live session per user, and signing in as a Branch Admin ends the Customer Admin
 * session on the same mobile, so two areas sharing a login would log each other out and the
 * failures would read as product defects. Giving every area a distinct FP Admin and a
 * distinct customer mobile is what lets them run at the same time.
 *
 * Every value can be overridden from the environment (V3_<AREA>_<ROLE>_USER / _PASS; the
 * V3_ prefix is kept so existing run scripts keep working).
 */

const pass = (key: string, fallback: string) => process.env[key] ?? fallback;
const acct = (lane: string, roleKey: string, username: string, password: string, role: string, roleCode?: string): SessionAccount => ({
  username: process.env[`V3_${lane}_${roleKey}_USER`] ?? username,
  password: process.env[`V3_${lane}_${roleKey}_PASS`] ?? password,
  role,
  ...(roleCode ? { roleCode } : {}),
});

const NAYARA = 'Nayara@1';
/** 9999303778 — the customer with wallet balance and RO credit, for the money flows. */
const FUNDED = pass('TEST_PASSWORD', '');

export const LANES = {
  /** Wallet recharge (PG, SBI net banking), fund transfer, RO credit, voucher, SFL, suspense, EFT. */
  financial: {
    fpAdmin: acct('FIN', 'FP', '9061909500', NAYARA, 'FP Admin'),
    customerAdmin: acct('FIN', 'CA', '9999303778', FUNDED, 'Customer Admin', 'CUSTOMER_ADMIN'),
    branchAdmin: acct('FIN', 'BA', '9999303778', FUNDED, 'Branch Admin', 'BRANCH_ADMIN'),
    od: acct('FIN', 'OD', '9999301778', NAYARA, 'OD customer', 'OD'),
  },
  /** Vehicle Mgmt — the customer the vehicle suites already use. */
  vehicle: {
    fpAdmin: acct('VEH', 'FP', '9062098801', NAYARA, 'FP Admin'),
    customerAdmin: acct('VEH', 'CA', '9200000000', pass('PARENT_ADMIN_PASS', ''), 'Customer Admin', 'CUSTOMER_ADMIN'),
    branchAdmin: acct('VEH', 'BA', '9200000000', pass('PARENT_ADMIN_PASS', ''), 'Branch Admin', 'BRANCH_ADMIN'),
  },
  /** RO Mgmt, Dealer/RO bank, EDFS. */
  ro: {
    fpAdmin: acct('RO', 'FP', '9062239102', NAYARA, 'FP Admin'),
    roAdmin: acct('RO', 'RO', '9018958500', NAYARA, 'RO Admin'),
  },
  /** Loyalty, Admin (roles, saving tickets, mobile roles), Reports. */
  loyalty: {
    fpAdmin: acct('LOY', 'FP', 'loadtest07', NAYARA, 'FP Admin'),
  },
  /** Customer Mgmt, User Mgmt, Security (Credit PIN), Login & Auth. */
  customer: {
    fpAdmin: acct('CUS', 'FP', process.env.V3_CUS_FP_DEFAULT ?? 'loadtest06', NAYARA, 'FP Admin'),
    customerAdmin: acct('CUS', 'CA', '9876500010', NAYARA, 'Customer Admin', 'CUSTOMER_ADMIN'),
    branchAdmin: acct('CUS', 'BA', '9876500010', NAYARA, 'Branch Admin', 'BRANCH_ADMIN'),
  },
} as const;
