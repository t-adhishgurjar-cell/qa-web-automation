import { MobileSnapshot, BLOCKING_CUSTOMER_STATUSES, OD_CUSTOMER_TYPE_CODE, BLOCKS_MOBILE_REUSE }
  from '../helpers/matrix-db.helper';

/**
 * The UserType × CustomerType matrix, as data.
 *
 * FleetPlus_UserType_Matrix_TestCases.xlsx states 117 cells as prose. This is
 * the same thing in a form tests can be generated from, with one addition that
 * the workbook does not have: each cell carries *two* verdicts.
 *
 *   spec — what the workbook says should happen
 *   code — what usp_AddUser actually does
 *
 * They disagree on 20 cells, and writing only one of them down would mean
 * quietly picking a side. Keeping both lets a test assert the spec, report the
 * disagreement, and stop being a known failure the moment the code is fixed —
 * without anyone having to remember why it was red.
 *
 * ── Fixtures ──────────────────────────────────────────────────────────────
 * Six of the nine columns are preconditions on data that must already exist:
 * "this mobile is an approved Fleet customer" cannot be created on demand,
 * because onboarding as a maker only reaches the approval queue. So each column
 * names real mobiles, found by query and verified to arm exactly one check —
 * no second customer type, no blocking user, no active retail outlet.
 *
 * They are live data and will drift. Every one is re-validated against the
 * database at run time, and a test whose fixture no longer holds skips saying
 * so rather than failing as though the application were at fault.
 */

export type Verdict = 'allowed' | 'blocked';

/** UserTypesMaster.Category — and, exactly, how the workbook groups its rows. */
export type UserCategory = 'Nayara' | 'Customer' | 'RO' | 'Other';

/** Which of the procedure's three checks a column is meant to arm. */
export type Check = 'none' | 'CustomerMaster' | 'ROMaster' | 'Users';

export interface MatrixColumn {
  key: string;
  /** The workbook's own wording, so a cell can be traced back to it. */
  label: string;
  /** What it means, for the report. */
  precondition: string;
  check: Check;
  /** Comma-separated override, for when the fixtures below go stale. */
  envVar: string;
  /**
   * Known-good mobiles. More than one because a cell that expects success
   * *creates a user on the fixture*, which arms the Users check and makes that
   * mobile useless for this column ever after. Each user type takes its own.
   */
  fixtures: string[];
  /** True when the snapshot really is what this column claims. */
  arms(snapshot: MobileSnapshot): { ok: boolean; why: string };
}

// ── Helpers used by the validators ──────────────────────────────────────────

const approvedCustomers = (s: MobileSnapshot) =>
  s.customers.filter(c => c.statusFlag && BLOCKING_CUSTOMER_STATUSES.includes(c.status));

const blockingUsers = (s: MobileSnapshot) =>
  s.users.filter(u => u.mobile === s.mobile && BLOCKS_MOBILE_REUSE.includes(u.userTypeCode));

const activeRo = (s: MobileSnapshot) =>
  s.retailOutlets.filter(r => r.statusFlag && r.roStatus === 201);

/**
 * A customer column is only usable if nothing *else* is also true, or the
 * refusal cannot be attributed to the customer check.
 *
 * CUSTOMER_ADMIN and BRANCH_ADMIN are deliberately tolerated: every approved
 * customer has them — 145,236 of 145,238 Fleet customers do — and the procedure
 * ignores them, so their presence leaves the cell isolated all the same. This is
 * the fact that makes these columns testable at all.
 */
function customerColumn(code: number, exclusive: boolean) {
  return (s: MobileSnapshot): { ok: boolean; why: string } => {
    const approved = approvedCustomers(s);
    const wanted = approved.filter(c => c.customerTypeCode === code);
    const others = approved.filter(c => c.customerTypeCode !== code);

    if (!wanted.length) {
      return { ok: false, why: `no approved customer of type ${code} (status 101/104) on this mobile` };
    }
    if (exclusive && others.length) {
      return {
        ok: false,
        why: `also holds customer type(s) ${[...new Set(others.map(c => c.customerTypeCode))].join(', ')}, ` +
          `so a refusal could not be attributed to type ${code}`,
      };
    }
    if (blockingUsers(s).length) {
      return {
        ok: false,
        why: `already holds ${blockingUsers(s).map(u => u.userTypeCode).join(', ')}, ` +
          `which arms the Users check as well — the cell is no longer isolated`,
      };
    }
    if (activeRo(s).length) return { ok: false, why: 'is an active retail outlet, which arms the RO check too' };
    return { ok: true, why: `${wanted.length} approved type-${code} customer record(s), nothing else armed` };
  };
}

