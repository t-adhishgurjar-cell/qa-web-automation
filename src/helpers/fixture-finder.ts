import { DbHelper } from './db.helper';
import { MatrixDb, MobileSnapshot, blockingTypesSqlList } from './matrix-db.helper';
import { MatrixColumn } from '../data/usertype-matrix.data';

/**
 * Finds mobiles that arm a matrix column, by asking the database.
 *
 * Six of the nine columns are preconditions on data that already exists — "an
 * approved Fleet customer", "a mobile that already logs in as an RO admin" —
 * and none of it can be conjured on demand. The first version of this suite
 * carried hardcoded lists of such mobiles, which was wrong in a way that took a
 * while to show: they rot. A fixture is consumed, or someone edits the record,
 * and a test that was proving something yesterday quietly proves nothing today
 * while still passing.
 *
 * So the lists are gone and the query is the definition. Each column carries SQL
 * describing what it needs, and every candidate is then checked against the same
 * arms() predicate the tests use, because SQL that looks right and a snapshot
 * that actually satisfies the rule are not guaranteed to be the same thing.
 *
 * ── What gets consumed ────────────────────────────────────────────────────
 * Only one column of the nine. Seven expect a refusal, so nothing is written and
 * their fixtures stay valid indefinitely — a mobile holding an RO admin today
 * still holds one next month. "No existing record" mints a fresh number. Only
 * "OD only" expects success, and creating that user arms the Users check against
 * the mobile, retiring it from this column for good. There are around 200
 * approved OD customers and a full run uses five.
 */

export interface FixtureCandidate {
  mobile: string;
  snapshot: MobileSnapshot;
  why: string;
}

export interface FixtureSearch {
  found: FixtureCandidate[];
  /** Every candidate the query offered and why each was turned down. */
  rejected: string[];
}

/**
 * Narrows to a recent sample before filtering.
 *
 * The unfiltered Fleet set is 145,000 rows and the correlated subqueries below
 * time out against all of it. Newest first is also the better sample: recent
 * records are the ones QA is actively working with.
 */
const CANDIDATE_LIMIT = 400;

/**
 * The user types usp_AddUser's Check 3 treats as blocking, quoted for SQL.
 *
 * Derived from BLOCKS_MOBILE_REUSE rather than restated, so the discovery
 * queries and the tests can never disagree about what blocks.
 */
const BLOCKING_TYPES = blockingTypesSqlList();

/**
 * A mobile holding exactly one customer type and nothing else that blocks.
 *
 * CUSTOMER_ADMIN and BRANCH_ADMIN are deliberately tolerated. Every approved
 * customer has them and the procedure ignores both, so their presence still
 * leaves exactly one check armed. Excluding them would find nothing at all:
 * 145,236 of 145,238 approved Fleet customers hold one.
 */
export function customerTypeSql(code: number): string {
  return `
    WITH candidate AS (
      SELECT TOP ${CANDIDATE_LIMIT} cm.MobileNo, cm.CustomerId
        FROM dbo.CustomerMaster cm
        JOIN dbo.CustomerTypeMaster ctm ON ctm.Id = cm.CustomerType
       WHERE cm.StatusFlag = 1 AND cm.Status IN (101, 104)
         AND ctm.CustomerTypeCode = ${code}
       ORDER BY cm.CustomerId DESC)
    SELECT c.MobileNo AS mobile
      FROM candidate c
     WHERE NOT EXISTS (
             SELECT 1 FROM dbo.CustomerMaster c2
               JOIN dbo.CustomerTypeMaster t2 ON t2.Id = c2.CustomerType
              WHERE c2.MobileNo = c.MobileNo AND c2.StatusFlag = 1
                AND c2.Status IN (101, 104) AND t2.CustomerTypeCode <> ${code})
       AND NOT EXISTS (
             SELECT 1 FROM dbo.Users u
               JOIN dbo.UserTypesMaster ut ON ut.Id = u.UserTypeId
              WHERE u.MobileNumber = c.MobileNo AND ut.Code IN (${BLOCKING_TYPES}))
       AND NOT EXISTS (
             SELECT 1 FROM dbo.ROMaster ro
              WHERE ro.MobileNo = c.MobileNo AND ro.StatusFlag = 1)
     GROUP BY c.MobileNo`;
}

/** A mobile carrying an OD record and at least one non-OD one. */
export function mixedCustomerSql(): string {
  return `
    WITH odMobile AS (
      SELECT TOP ${CANDIDATE_LIMIT} cm.MobileNo, cm.CustomerId
        FROM dbo.CustomerMaster cm
        JOIN dbo.CustomerTypeMaster ctm ON ctm.Id = cm.CustomerType
       WHERE cm.StatusFlag = 1 AND cm.Status IN (101, 104)
         AND ctm.CustomerTypeCode = 1004
       ORDER BY cm.CustomerId DESC)
    SELECT o.MobileNo AS mobile
      FROM odMobile o
     WHERE EXISTS (
             SELECT 1 FROM dbo.CustomerMaster c2
               JOIN dbo.CustomerTypeMaster t2 ON t2.Id = c2.CustomerType
              WHERE c2.MobileNo = o.MobileNo AND c2.StatusFlag = 1
                AND c2.Status IN (101, 104) AND t2.CustomerTypeCode <> 1004)
       AND NOT EXISTS (
             SELECT 1 FROM dbo.Users u
               JOIN dbo.UserTypesMaster ut ON ut.Id = u.UserTypeId
              WHERE u.MobileNumber = o.MobileNo AND ut.Code IN (${BLOCKING_TYPES}))
     GROUP BY o.MobileNo`;
}

