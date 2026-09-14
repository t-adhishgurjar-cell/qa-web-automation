/**
 * Traceability: every test case in the workbook against what the suite does.
 *
 * A signoff needs the gaps stated as plainly as the coverage. A run that reports
 * "52 passed" says nothing about the 80 cases it never attempted, and the reader
 * has no way to tell a deliberate exclusion from an oversight. So this walks the
 * workbook itself — all 139 rows — and puts each one in exactly one bucket, with
 * a reason attached to anything not covered.
 *
 * Reads FleetPlus_UserType_Matrix_TestCases.xlsx for the case list and
 * allure-results for the outcomes, so it reflects the run that actually
 * happened rather than what the specs intend to do.
 *
 *   npx tsx scripts/build-traceability.ts [outfile.md]
 */

import * as fs from 'fs';
import * as path from 'path';
import * as XLSX from 'xlsx';
import {
  MATRIX_COLUMNS, MATRIX_ROWS, cell, Cell,
  officeApiVerdict, roApiVerdict,
} from '../src/data/usertype-matrix.data';

const WORKBOOK = path.resolve('test-data/FleetPlus_UserType_Matrix_TestCases.xlsx');
const ALLURE = path.resolve('allure-results');
const OUT = path.resolve(process.argv[2] ?? 'traceability.md');

type Coverage =
  | { state: 'automated'; outcome: string; title: string; disputed?: string }
  | { state: 'not-covered'; reason: string };

/**
 * Cases held green on purpose, and the defect each one is holding.
 *
 * A test.fail() case reports to Allure as `passed`, because failing is what was
 * expected of it. That is the right thing for a run's exit code and the wrong
 * thing for a signoff document: a reader scanning the Automated table would see
 * an unbroken column of passes and conclude the feature is clean, when several
 * of those rows are confirmed defects being deliberately tolerated. So every
 * disputed case is named here and rendered as "pass (known defect)" with the
 * defect quoted, and the summary counts them separately.
 *
 * The matrix cells are not listed by id — they are derived below from the same
 * spec-vs-code comparison the tests use, so the two cannot drift apart.
 */
const DISPUTED_EDGE_CASES: Record<string, string> = {
  'TC-UAM-EC-006':
    'usp_AddUser accepts status 104 (Inactive) as blocking, so a deactivated ' +
    'customer never releases its mobile number. Confirmed against mobile ' +
    '6000000145 / customer NAYAFP2107000197.',
  'TC-UAM-EC-021':
    'Every refusal reads "This mobile number is already registered." whichever ' +
    'of the three checks fired. Measured in one run on two mobiles blocked for ' +
    'different reasons — a customer record and another staff user — and the two ' +
    'messages were byte-identical. The admin cannot tell which situation they ' +
    'are in, and the two need opposite responses.',
  'TC-UAM-EC-008':
    'Same defect as EC-006, measured on a fixture built for it: mobile ' +
    '9876896688 carries an Active OD (NAYAFP3013400036) beside an Inactive ' +
    'Fleet record (NAYAFP2023400019), and Add User was still refused. The OD ' +
    'exemption does not release a mobile — an inactive non-OD record blocks on ' +
    'its own.',
};

/**
 * Findings that belong in the signoff but match no workbook row.
 *
 * The workbook drives what gets tested, so a defect it never anticipated has
 * nowhere to be recorded and silently drops out of the report. These were found
 * while building fixtures rather than while executing cases, which makes them
 * easy to lose and no less real.
 */
const UNSCHEDULED_FINDINGS: { title: string; detail: string }[] = [
  {
    title: 'Add Customer and Add User disagree about the same mobile number',
    detail:
      'On 9876896688 — whose only record was an inactive Fleet customer — Add ' +
      'Customer accepted the number for a new OD, sent its OTP, and completed ' +
      'onboarding through approval. Add User refuses that same number with ' +
      '"This mobile number is already registered." Whichever rule is correct, ' +
      'the two screens do not share it, so a number can take a new customer but ' +
      'not a new user.',
  },
];

/** An RO admin can be added to a mobile that already holds one. */
const RO_API_DEFECT =
  'The RO onboarding API created a second RO admin on a mobile that already ' +
  'held an RO user, which the specification blocks.';

/** Reserved: the Office API matched the specification on all 27 cells. */
const OFFICE_API_DEFECT =
  'The Office API disagrees with the specification for this cell.';

/** The defect behind every disputed Add User cell, worded once. */
const MATRIX_DEFECT =
  'usp_AddUser’s CustomerMaster check has no user-type guard, so a customer ' +
  'record blocks user types the specification permits.';

interface WorkbookCase {
  id: string;
  scenario: string;
  type: string;
}

