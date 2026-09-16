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
export const ONBOARDING_MAKER: Account = {
  username: process.env.ONBOARDING_MAKER_USER ?? process.env.CUSTOMER_ADMIN_USER ?? DEFAULT_USER,
  password: process.env.ONBOARDING_MAKER_PASS ?? process.env.CUSTOMER_ADMIN_PASS ?? DEFAULT_PASS,
  role: 'Customer onboarding',
};

/**
 * Formerly exported as CUSTOMER_ADMIN, which was wrong and actively
 * misleading. It never held a Customer Admin: it is loadtest_006, the FP
 * Admin, named for the capability of running the onboarding wizard. Reading
 * the name at face value led me to report that no Customer Admin account
 * existed and that maker and checker were the same person for the wrong
 * reason.
 *
 * The real Customer Admin is 9200000000 — PARENT_ADMIN below.
 *
 * @deprecated Use ONBOARDING_MAKER for the wizard, or PARENT_ADMIN for an
 * actual Customer Admin. Kept so nothing breaks mid-change.
 */
export const CUSTOMER_ADMIN: Account = ONBOARDING_MAKER;

/**
 * A customer's own administrators — one mobile, two roles.
 *
 * 9200000000 holds eight Users rows against a single mobile: one Customer Admin
 * (Users.Id 230373, IsParentUser true, UserTypeId 10) and seven Branch Admins
 * (UserTypeId 11), all active. That is why the login page offers a choice of
 * cards, and why roleCode is part of the account rather than left to whichever
 * card happens to render first — taking the default would silently walk a
 * branch admin's smaller menu while the test claims to be a parent.
 *
 * The customer is NAYAFP1023400246 (CustomerMaster.Id 209136), confirmed
 * working for Add Branch. It currently holds seven live branches at status 101
 * under a MaxBranchAllowed of 5 — see the boundary note in
 * add-branch-parent-admin.spec.ts for why that is not a contradiction.
 *
 * This matters to Add Branch because usp_InsertCustomerBranchRequestByWeb
 * treats these roles differently from an FP Admin: a parent admin's branches
 * auto-approve only under the cap and route to the approval queue at status 108
 * beyond it, while an FP Admin is never capped.
 */
export const PARENT_ADMIN: Account & { roleCode: string; ownCustomerId: string } = {
  username: process.env.PARENT_ADMIN_USER ?? '9200000000',
  password: process.env.PARENT_ADMIN_PASS ?? process.env.TEST_PASSWORD ?? '',
  role: 'Parent Admin',
  roleCode: process.env.PARENT_ADMIN_ROLE ?? 'CUSTOMER_ADMIN',
  /** The customer this admin owns. Branches are added under it. */
  ownCustomerId: process.env.PARENT_ADMIN_CUSTOMER ?? 'NAYAFP1023400246',
};

/**
 * The same mobile, signed in as one of its branch administrators.
 *
 * Deliberately a separate export rather than an override of PARENT_ADMIN: the
 * two are different capabilities on the same credentials, and a test that wants
 * the branch view should say so rather than mutate a shared constant.
 *
 * Which of the seven branches a login lands on is whichever BRANCH_ADMIN card
 * renders first, so anything asserting against a specific branch must read the
 * branch from the session rather than assume one.
 */
export const BRANCH_ADMIN: Account & { roleCode: string; parentCustomerId: string } = {
  username: process.env.BRANCH_ADMIN_USER ?? PARENT_ADMIN.username,
  password: process.env.BRANCH_ADMIN_PASS ?? PARENT_ADMIN.password,
  role: 'Branch Admin',
  roleCode: process.env.BRANCH_ADMIN_ROLE ?? 'BRANCH_ADMIN',
  /** The parent these branches hang off. */
  parentCustomerId: process.env.BRANCH_ADMIN_PARENT ?? PARENT_ADMIN.ownCustomerId,
};

/**
 * The onboarding chain's other two makers.
 *
 * Per the credentials workbook, onboarding is not one maker and one checker but
 * three hands: a DSA raises the form, a TSM reviews it, and only then does a
 * checker approve. The checklist states it plainly — DSA is a
 * "maker role for onboarding — form must go through TSM Reviewer before
 * Checker; cannot approve anything", and TSM is the "key maker role for
 * onboarding; sees only mapped ROs".
 *
 * That last clause is the interesting one: a TSM is mapped to specific outlets
 * by CMS Code, so two TSMs should see different work. 9616200105 (north) and
 * 9616200106 (south) exist for exactly that comparison.
 *
 * ── An unverified note this replaces ──────────────────────────────────────
 * The comment on ONBOARDING_MAKER claims DSA and TSM accounts "can open the
 * wizard but not submit". That contradicts the workbook, which calls both maker
 * roles, and it is not attributed to any measurement. Treat it as unverified
 * until one of these accounts has actually been driven through the wizard.
 *
 * Credentials come from test-data/FleetPlusUsercredentials.xlsx, sheet
 * "User Credentials". The 96162001xx alternates in the backup checklist are
 * also created and login-tested if these prove to be mapped to the wrong
 * division.
 */
export const DSA: Account = {
  username: process.env.DSA_USER ?? '9611200199',
  password: process.env.DSA_PASS ?? 'Thinkpad@1',
  role: 'DSA',
};

export const TSM: Account = {
  username: process.env.TSM_USER ?? '9612200200',
  password: process.env.TSM_PASS ?? 'Thinkpad@1',
  role: 'TSM',
};

/** The second TSM, for checking that outlet mapping actually scopes the work. */
export const TSM_SOUTH: Account = {
  username: process.env.TSM_SOUTH_USER ?? '9616200106',
  password: process.env.TSM_SOUTH_PASS ?? 'Thinkpad@1',
  role: 'TSM (south)',
};

/** Third-party Business Development Agent — the DSA's twin, per the workbook. */
export const BDA: Account = {
  username: process.env.BDA_USER ?? '9616200104',
  password: process.env.BDA_PASS ?? 'Thinkpad@1',
  role: 'BDA',
};

/** The branch cap, from ConfigurationMaster.MaxBranchAllowed. */
export const MAX_BRANCH_ALLOWED = Number(process.env.MAX_BRANCH_ALLOWED ?? 5);

/** The OTP every QA account accepts. */
export const TEST_OTP = process.env.TEST_OTP ?? '123456';