/** A Users column: the named type must be present, and no customer record. */
function usersColumn(codes: readonly string[]) {
  return (s: MobileSnapshot): { ok: boolean; why: string } => {
    const held = s.users.filter(u => u.mobile === s.mobile && codes.includes(u.userTypeCode));
    if (!held.length) return { ok: false, why: `no ${codes.join('/')} user on this mobile` };
    const nonOd = approvedCustomers(s).filter(c => c.customerTypeCode !== OD_CUSTOMER_TYPE_CODE);
    if (nonOd.length) {
      return { ok: false, why: 'also an approved non-OD customer, which arms the CustomerMaster check too' };
    }
    return { ok: true, why: `holds ${held.map(u => `${u.userId}/${u.userTypeCode}`).join(', ')}` };
  };
}

const NAYARA_CODES = [
  'FP_ADMIN', 'HO_ADMIN', 'HO', 'REGION_ADMIN', 'STATE_ADMIN',
  'DIVISION_ADMIN', 'TERRITORY_ADMIN', 'OTHER_NAYARA',
] as const;

// ── The nine columns ────────────────────────────────────────────────────────

export const MATRIX_COLUMNS: MatrixColumn[] = [
  {
    key: 'no-record',
    label: 'No existing record',
    precondition: 'The mobile is not used anywhere — no customer, no user, no retail outlet.',
    check: 'none',
    envVar: 'MATRIX_FIXTURES_NO_RECORD',
    fixtures: [], // minted fresh; a fixed one works exactly once
    arms: s => {
      if (s.customers.length) return { ok: false, why: 'already a customer' };
      if (s.users.length) return { ok: false, why: 'already holds a user' };
      if (s.retailOutlets.length) return { ok: false, why: 'already a retail outlet' };
      return { ok: true, why: 'clean everywhere' };
    },
  },
  {
    key: 'od-only',
    label: 'OD only (CustomerTypeCode=1004)',
    precondition: 'An OD customer and nothing else — the one customer type the procedure exempts.',
    check: 'none',
    envVar: 'MATRIX_FIXTURES_OD_ONLY',
    fixtures: ['7404436222', '6000000015', '6395228914'],
    arms: customerColumn(1004, true),
  },
  {
    key: 'fleet-only',
    label: 'Fleet only (CustomerTypeCode=1001)',
    precondition: 'An approved Fleet customer, and no other customer type.',
    check: 'CustomerMaster',
    envVar: 'MATRIX_FIXTURES_FLEET',
    fixtures: ['6262744143', '6281774026', '6300835439'],
    arms: customerColumn(1001, true),
  },
  {
    key: 'non-fleet-only',
    label: 'Non Fleet (CustomerTypeCode=1002)',
    precondition: 'An approved Non-Fleet customer, and no other customer type.',
    check: 'CustomerMaster',
    envVar: 'MATRIX_FIXTURES_NON_FLEET',
    fixtures: ['6000000013', '6000000014', '6000000053'],
    arms: customerColumn(1002, true),
  },
  {
    key: 'corporate-only',
    label: 'Corporate (CustomerTypeCode=1006)',
    precondition: 'An approved Corporate customer, and no other customer type.',
    check: 'CustomerMaster',
    envVar: 'MATRIX_FIXTURES_CORPORATE',
    fixtures: ['6600000001', '6700799700', '7000000114'],
    arms: customerColumn(1006, true),
  },
  {
    key: 'od-plus-non-od',
    label: 'OD + non-OD mixed',
    precondition:
      'Both an OD customer and a non-OD one. The interesting half of the rule: ' +
      'the OD exemption is for OD-*only*, so one non-OD record should still block.',
    check: 'CustomerMaster',
    envVar: 'MATRIX_FIXTURES_MIXED',
    fixtures: ['7500026875', '7000000161', '9870000015'],
    arms: s => {
      const approved = approvedCustomers(s);
      const od = approved.filter(c => c.customerTypeCode === OD_CUSTOMER_TYPE_CODE);
      const nonOd = approved.filter(c => c.customerTypeCode !== OD_CUSTOMER_TYPE_CODE);
      if (!od.length) return { ok: false, why: 'no approved OD customer record' };
      if (!nonOd.length) return { ok: false, why: 'no approved non-OD customer record — this is the OD-only column' };
      if (blockingUsers(s).length) {
        return { ok: false, why: `also holds ${blockingUsers(s).map(u => u.userTypeCode).join(', ')}` };
      }
      return { ok: true, why: `OD plus type(s) ${[...new Set(nonOd.map(c => c.customerTypeCode))].join(', ')}` };
    },
  },
  {
    key: 'ro-user',
    label: 'Existing RO user in Users table',
    precondition: 'The mobile already logs in as an RO Admin.',
    check: 'Users',
    envVar: 'MATRIX_FIXTURES_RO_USER',
    fixtures: ['9870000009', '8099999991'],
    arms: usersColumn(['RO']),
  },
  {
    key: 'other-ro-user',
    label: 'Existing OTHER_RO user',
    precondition: 'The mobile already logs in as an RO User.',
    check: 'Users',
    envVar: 'MATRIX_FIXTURES_OTHER_RO_USER',
    fixtures: ['9999100700', '9876546789', '9999301999'],
    arms: usersColumn(['OTHER_RO']),
  },
  {
    key: 'admin-user',
    label: 'Existing admin/system user',
    precondition: 'The mobile already logs in as Nayara staff.',
    check: 'Users',
    envVar: 'MATRIX_FIXTURES_ADMIN_USER',
    fixtures: ['9529506010', '9529323050', '9528909470'],
    arms: usersColumn(NAYARA_CODES),
  },
];