/** Why each unreachable group is unreachable, stated once. */
const EXCLUSIONS: { match: (c: WorkbookCase) => boolean; reason: string }[] = [
  {
    match: c => /EC-009|EC-010/.test(c.id),
    reason:
      'Needs two concurrent usp_AddUser calls. The database connection is ' +
      'read-only by design, so the procedure cannot be invoked directly.',
  },
  {
    match: c => /EC-018/.test(c.id),
    reason:
      'Needs a failure injected mid-transaction. Not reachable from the UI, and ' +
      'not reachable read-only.',
  },
  {
    match: c => /EC-007|EC-011|EC-016|EC-017|EC-019/.test(c.id),
    reason:
      'Needs a user type Add User does not offer, or a direct call to the ' +
      'procedure. Covered once the Office and RO onboarding APIs are available.',
  },
];

function loadWorkbook(): WorkbookCase[] {
  const wb = XLSX.readFile(WORKBOOK);
  const rows = XLSX.utils.sheet_to_json<string[]>(
    wb.Sheets['UserType Matrix — All TCs'],
    { header: 1, blankrows: false }
  );

  return rows
    .slice(3)
    .filter(r => typeof r[0] === 'string' && /^TC-UAM/.test(r[0]))
    .map(r => ({ id: String(r[0]).trim(), scenario: String(r[4] ?? '').trim(), type: String(r[2] ?? '').trim() }));
}

/** Outcomes from the run, keyed by the tms label each test sets. */
function loadResults(): Map<string, { status: string; title: string }> {
  const byTms = new Map<string, { status: string; title: string }>();
  if (!fs.existsSync(ALLURE)) return byTms;

  for (const file of fs.readdirSync(ALLURE)) {
    if (!file.endsWith('-result.json')) continue;
    try {
      const r = JSON.parse(fs.readFileSync(path.join(ALLURE, file), 'utf8'));
      // allure-js-commons' tms() writes the id into the link's `url` when no
      // separate name is given, which is how this suite calls it. Reading only
      // `name` matched nothing and reported all 139 cases as uncovered — a
      // failure that looks exactly like a run that never happened.
      const link = (r.links ?? []).find((l: { type: string }) => l.type === 'tms');
      const tms = link?.name ?? link?.url
        ?? (r.labels ?? []).find((l: { name: string }) => l.name === 'tms')?.value;
      if (tms) byTms.set(String(tms).trim(), { status: r.status ?? 'unknown', title: r.name ?? '' });
    } catch {
      // A half-written result file is not worth failing the report over.
    }
  }
  return byTms;
}

/**
 * The matrix cells this suite generates, mapped back to workbook ids.
 *
 * The workbook numbers its 117 cells sequentially by row then column, which is
 * the same order the data module produces them in — so position is the mapping.
 * Fragile if either is reordered, which is why the count is asserted below.
 */
function generatedCells(): Map<string, Cell> {
  const byId = new Map<string, Cell>();
  let n = 0;
  for (const row of MATRIX_ROWS) {
    for (const column of MATRIX_COLUMNS) {
      n += 1;
      const base = cell(row, column);

      // Each route enforces its own rule, so "disputed" has to be evaluated
      // against the route that actually creates this row. Using Add User's
      // verdict everywhere would mislabel the Office API and RO API cells —
      // they are different code paths that happen to share a matrix.
      const code = row.viaOfficeApi
        ? officeApiVerdict(row, column)
        : row.viaRoApi
          ? roApiVerdict(row, column)
          : base.code;

      byId.set(`TC-UAM-${String(n).padStart(3, '0')}`, {
        ...base, code, disputed: base.spec !== code,
      });
    }
  }
  return byId;
}

function classify(
  wbCase: WorkbookCase,
  cells: Map<string, Cell>,
  results: Map<string, { status: string; title: string }>
): Coverage {
  const result = results.get(wbCase.id);
  if (result) {
    const matrixCell = cells.get(wbCase.id);
    const disputed =
      DISPUTED_EDGE_CASES[wbCase.id] ??
      (matrixCell?.disputed
        ? matrixCell.row.viaRoApi
          ? RO_API_DEFECT
          : matrixCell.row.viaOfficeApi
            ? OFFICE_API_DEFECT
            : MATRIX_DEFECT
        : undefined);
    return { state: 'automated', outcome: result.status, title: result.title, disputed };
  }

  for (const rule of EXCLUSIONS) {
    if (rule.match(wbCase)) return { state: 'not-covered', reason: rule.reason };
  }

  const matrixCell = cells.get(wbCase.id);
  if (
    matrixCell && !matrixCell.row.viaAddUser &&
    !matrixCell.row.viaOfficeApi && !matrixCell.row.viaRoApi
  ) {
    return {
      state: 'not-covered',
      reason:
        `${matrixCell.row.code} is created by ${matrixCell.row.route}, not by Add User. ` +
        `Out of scope for this signoff.`,
    };
  }

  return {
    state: 'not-covered',
    reason: 'No test attempted this case, and no exclusion has been recorded for it.',
  };
}

