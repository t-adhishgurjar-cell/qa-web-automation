import { expect } from '@playwright/test';
import { test } from '../../src/fixtures/page.fixtures';
import {
  description, epic, feature, owner, parameter, severity, story, tms,
} from 'allure-js-commons';
import { MatrixDb, MobileSnapshot } from '../../src/helpers/matrix-db.helper';
import { Evidence } from '../../src/helpers/evidence.helper';
import {
  Cell, addUserCells, fixturesFor, MATRIX_ROWS,
} from '../../src/data/usertype-matrix.data';
import { SelectableUserType } from '../../src/pages/user-management/add-user.page';

/**
 * The UserType × CustomerType matrix — every cell reachable from Add User.
 *
 * Five of the workbook's thirteen user types are created on this screen, so
 * 45 of its 117 cells can be driven here. The rest are created by the Office
 * API, the RO onboarding API, or a Customer Admin's own portal, and are covered
 * elsewhere or not yet.
 *
 * ── Every test has the same shape ─────────────────────────────────────────
 *
 *   1. read the database for the mobile              -> before
 *   2. confirm the column's precondition really holds, or skip saying why
 *   3. attempt the user through the UI
 *   4. read the database again                       -> after
 *   5. assert on rows added, never on the message
 *
 * Step 2 is what separates this from a suite that merely looks green. The
 * preconditions are live data — an approved Fleet customer, a mobile already
 * holding an RO login — and they drift. A test whose fixture has gone stale
 * would otherwise report the application as broken when nothing is wrong with
 * it, so it skips with the fixture's actual state instead.
 *
 * Step 5 matters because the application returns one generic message for all
 * three of the procedure's checks. Matching text could not tell the Fleet cell
 * from the RO cell, so only the row count can.
 *
 * ── Disputed cells ────────────────────────────────────────────────────────
 * On 4 of these 45, the workbook and the procedure disagree: OTHER_NON against
 * the four non-OD customer columns. The workbook says allowed, the code blocks,
 * because the CustomerMaster check has no user-type guard. Those tests assert
 * the *workbook* and are marked expected-to-fail — so they stay quiet while the
 * defect exists, and speak up the moment it is fixed.
 *
 * ── This writes to QA ─────────────────────────────────────────────────────
 * The two allowed columns create real users, ~10 across the suite, each named
 * AUTO<timestamp>. The seven blocked columns create nothing — that is what they
 * assert. Fixture mobiles for the allowed columns are consumed by being used.
 */

const USER = process.env.FP_ADMIN_USER ?? 'loadtest_006';
const PASS = process.env.FP_ADMIN_PASS ?? 'Nayara@1';

const ADD_USER_ROWS = MATRIX_ROWS.filter(r => r.viaAddUser);

function runTag(): string {
  return `AUTO${String(Date.now()).slice(-8)}`;
}

/** A mobile no previous run has touched, for the "No existing record" column. */
function freshMobile(): string {
  return `9${String(Date.now()).slice(-9)}`;
}

/**
 * The first fixture whose precondition still holds.
 *
 * Tries each in turn rather than trusting the first: fixtures are consumed by
 * the cells that expect success, and a stale one is the likeliest reason for a
 * confusing result.
 */
async function resolveFixture(
  cell: Cell,
  rowIndex: number
): Promise<{ mobile: string; before: MobileSnapshot; why: string } | { rejected: string }> {
  if (cell.column.key === 'no-record') {
    const mobile = freshMobile();
    const before = await MatrixDb.snapshot(mobile);
    const verdict = cell.column.arms(before);
    return verdict.ok
      ? { mobile, before, why: verdict.why }
      : { rejected: `minted ${mobile} but it is not clean: ${verdict.why}` };
  }

  const tried: string[] = [];
  for (const mobile of fixturesFor(cell.column, rowIndex)) {
    const before = await MatrixDb.snapshot(mobile);
    const verdict = cell.column.arms(before);
    if (verdict.ok) return { mobile, before, why: verdict.why };
    tried.push(`  ${mobile}: ${verdict.why}`);
  }

  return {
    rejected:
      `No fixture still arms "${cell.column.label}".\n${tried.join('\n')}\n\n` +
      `Supply fresh mobiles with ${cell.column.envVar}=<comma,separated>.`,
  };
}

test.use({ storageState: { cookies: [], origins: [] } });

