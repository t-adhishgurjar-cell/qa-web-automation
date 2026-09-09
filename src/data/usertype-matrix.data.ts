import { MobileSnapshot, BLOCKING_CUSTOMER_STATUSES, OD_CUSTOMER_TYPE_CODE, BLOCKS_MOBILE_REUSE }
  from '../helpers/matrix-db.helper';
import { customerTypeSql, existingUserSql, mixedCustomerSql } from '../helpers/fixture-finder';

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
 * Seven of the nine columns are preconditions on data that must already exist:
 * "this mobile is an approved Fleet customer", "this mobile already logs in as
 * an RO admin". Rather than list such mobiles, each column carries the SQL that
 * finds one, and every candidate is then checked against the column's own
 * arms() predicate before a test will use it.
 *
 * Lists were tried first and rot. A fixture gets consumed or edited, and the
 * test goes on passing while proving nothing at all — the worst failure a suite
 * can have, because it is invisible. A query cannot go stale in that way.
 *
 * Only one column consumes what it uses. Seven expect a refusal, so nothing is
 * written and their fixtures stay valid indefinitely; "No existing record" mints
 * a fresh number. Only "OD only" expects success, and creating that user retires
 * the mobile from the column for good.
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
  /** Comma-separated override, when a specific mobile must be used. */
  envVar: string;
  /**
   * SQL returning candidate mobiles, newest first, as a `mobile` column.
   *
   * The definition of the column, not a cached answer to it. Hardcoded lists
   * were tried first and rot: a fixture gets consumed or edited, and the test
   * goes on passing while proving nothing. Absent for columns that need no
   * existing data.
   */
  discoverSql?: string;
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
    // Nothing to discover: the test mints a number no run has touched.
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
    discoverSql: customerTypeSql(1004),
    arms: customerColumn(1004, true),
  },
  {
    key: 'fleet-only',
    label: 'Fleet only (CustomerTypeCode=1001)',
    precondition: 'An approved Fleet customer, and no other customer type.',
    check: 'CustomerMaster',
    envVar: 'MATRIX_FIXTURES_FLEET',
    discoverSql: customerTypeSql(1001),
    arms: customerColumn(1001, true),
  },
  {
    key: 'non-fleet-only',
    label: 'Non Fleet (CustomerTypeCode=1002)',
    precondition: 'An approved Non-Fleet customer, and no other customer type.',
    check: 'CustomerMaster',
    envVar: 'MATRIX_FIXTURES_NON_FLEET',
    discoverSql: customerTypeSql(1002),
    arms: customerColumn(1002, true),
  },
  {
    key: 'corporate-only',
    label: 'Corporate (CustomerTypeCode=1006)',
    precondition: 'An approved Corporate customer, and no other customer type.',
    check: 'CustomerMaster',
    envVar: 'MATRIX_FIXTURES_CORPORATE',
    discoverSql: customerTypeSql(1006),
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
    discoverSql: mixedCustomerSql(),
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
    discoverSql: existingUserSql(['RO']),
    arms: usersColumn(['RO']),
  },
  {
    key: 'other-ro-user',
    label: 'Existing OTHER_RO user',
    precondition: 'The mobile already logs in as an RO User.',
    check: 'Users',
    envVar: 'MATRIX_FIXTURES_OTHER_RO_USER',
    discoverSql: existingUserSql(['OTHER_RO']),
    arms: usersColumn(['OTHER_RO']),
  },
  {
    key: 'admin-user',
    label: 'Existing admin/system user',
    precondition: 'The mobile already logs in as Nayara staff.',
    check: 'Users',
    envVar: 'MATRIX_FIXTURES_ADMIN_USER',
    discoverSql: existingUserSql(NAYARA_CODES),
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
  /**
   * True for the three SAP pushes in through insert_nayara_user.
   *
   * Kept separate from viaAddUser rather than folded into one "testable" flag,
   * because the two routes enforce different rules and a cell's verdict depends
   * on which one created it. Collapsing them would hide exactly the asymmetry
   * these rows exist to measure.
   */
  viaOfficeApi?: boolean;
}

/**
 * The thirteen user types, in the workbook's own order.
 *
 * The order is load-bearing, not cosmetic: cell ids are derived from position,
 * so a row moved here silently renumbers every case after it. Kept identical to
 * the Matrix View sheet, and asserted by the traceability report.
 */
