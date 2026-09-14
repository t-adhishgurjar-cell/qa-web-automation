/**
 * The accounts the suites log in as.
 *
 * Every spec previously carried its own `process.env.X ?? 'loadtest_006'` pair.
 * They happened to agree, which is the problem: three independent defaults that
 * look interchangeable but are not checked against each other, so pointing the
 * suite at a different account meant finding all of them.
 *
 * There is one real account behind both roles today — loadtest_006, an FP_ADMIN
 * in the Nayara category — but they are named separately because they are
 * different capabilities. An environment where the customer-onboarding account
 * is not also a Nayara admin should need one env var, not a code change.
 *
 * Note what this being one account means for the results: the same user acts as
 * maker and as checker during onboarding, so four-eyes separation is never
 * exercised. That is recorded in the traceability report rather than left for a
 * reader to notice.
 */

export interface Account {
  username: string;
  password: string;
  /** What this account is expected to be, for error messages when it is not. */
  role: string;
}

const DEFAULT_USER = 'loadtest_006';
const DEFAULT_PASS = 'Nayara@1';

/** Creates users through Add User. Must be entitled to the User module. */
export const FP_ADMIN: Account = {
  username: process.env.FP_ADMIN_USER ?? DEFAULT_USER,
  password: process.env.FP_ADMIN_PASS ?? DEFAULT_PASS,
  role: 'FP_ADMIN',
};

/**
 * Onboards and approves customers.
 *
 * The wizard's footer controls do not render for every entitled role — DSA and
 * TSM accounts can open it but not submit — so this is configured separately
 * rather than taken from the credentials sheet.
 */
export const CUSTOMER_ADMIN: Account = {
  username: process.env.CUSTOMER_ADMIN_USER ?? DEFAULT_USER,
  password: process.env.CUSTOMER_ADMIN_PASS ?? DEFAULT_PASS,
  role: 'Customer onboarding',
};

/**
 * A customer's own Parent Admin.
 *
 * Not a Nayara account: this is a real customer's login, owning a real customer
 * with real branches. It matters because usp_InsertCustomerBranchRequestByWeb
 * treats it differently from an FP Admin — a parent admin's branches
 * auto-approve only while the customer is under MaxBranchAllowed, and route to
 * the approval queue at status 108 beyond it. An FP Admin is never capped.
 *
 * The mobile carries four roles — one CUSTOMER_ADMIN and three BRANCH_ADMIN —
 * so login must choose, which is why the role code is part of the account
 * rather than left to whichever card renders first.
 */
export const PARENT_ADMIN: Account & { roleCode: string; ownCustomerId: string } = {
  username: process.env.PARENT_ADMIN_USER ?? process.env.TEST_USERNAME ?? '9999303778',
  password: process.env.PARENT_ADMIN_PASS ?? process.env.TEST_PASSWORD ?? '',
  role: 'Parent Admin',
  roleCode: process.env.PARENT_ADMIN_ROLE ?? 'CUSTOMER_ADMIN',
  /** The customer this admin owns. Branches are added under it. */
  ownCustomerId: process.env.PARENT_ADMIN_CUSTOMER ?? 'NAYAFP1020900195',
};

/** The branch cap, from ConfigurationMaster.MaxBranchAllowed. */
export const MAX_BRANCH_ALLOWED = Number(process.env.MAX_BRANCH_ALLOWED ?? 5);

/** The OTP every QA account accepts. */
export const TEST_OTP = process.env.TEST_OTP ?? '123456';