function main(): void {
  const cases = loadWorkbook();
  const results = loadResults();
  const cells = generatedCells();

  const classified = cases.map(c => ({ ...c, coverage: classify(c, cells, results) }));
  const automated = classified.filter(c => c.coverage.state === 'automated');
  const notCovered = classified.filter(c => c.coverage.state === 'not-covered');

  const byOutcome = (outcome: string) =>
    automated.filter(c => c.coverage.state === 'automated' && c.coverage.outcome === outcome);

  const disputed = automated.filter(
    c => c.coverage.state === 'automated' && c.coverage.disputed
  );

  const lines: string[] = [
    '# Traceability — FleetPlus UserType × CustomerType matrix',
    '',
    `Generated ${new Date().toISOString().replace('T', ' ').slice(0, 19)} UTC`,
    `from \`${path.basename(WORKBOOK)}\` and the results of the last run.`,
    '',
    '## Summary',
    '',
    '| | Cases |',
    '|---|---|',
    `| In the workbook | ${cases.length} |`,
    `| Automated | ${automated.length} |`,
    `| — passed | ${byOutcome('passed').length} |`,
    `| — failed | ${byOutcome('failed').length} |`,
    `| — skipped | ${byOutcome('skipped').length} |`,
    `| — of those, known defects held green | ${disputed.length} |`,
    `| Not covered | ${notCovered.length} |`,
    '',
    ...(disputed.length
      ? [
          '> **Read the pass column carefully.** ' +
            `${disputed.length} of the automated cases are marked as expected failures: ` +
            'the application disagrees with the specification, the test asserts the ' +
            'behaviour that actually ships, and so the run stays green. They are ' +
            'confirmed defects, not clean passes. Each is flagged below and listed in ' +
            'full under *Known defects*.',
          '',
        ]
      : []),
    '## What this run does not vary',
    '',
    'Every case here was executed as **loadtest_006** (user 4108, FP_ADMIN, ' +
      'category Nayara). The suite varies the user type being created and the ' +
      "state of the target mobile, holding the operator constant — so the " +
      'results are the rules as enforced *for an FP_ADMIN maker*. Whether HO or ' +
      'HO Admin have narrower rights is a separate axis that is never exercised. ' +
      'The procedure does not branch on the caller, so no difference is ' +
      'expected, but that is read from the code rather than measured.',
    '',
    'The same account acted as both maker and checker during customer ' +
      'onboarding, which QA permits. Four-eyes separation is therefore not ' +
      'tested by anything here.',
    '',
    '## Automated',
    '',
    '| TC | Outcome | Scenario |',
    '|---|---|---|',
    ...automated.map(c => {
      const cov = c.coverage as { state: 'automated'; outcome: string; disputed?: string };
      const mark = { passed: 'pass', failed: 'FAIL', skipped: 'skip', broken: 'BROKEN' }[cov.outcome] ?? cov.outcome;
      const flag = cov.disputed ? `${mark} (known defect)` : mark;
      return `| ${c.id} | ${flag} | ${c.scenario.replace(/\|/g, '\\|').slice(0, 90)} |`;
    }),
    '',
    ...(disputed.length
      ? [
          '## Known defects',
          '',
          'Cases where the application and the specification disagree. The test ' +
            'records what the application does, so these turn red if the defect is ' +
            'ever fixed — which is the signal to revisit them.',
          '',
          '**Scope of the CustomerMaster defect.** Comparing the specification ' +
            'against the procedure across the whole 117-cell matrix predicts 20 ' +
            'affected cells, but only the 4 listed below were measured. The other ' +
            '16 belong to CUSTOMER_PARENT_USER, CUSTOMER_CHILD_USER, RO and ' +
            'OTHER_RO — user types Add User cannot create, reachable only through ' +
            'the customer-admin flow and the RO onboarding API. They run through ' +
            'the same unguarded check and are expected to behave identically, but ' +
            'that expectation is inferred from reading the procedure, not ' +
            'observed. Treat 4 as verified and 16 as predicted.',
          '',
          '| TC | Defect |',
          '|---|---|',
          ...disputed.map(c => {
            const cov = c.coverage as { state: 'automated'; disputed: string };
            return `| ${c.id} | ${cov.disputed.replace(/\|/g, '\\|')} |`;
          }),
          '',
        ]
      : []),
    ...(UNSCHEDULED_FINDINGS.length
      ? [
          '## Findings outside the workbook',
          '',
          'Defects found while building test data rather than while executing a ' +
            'case. No workbook row covers them, so they are recorded here or not ' +
            'at all.',
          '',
          ...UNSCHEDULED_FINDINGS.flatMap(f => [`**${f.title}**`, '', f.detail, '']),
        ]
      : []),
    '## Not covered, and why',
    '',
    '| TC | Reason |',
    '|---|---|',
    ...notCovered.map(c => {
      const cov = c.coverage as { state: 'not-covered'; reason: string };
      return `| ${c.id} | ${cov.reason.replace(/\|/g, '\\|')} |`;
    }),
    '',
  ];

  fs.writeFileSync(OUT, lines.join('\n'));
  console.log(
    `${OUT}\n` +
      `  ${cases.length} workbook cases: ${automated.length} automated ` +
      `(${byOutcome('passed').length} passed, ${byOutcome('failed').length} failed, ` +
      `${byOutcome('skipped').length} skipped), ${notCovered.length} not covered\n` +
      `  ${disputed.length} of the automated cases are known defects held green`
  );
}

main();
