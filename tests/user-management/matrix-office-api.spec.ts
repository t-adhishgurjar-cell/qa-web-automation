import { expect } from '@playwright/test';
import { test } from '../../src/fixtures/page.fixtures';
import {
  description, epic, feature, owner, parameter, severity, story, tms,
} from 'allure-js-commons';
import { MatrixDb } from '../../src/helpers/matrix-db.helper';
import { Evidence } from '../../src/helpers/evidence.helper';
import { officeApiCells, MATRIX_ROWS } from '../../src/data/usertype-matrix.data';
import { FixtureFinder } from '../../src/helpers/fixture-finder';
import { OfficeApi, OfficerUserType } from '../../src/helpers/office-api.helper';
import { runTag, freshMobile } from '../../src/helpers/test-identity';

/**
 * The matrix again, for the officers SAP creates.
 *
 * REGION_ADMIN, STATE_ADMIN and DIVISION_ADMIN never appear on the Add User
 * screen. They arrive through insert_nayara_user, which is why these 27 cells
 * were excluded from the signoff as unreachable. They are reachable now, and
 * they matter more than "27 more cells" suggests, because the Office API does
 * not enforce usp_AddUser's rule.
 *
 * ── The disagreement these tests exist to record ──────────────────────────
 * usp_AddUser ignores CUSTOMER_ADMIN and BRANCH_ADMIN — 83% of all users, and
 * present on every approved customer. The Office API refuses on any user at
 * all, proven against 7000000008, a mobile holding a lone BRANCH_ADMIN and no
 * customer record.
 *
 * So the "OD only" column inverts. The workbook allows a Nayara officer on an
 * OD mobile and Add User agrees; the Office API refuses, because the OD
 * customer brought a CUSTOMER_ADMIN with it. Whether an officer can be created
 * depends on which door they come through, which is not a rule anyone wrote
 * down.
 *
 * ── Reading the API's answer ──────────────────────────────────────────────
 * A refusal returns HTTP 200, Success 1 and Message "Success"; the actual
 * outcome is prose inside data[].Message. Every assertion here is therefore
 * made against the database, and the API's claim is recorded beside it so the
 * two can be seen disagreeing.
 *
 * No browser: this is an API-only suite, so it runs without a session.
 */

const OFFICE_ROWS = MATRIX_ROWS.filter(r => r.viaOfficeApi);