/**
 * A mobile that already logs in as one of the given user types.
 *
 * Excludes anything that is also an approved non-OD customer, or the refusal
 * could not be attributed to the Users check rather than the CustomerMaster one.
 */
export function existingUserSql(codes: readonly string[]): string {
  const list = codes.map(c => `'${c}'`).join(',');
  return `
    SELECT TOP ${CANDIDATE_LIMIT} u.MobileNumber AS mobile
      FROM dbo.Users u
      JOIN dbo.UserTypesMaster ut ON ut.Id = u.UserTypeId
     WHERE ut.Code IN (${list}) AND u.IsActive = 1 AND u.MobileNumber IS NOT NULL
       AND NOT EXISTS (
             SELECT 1 FROM dbo.CustomerMaster cm
               JOIN dbo.CustomerTypeMaster ctm ON ctm.Id = cm.CustomerType
              WHERE cm.MobileNo = u.MobileNumber AND cm.StatusFlag = 1
                AND cm.Status IN (101, 104) AND ctm.CustomerTypeCode <> 1004)
     GROUP BY u.MobileNumber
     ORDER BY MAX(u.Id) DESC`;
}

/**
 * How many candidates are examined before giving up.
 *
 * Each one costs a full snapshot — five queries — so an unbounded walk down a
 * 400-row candidate list is both slow and hard on the connection pool. Twenty is
 * far more than any column has needed: the queries already exclude everything
 * disqualifying, so the first candidate is usually the answer.
 */
const MAX_EXAMINED = 20;

/**
 * Discovered mobiles, cached for the life of the worker.
 *
 * Discovery is a property of the environment, not of the test asking, so running
 * it once per test wasted five identical queries per column and exhausted the
 * pool near the end of a full run — which surfaced as
 * "operation timed out for an unknown reason" from tarn, naming neither the
 * query nor the test.
 */
const discovered = new Map<string, string[]>();

export class FixtureFinder {
  /**
   * Mobiles that arm this column, verified rather than assumed.
   *
   * Explicit fixtures — the column's env override — are tried first and are
   * validated identically. Being named by hand does not make a mobile correct,
   * and a wrong one supplied deliberately is the hardest kind to diagnose.
   */
  static async find(
    column: MatrixColumn,
    wanted: number,
    startAt = 0
  ): Promise<FixtureSearch> {
    const found: FixtureCandidate[] = [];
    const rejected: string[] = [];

    const explicit = process.env[column.envVar]?.trim();
    const candidates = explicit
      ? explicit.split(',').map(m => m.trim()).filter(Boolean)
      : await this.query(column);

    // Each user type starts at a different offset so that a run does not hand
    // the same mobile to five tests, and so the consuming column spreads its
    // usage across the pool rather than exhausting the head of it.
    const ordered = candidates.length
      ? candidates.map((_, i) => candidates[(startAt + i) % candidates.length])
      : [];

    for (const mobile of ordered.slice(0, MAX_EXAMINED)) {
      if (found.length >= wanted) break;

      const snapshot = await MatrixDb.snapshot(mobile);
      const verdict = column.arms(snapshot);
      if (verdict.ok) {
        found.push({ mobile, snapshot, why: verdict.why });
      } else {
        rejected.push(`  ${mobile}: ${verdict.why}`);
      }
    }

    return { found, rejected };
  }

  private static async query(column: MatrixColumn): Promise<string[]> {
    if (!column.discoverSql) return [];

    const cached = discovered.get(column.key);
    if (cached) return cached;

    const rows = await DbHelper.query<{ mobile: string }>(column.discoverSql);
    const mobiles = rows.map(r => r.mobile).filter(Boolean);
    discovered.set(column.key, mobiles);
    return mobiles;
  }

  /** Why a column could not be armed, in terms a reader can act on. */
  static explain(column: MatrixColumn, search: FixtureSearch): string {
    const head =
      `No mobile in the database currently arms "${column.label}".\n` +
      `Needed: ${column.precondition}`;

    const tried = search.rejected.length
      ? `\n\nCandidates considered and why each was unsuitable:\n${search.rejected.slice(0, 8).join('\n')}`
      : `\n\nThe discovery query returned nothing at all, so no candidate exists ` +
        `in this environment.`;

    return `${head}${tried}\n\nOverride with ${column.envVar}=<comma,separated>.`;
  }
}