export const MATRIX_ROWS: MatrixRow[] = [
  { code: 'FP_ADMIN', name: 'Admin', category: 'Nayara', route: 'Add User', viaAddUser: true },
  { code: 'HO_ADMIN', name: 'HO Admin', category: 'Nayara', route: 'Add User', viaAddUser: true },
  { code: 'HO', name: 'HO', category: 'Nayara', route: 'Add User', viaAddUser: true },
  { code: 'REGION_ADMIN', name: 'Region Admin', category: 'Nayara', route: 'Office API', viaAddUser: false, viaOfficeApi: true },
  { code: 'STATE_ADMIN', name: 'State Admin', category: 'Nayara', route: 'Office API', viaAddUser: false, viaOfficeApi: true },
  { code: 'DIVISION_ADMIN', name: 'Division Admin', category: 'Nayara', route: 'Office API', viaAddUser: false, viaOfficeApi: true },
  { code: 'TERRITORY_ADMIN', name: 'Territory Admin (TSM)', category: 'Nayara', route: 'RO onboarding API', viaAddUser: false },
  { code: 'OTHER_NAYARA', name: 'Other (Nayara)', category: 'Nayara', route: 'Add User', viaAddUser: true },
  { code: 'OTHER_NON', name: 'Other (Non Nayara)', category: 'Other', route: 'Add User', viaAddUser: true },

  // The workbook writes the next two as CUSTOMER_PARENT_USER and
  // CUSTOMER_BRANCH_USER. The second is a display name; the code is
  // CUSTOMER_CHILD_USER. Both are created by a Customer Admin from their own
  // portal, not by Add User.
  { code: 'CUSTOMER_PARENT_USER', name: 'Customer Parent User', category: 'Customer', route: "Customer Admin's portal", viaAddUser: false },
  { code: 'CUSTOMER_CHILD_USER', name: 'Customer Branch User', category: 'Customer', route: "Customer Admin's portal", viaAddUser: false },

  { code: 'RO', name: 'RO Admin', category: 'RO', route: 'RO onboarding API', viaAddUser: false },
  { code: 'OTHER_RO', name: 'RO User', category: 'RO', route: 'RO onboarding API (unconfirmed)', viaAddUser: false },
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
  /**
   * The workbook's own id for this cell.
   *
   * The workbook numbers its 117 combinations sequentially, row by row and
   * column by column within each row, which is exactly the order MATRIX_ROWS and
   * MATRIX_COLUMNS are declared in. Derived rather than transcribed, so the two
   * cannot drift apart — but it does mean reordering either list silently
   * renumbers everything, which is why the traceability report asserts the count.
   */
  tcId: string;
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
  const index =
    MATRIX_ROWS.findIndex(r => r.code === row.code) * MATRIX_COLUMNS.length +
    MATRIX_COLUMNS.findIndex(c => c.key === column.key) + 1;

  return {
    tcId: `TC-UAM-${String(index).padStart(3, '0')}`,
    row, column, spec, code, disputed: spec !== code,
  };
}

/** Every cell reachable through the Add User screen — 5 types × 9 columns. */
export function addUserCells(): Cell[] {
  return MATRIX_ROWS.filter(r => r.viaAddUser).flatMap(row =>
    MATRIX_COLUMNS.map(column => cell(row, column))
  );
}

/**
 * What the Office API does, as measured rather than as specified.
 *
 * Four probes, and the first reading of them was wrong, so the evidence is
 * written down here rather than the conclusion alone:
 *
 *   fresh mobile, no users                        -> created
 *   7000000008, a lone BRANCH_ADMIN, no customer  -> refused
 *   6281774026, CUSTOMER_ADMIN + Fleet customer   -> refused
 *   9100000013, an OD user and an OD customer     -> created
 *
 * "Refuses on any existing user" fitted the first three and was wrong: it
 * allows a mobile whose user is an OD. The rule is that OD is exempt and
 * everything else blocks — the same exemption usp_AddUser grants on the
 * customer side, applied here to users as well.
 *
 * ── Where the two routes actually diverge ─────────────────────────────────
 * usp_AddUser's blocking list omits every Customer-category type; the Office
 * API blocks on all of them. So the divergence is not on OD mobiles, where both
 * allow, nor on customer mobiles, where both refuse — it is on a mobile
 * carrying a Customer-category user with no blocking customer record. Proven on
 * 6000000126, a lone CUSTOMER_PARENT_USER: the Office API refused it and Add
 * User created an FP_ADMIN on it in the same run.
 */
export function officeApiVerdict(_row: MatrixRow, column: MatrixColumn): Verdict {
  return column.key === 'no-record' || column.key === 'od-only' ? 'allowed' : 'blocked';
}

export function officeApiCells(): Cell[] {
  return MATRIX_ROWS.filter(r => r.viaOfficeApi).flatMap(row =>
    MATRIX_COLUMNS.map(column => {
      const base = cell(row, column);
      const code = officeApiVerdict(row, column);
      return { ...base, code, disputed: base.spec !== code };
    })
  );
}
