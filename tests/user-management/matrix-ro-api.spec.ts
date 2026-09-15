import { expect } from '@playwright/test';
import { test } from '../../src/fixtures/page.fixtures';
import {
  description, epic, feature, owner, parameter, severity, story, tms,
} from 'allure-js-commons';
import { MatrixDb } from '../../src/helpers/matrix-db.helper';
import { Evidence } from '../../src/helpers/evidence.helper';
import { roApiCells, MATRIX_ROWS } from '../../src/data/usertype-matrix.data';
import { FixtureFinder } from '../../src/helpers/fixture-finder';
import { RoOnboardingApi } from '../../src/helpers/ro-api.helper';
import { freshMobile } from '../../src/helpers/test-identity';

/**
 * The matrix for the two types the RO onboarding API creates.
 *
 * One call creates both: an RO admin from `mobile` and a TERRITORY_ADMIN from
 * `tsm_mobile`. So each cell puts the fixture mobile in the slot belonging to
 * the row under test and a brand-new number in the other, and then reads only
 * the user type that row is about. Putting a fixture in both slots would leave
 * a refusal unattributable.
 *
 * ── Why every call mints new codes ────────────────────────────────────────
 * TSMs are keyed on the `tsm` code rather than the mobile, and reusing a code
 * does not create anyone — it overwrites that officer's mobile in place, while
 * still answering "action":"Created". Reusing a cust_code is assumed to behave
 * the same way for outlets. Both codes are therefore unique per call, which is
 * the default in RoOnboardingApi.
 *
 * ── What is predicted rather than known ───────────────────────────────────
 * roApiVerdict was derived from probes of the RO row: a Fleet-customer mobile
 * was accepted, an FP_ADMIN mobile refused. The TERRITORY_ADMIN row was never
 * probed, so the four cells where the workbook expects a customer record to
 * block a Nayara officer are predictions. If they are wrong these tests will
 * say so, which is the reason to run them rather than reason about them.
 */

const RO_ROWS = MATRIX_ROWS.filter(r => r.viaRoApi);

test.describe('Matrix — RO onboarding API', () => {
  test.describe.configure({ mode: 'default' });

  for (const row of RO_ROWS) {
    test.describe(`${row.code} (${row.name})`, () => {
      for (const cell of roApiCells().filter(c => c.row.code === row.code)) {
        const expected = cell.spec;
        const title =
          `${row.code} on a mobile that is "${cell.column.label}" ` +
          `-> ${expected === 'allowed' ? 'created' : 'refused'}`;

        test(
          title,
          { tag: ['@regression', '@user-management', '@matrix', '@ro-api'] },
          // `db` opens the worker pool; never referenced directly.
          async ({ db: _db }) => {
            test.setTimeout(180_000);

            await epic('User Management');
            await feature('RO onboarding API');
            await story(`UserType × CustomerType — ${row.code}`);
            await owner('QA Team');
            await tms(cell.tcId);
            await severity('blocker');
            await parameter('User type', row.code);
            await parameter('Existing state', cell.column.label);
            await parameter('Workbook says', cell.spec);
            await parameter('RO API does', cell.code);

            if (cell.disputed) {
              test.fail(
                true,
                `Predicted disagreement: the workbook says ${cell.spec}, the RO ` +
                  `API is expected to ${cell.code}. It objects to other user ` +
                  `types but not to customer records, so a Nayara officer lands ` +
                  `on a mobile that belongs to a customer.`
              );
            }

            await description(
              `${cell.column.precondition}\n\n` +
                `Workbook: **${cell.spec}**. RO API: **${cell.code}**.`
            );

            const ev = new Evidence(`${cell.tcId} — ${title}`, cell.tcId.toLowerCase());
            ev.fact('Test case', cell.tcId);
            ev.fact('User type', row.code);
            ev.fact('Existing state', cell.column.label);
            ev.fact('Expected', expected);
            let status: 'passed' | 'failed' | 'skipped' = 'passed';

            try {
              let mobile: string;
              if (cell.column.key === 'no-record') {
                mobile = freshMobile();
              } else {
                // See matrix-office-api: offset by position in the full matrix so the
                // two API specs cannot select the same fixture when run together.
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

              // The row under test gets the fixture; the other slot gets a number
              // nothing has touched, so only one of the two can be refused for a
              // reason this cell cares about.
              const isRoRow = row.code === 'RO';
              const roMobile = isRoRow ? mobile : freshMobile();
              const tsmMobile = isRoRow ? freshMobile() : mobile;

              await parameter('Mobile under test', mobile);
              ev.fact('Mobile under test', mobile);
              ev.fact('RO mobile', roMobile);
              ev.fact('TSM mobile', tsmMobile);

              const before = await MatrixDb.snapshot(mobile);
              await ev.db(
                'Database before',
                'What the mobile already carries, and which check that arms.',
                MatrixDb.format('BEFORE', before)
              );

              const outcome = await RoOnboardingApi.onboard({ roMobile, tsmMobile });

              await ev.note(
                'What the API answered',
                outcome.created ? 'Reported the record as created.' : `Reported ${outcome.action || 'nothing'}.`,
                `HTTP ${outcome.httpStatus}\n` +
                  `envelope status flag : ${outcome.envelopeSaidSuccess}\n` +
                  `action               : ${outcome.action || '(none)'}\n` +
                  `remarks              : "${outcome.remarks}"\n` +
                  `cust_code / tsm_code : ${outcome.custCode} / ${outcome.tsmCode}\n\n` +
                  `A refusal still returns HTTP 200 with status 1 and message ` +
                  `"Success"; only data[].action distinguishes them. The assertion ` +
                  `below reads the database regardless.`
              );

              const after = await MatrixDb.snapshot(mobile);
              await ev.db(
                'Database after',
                `Expected: ${expected === 'allowed' ? 'one new user' : 'no new user'} of type ${row.code}.`,
                MatrixDb.format('AFTER', after)
              );

              const known = new Set(before.users.map(u => u.userId));
              const added = after.users.filter(
                u => !known.has(u.userId) && u.userTypeCode === row.code
              );

              if (outcome.unknown) {
                await ev.note(
                  'The API returned an action this client does not recognise',
                  'Neither Created nor Error.',
                  `action: "${outcome.action}"\nremarks: "${outcome.remarks}"\n\n` +
                    `The database still decides, but ro-api.helper.ts needs updating.`
                );
              }

              if (expected === 'allowed') {
                expect(
                  added,
                  `${row.code} should have been created on a mobile that is ` +
                    `"${cell.column.label}", but the database gained none. The API ` +
                    `said ${outcome.action}: "${outcome.remarks}".`
                ).toHaveLength(1);
              } else {
                expect(
                  added,
                  `${row.code} should have been refused on a mobile that is ` +
                    `"${cell.column.label}", but the database gained ${added.length}. ` +
                    `The API said ${outcome.action}: "${outcome.remarks}".`
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