test.describe('Matrix — Office API officers', () => {
  test.describe.configure({ mode: 'default' });

  for (const row of OFFICE_ROWS) {
    test.describe(`${row.code} (${row.name})`, () => {
      for (const cell of officeApiCells().filter(c => c.row.code === row.code)) {
        const expected = cell.spec;
        const title =
          `${row.code} on a mobile that is "${cell.column.label}" ` +
          `-> ${expected === 'allowed' ? 'created' : 'refused'}`;

        test(
          title,
          { tag: ['@regression', '@user-management', '@matrix', '@office-api'] },
          // `db` opens the worker pool; it is never referenced directly.
          async ({ db: _db }) => {
            test.setTimeout(180_000);

            await epic('User Management');
            await feature('Office API — insert_nayara_user');
            await story(`UserType × CustomerType — ${row.code}`);
            await owner('QA Team');
            await tms(cell.tcId);
            await severity('blocker');
            await parameter('User type', row.code);
            await parameter('Existing state', cell.column.label);
            await parameter('Workbook says', cell.spec);
            await parameter('Office API does', cell.code);

            if (cell.disputed) {
              test.fail(
                true,
                `Known disagreement: the workbook says ${cell.spec} and Add User ` +
                  `agrees, but the Office API ${cell.code}s. It refuses on any ` +
                  `existing user, and every approved customer carries a ` +
                  `CUSTOMER_ADMIN that usp_AddUser deliberately ignores.`
              );
            }

            await description(
              `${cell.column.precondition}\n\n` +
                `Workbook: **${cell.spec}**. Office API: **${cell.code}**.`
            );

            const ev = new Evidence(`${cell.tcId} — ${title}`, cell.tcId.toLowerCase());
            ev.fact('Test case', cell.tcId);
            ev.fact('User type', row.code);
            ev.fact('Existing state', cell.column.label);
            ev.fact('Expected', expected);
            let status: 'passed' | 'failed' | 'skipped' = 'passed';

            try {
              // "No existing record" mints a number nothing has touched; every
              // other column needs a mobile already in the required state.
              let mobile: string;
              if (cell.column.key === 'no-record') {
                mobile = freshMobile();
              } else {
                // Offset by position in the FULL matrix, not within this spec. Both API
                // matrices draw from the same scarce OD pool, and indexing within
                // each spec gave office row 0 and RO row 0 the same mobile — which
                // only collides once they run in parallel.
                const search = await FixtureFinder.find(
                  cell.column, 1, MATRIX_ROWS.findIndex(r => r.code === row.code)
                );
                if (!search.found.length) {
                  status = 'skipped';
                  const reason = FixtureFinder.explain(cell.column, search);
                  await ev.note('Precondition unavailable', 'No fixture arms this cell.', reason);
                  ev.finish(status);
                  test.skip(true, reason);
                  return;
                }
                mobile = search.found[0].mobile;
              }

              await parameter('Mobile under test', mobile);
              ev.fact('Mobile under test', mobile);

              const before = await MatrixDb.snapshot(mobile);
              await ev.db(
                'Database before',
                'What the mobile already carries, and which check that arms.',
                MatrixDb.format('BEFORE', before)
              );

              const tag = runTag();
              const outcome = await OfficeApi.createOfficer({
                userType: row.code as OfficerUserType,
                mobile,
                empCode: tag,
              });

              await ev.note(
                'What the API answered',
                outcome.created ? 'Reported the officer as created.' : 'Reported no action.',
                `HTTP ${outcome.httpStatus}\n` +
                  `envelope Success flag : ${outcome.envelopeSaidSuccess}\n` +
                  `per-record message    : "${outcome.message}"\n` +
                  `FPReferenceNo         : ${outcome.referenceNo}\n\n` +
                  `The envelope reports success even when nothing was created, so ` +
                  `the assertion below is made against the database instead.`
              );

              const after = await MatrixDb.snapshot(mobile);
              await ev.db(
                'Database after',
                `Expected: ${expected === 'allowed' ? 'one new officer' : 'no new user'}.`,
                MatrixDb.format('AFTER', after)
              );

              const known = new Set(before.users.map(u => u.userId));
              const added = after.users.filter(
                u => !known.has(u.userId) && u.userTypeCode === row.code
              );

              // An unrecognised message means the client could not tell what
              // happened. Saying so is worth more than a verdict derived from a
              // guess, even though the row count below is what actually decides.
              if (outcome.unknown) {
                await ev.note(
                  'The API said something this client does not recognise',
                  'Neither a success nor a refusal by any known wording.',
                  `"${outcome.message}"\n\nThe database is still authoritative, ` +
                    `but the message patterns in office-api.helper.ts need updating.`
                );
              }

              if (outcome.created !== (added.length > 0)) {
                await ev.note(
                  'The API’s answer does not match the database',
                  'One of the two is wrong, and the database is the one that ships.',
                  `API said created=${outcome.created}; the database gained ` +
                    `${added.length} ${row.code} row(s).`
                );
              }

              if (expected === 'allowed') {
                expect(
                  added,
                  `${row.code} should have been created on a mobile that is ` +
                    `"${cell.column.label}", but the database gained none. The API ` +
                    `said: "${outcome.message}".`
                ).toHaveLength(1);
              } else {
                expect(
                  added,
                  `${row.code} should have been refused on a mobile that is ` +
                    `"${cell.column.label}", but the database gained ${added.length}. ` +
                    `The API said: "${outcome.message}".`
                ).toHaveLength(0);
              }

              if (added.length) ev.fact('User id created', String(added[0].userId));
            } catch (error) {
              if (status !== 'skipped') status = 'failed';
              throw error;
            } finally {
              if (status !== 'skipped') ev.finish(status);
            }
          }
        );
      }
    });
  }
});