// ── The rows ────────────────────────────────────────────────────────────────

export interface MatrixRow {
  code: string;
  name: string;
  category: UserCategory;
  /** How this type is created in the real system. */
  route: string;
  /** True only for the five the Add User screen offers. */
  viaAddUser: boolean;
}

export const MATRIX_ROWS: MatrixRow[] = [
  { code: 'FP_ADMIN', name: 'Admin', category: 'Nayara', route: 'Add User', viaAddUser: true },
  { code: 'HO_ADMIN', name: 'HO Admin', category: 'Nayara', route: 'Add User', viaAddUser: true },
  { code: 'HO', name: 'HO', category: 'Nayara', route: 'Add User', viaAddUser: true },
  { code: 'OTHER_NAYARA', name: 'Other (Nayara)', category: 'Nayara', route: 'Add User', viaAddUser: true },
  { code: 'OTHER_NON', name: 'Other (Non Nayara)', category: 'Other', route: 'Add User', viaAddUser: true },

  { code: 'REGION_ADMIN', name: 'Region Admin', category: 'Nayara', route: 'Office API', viaAddUser: false },
  { code: 'STATE_ADMIN', name: 'State Admin', category: 'Nayara', route: 'Office API', viaAddUser: false },
  { code: 'DIVISION_ADMIN', name: 'Division Admin', category: 'Nayara', route: 'Office API', viaAddUser: false },
  { code: 'TERRITORY_ADMIN', name: 'Territory Admin (TSM)', category: 'Nayara', route: 'RO onboarding API', viaAddUser: false },
  { code: 'RO', name: 'RO Admin', category: 'RO', route: 'RO onboarding API', viaAddUser: false },
  { code: 'OTHER_RO', name: 'RO User', category: 'RO', route: 'RO onboarding API (unconfirmed)', viaAddUser: false },

  // The workbook writes these two as CUSTOMER_PARENT_USER / CUSTOMER_BRANCH_USER.
  // The second is a display name; the code is CUSTOMER_CHILD_USER. Both are
  // created by a Customer Admin from their own portal, not by Add User.
  { code: 'CUSTOMER_PARENT_USER', name: 'Customer Parent User', category: 'Customer', route: "Customer Admin's portal", viaAddUser: false },
  { code: 'CUSTOMER_CHILD_USER', name: 'Customer Branch User', category: 'Customer', route: "Customer Admin's portal", viaAddUser: false },
];

// ── The verdicts ────────────────────────────────────────────────────────────

/**
 * The workbook's rule, stated once rather than transcribed 117 times.
 *
 * Nayara staff cannot be created on a real customer's mobile unless that
 * customer is OD-only; nobody at all can be created on a mobile that already
 * holds a blocking login.
 */
export function specVerdict(row: MatrixRow, column: MatrixColumn): Verdict {
  if (column.check === 'none') return 'allowed';
  if (column.check === 'Users' || column.check === 'ROMaster') return 'blocked';
  return row.category === 'Nayara' ? 'blocked' : 'allowed';
}

/**
 * What usp_AddUser really does.
 *
 * Identical to the spec but for one thing: its CustomerMaster check has no
 * user-type guard, so it refuses *every* type on a non-OD customer's mobile —
 * not only Nayara staff. That single missing condition is the whole disagreement.
 */
export function codeVerdict(_row: MatrixRow, column: MatrixColumn): Verdict {
  return column.check === 'none' ? 'allowed' : 'blocked';
}

export interface Cell {
  row: MatrixRow;
  column: MatrixColumn;
  spec: Verdict;
  code: Verdict;
  /** True where the workbook and the procedure do not agree. */
  disputed: boolean;
}

export function cell(row: MatrixRow, column: MatrixColumn): Cell {
  const spec = specVerdict(row, column);
  const code = codeVerdict(row, column);
  return { row, column, spec, code, disputed: spec !== code };
}

/** Every cell reachable through the Add User screen — 5 types × 9 columns. */
export function addUserCells(): Cell[] {
  return MATRIX_ROWS.filter(r => r.viaAddUser).flatMap(row =>
    MATRIX_COLUMNS.map(column => cell(row, column))
  );
}

/**
 * The mobiles to try for a cell, most preferred first.
 *
 * Each user type is given a different starting point in the pool, because a
 * cell that expects success consumes its fixture: creating the user arms the
 * Users check, and the mobile stops representing this column.
 */
export function fixturesFor(column: MatrixColumn, rowIndex: number): string[] {
  const override = process.env[column.envVar]?.trim();
  const pool = override
    ? override.split(',').map(m => m.trim()).filter(Boolean)
    : column.fixtures;

  if (!pool.length) return [];
  return pool.map((_, i) => pool[(rowIndex + i) % pool.length]);
}