test.describe('Matrix — Add User', () => {
  // Not serial: each cell reads its own fixture and shares no state, so one
  // stale precondition must not hide the other forty-four.
  test.describe.configure({ mode: 'default' });

  test.beforeEach(async ({ loginPage, dashboardPage }) => {
    await loginPage.navigate();
    await loginPage.login(USER, PASS);
    await dashboardPage.assertDashboardLoaded();
  });

  for (const [rowIndex, row] of ADD_USER_ROWS.entries()) {
    test.describe(`${row.code} (${row.name})`, () => {
      for (const cell of addUserCells().filter(c => c.row.code === row.code)) {
        const expected = cell.spec;
        const title =
          `${row.code} on a mobile that is "${cell.column.label}" ` +
          `-> ${expected === 'allowed' ? 'created' : 'refused'}`;

        test(title, { tag: ['@regression', '@user-management', '@matrix'] }, async ({ addUserPage, page, db }) => {
          test.setTimeout(240_000);

          await epic('User Management');
          await feature('Add User');
          await story(`UserType × CustomerType — ${row.code}`);
          await owner('QA Team');
          await severity(cell.column.check === 'none' ? 'critical' : 'blocker');
          await parameter('User type', row.code);
          await parameter('Existing state', cell.column.label);
          await parameter('Workbook says', cell.spec);
          await parameter('Procedure does', cell.code);

          // Asserting the workbook while the code disagrees. Marked here rather
          // than skipped so the defect stays visible and the test turns red the
          // day it is fixed, which is exactly when the matrix needs updating.
          if (cell.disputed) {
            test.fail(
              true,
              `Known defect: the workbook says ${cell.spec}, usp_AddUser ${cell.code}. ` +
                `Its CustomerMaster check has no user-type guard, so it refuses ` +
                `${row.code} even though ${row.code} is not Nayara staff.`
            );
          }

          await description(
            `${cell.column.precondition}\n\n` +
              `Workbook: **${cell.spec}**. Procedure: **${cell.code}**.` +
              (cell.disputed ? '\n\n⚠️ These disagree — see the failure annotation.' : '') +
              `\n\nAsserted on rows added, not on the message: the application ` +
              `returns one generic string for all three conflict checks.`
          );

          const ev = new Evidence(`${row.code} × ${cell.column.label}`, `matrix-${row.code}-${cell.column.key}`.toLowerCase());
          ev.fact('User type', row.code);
          ev.fact('Existing state', cell.column.label);
          ev.fact('Workbook expects', cell.spec);
          ev.fact('Procedure does', cell.code);
          let status: 'passed' | 'failed' | 'skipped' = 'passed';

          try {
            // ── 1 & 2. The precondition ───────────────────────────────────
            const resolved = await resolveFixture(cell, rowIndex);
            if ('rejected' in resolved) {
              status = 'skipped';
              await ev.note('Precondition unavailable', 'No fixture arms this column any more.', resolved.rejected);
              ev.finish(status);
              test.skip(true, resolved.rejected);
              return;
            }

            const { mobile, before, why } = resolved;
            const tag = runTag();
            ev.fact('Mobile under test', mobile);
            await parameter('Mobile under test', mobile);
            console.log(`${row.code} × ${cell.column.key} -> ${mobile}`);

            await ev.db(
              'Database before: the precondition this cell needs',
              `${cell.column.precondition}\n\nConfirmed: ${why}`,
              MatrixDb.format('BEFORE', before)
            );

            // ── 3. Act ────────────────────────────────────────────────────
            await addUserPage.open();
            await addUserPage.enterMobile(mobile);
            await addUserPage.fillIdentity({
              mobile,
              firstName: tag,
              lastName: 'Matrix',
              email: `${tag.toLowerCase()}.${cell.column.key}@example.com`,
              userType: row.code as SelectableUserType,
            });
            await addUserPage.selectUserType(row.code as SelectableUserType);
            await ev.ui(
              page,
              `Ready to submit as ${row.code}`,
              `Mobile ${mobile} — ${cell.column.precondition}`
            );

            const outcome = await addUserPage.submit();
            await ev.ui(
              page,
              'What the application answered',
              outcome.created
                ? 'Reported as created. The database check below decides whether that is true.'
                : `Refused: “${outcome.message || 'no message shown'}”.`
            );

            // ── 4. After ──────────────────────────────────────────────────
            const after = await MatrixDb.snapshot(mobile);
            await ev.db(
              'Database after the attempt',
              'The assertion is made here, not on the message — one generic string covers all three checks.',
              MatrixDb.format('AFTER', after)
            );
            await ev.db('What changed', 'Expected: ' + expected, MatrixDb.diff(before, after));

            // ── 5. Assert ─────────────────────────────────────────────────
            const known = new Set(before.users.map(u => u.userId));
            const added = after.users.filter(u => !known.has(u.userId) && u.userTypeCode === row.code);

            // The row count is the verdict. The application's own answer is
            // recorded but only asserted on for the single-step types, because
            // it is demonstrably unreliable for the other two: OTHER_NAYARA
            // reported "created = false" while the modal said "User created
            // successfully" and the row existed, and reported "created = true"
            // on a mobile where nothing was inserted. Both readings come from
            // the User Location Mapping step, whose response says whether the
            // *mapping* saved, not whether the user was.
            const appDisagrees =
              outcome.created !== (added.length > 0);
            if (appDisagrees) {
              await ev.note(
                'The application’s answer does not match the database',
                'Recorded because it is the kind of thing a UI-only test would report as the truth.',
                [
                  `application reported created : ${outcome.created}`,
                  `message                      : ${outcome.message || '(none)'}`,
                  `rows actually added          : ${added.length}`,
                  `deferred to location mapping : ${outcome.wentToLocationMapping}`,
                ].join('\n')
              );
              console.log(
                `${row.code} × ${cell.column.key}: app said created=${outcome.created}, ` +
                  `database says ${added.length} row(s)`
              );
            }

            if (expected === 'allowed') {
              expect(
                added,
                `${row.code} should have been created on a mobile that is "${cell.column.label}", ` +
                  `but no new ${row.code} row exists. The application said: ` +
                  `"${outcome.message || 'nothing'}".`
              ).toHaveLength(1);
              ev.fact('User id created', String(added[0].userId));
            } else {
              expect(
                added,
                `${row.code} was created on a mobile that is "${cell.column.label}". ` +
                  `The ${cell.column.check} check should have refused it.`
              ).toHaveLength(0);
            }

            if (!outcome.wentToLocationMapping) {
              expect(
                outcome.created,
                `the application reported created=${outcome.created} but the database ` +
                  `gained ${added.length} row(s)`
              ).toBe(expected === 'allowed');
            }
          } catch (error) {
            if (status !== 'skipped') status = 'failed';
            throw error;
          } finally {
            if (status !== 'skipped') ev.finish(status);
          }
        });
      }
    });
  }
});
