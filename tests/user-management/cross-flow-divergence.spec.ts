import { expect } from '@playwright/test';
import { test } from '../../src/fixtures/session.fixtures';
import {
  description, epic, feature, owner, parameter, severity, story,
} from 'allure-js-commons';
import { MatrixDb } from '../../src/helpers/matrix-db.helper';
import { DbHelper } from '../../src/helpers/db.helper';
import { Evidence } from '../../src/helpers/evidence.helper';
import { OfficeApi } from '../../src/helpers/office-api.helper';
import { runTag } from '../../src/helpers/test-identity';

/**
 * The two routes into the Users table, given the same mobile.
 *
 * Add User and the Office API both create Nayara officers and both refuse
 * numbers that are already spoken for — but not the same numbers. usp_AddUser's
 * blocking list omits every Customer-category type — CUSTOMER_ADMIN,
 * BRANCH_ADMIN, CORPORATE_ADMIN, CUSTOMER_PARENT_USER and CUSTOMER_CHILD_USER,
 * together 83% of all users. The Office API blocks on all of them. Everywhere
 * else the two agree, so the difference only shows on a mobile that carries a
 * Customer-category user and no customer record to blame the refusal on.
 *
 * Measured on 6000000126, whose only user is a CUSTOMER_PARENT_USER: the Office
 * API refused it and Add User created an FP_ADMIN on it in the same run.
 *
 * The nine matrix columns cannot express that case — they vary what customer
 * records a mobile holds, and this case is defined by holding none. So it gets
 * its own test, and the test drives both routes against one number in one run
 * rather than comparing two results recorded hours apart.
 *
 * ── What a failure here means ─────────────────────────────────────────────
 * If both routes agree, the divergence has been fixed or never existed and this
 * test should be deleted rather than adjusted. If they disagree in the other
 * direction, the rules have changed and the matrix needs rereading. Either way
 * a red here is a question about the application, not about the test.
 */

/**
 * A mobile carrying only Customer-category users and nothing else.
 *
 * No customer record, no application, no RO row: usp_AddUser therefore has
 * nothing to object to, because no Customer-category type appears in its
 * blocking list. Anything the Office API objects to must be the user.
 *
 * The number must also be a real ten-digit Indian mobile. An earlier version of
 * this query offered 4800885800 — which is in the Users table despite starting
 * with a 4 — and Add User refused it on client-side format validation with no
 * message at all. That refusal is indistinguishable from the rule under test
 * and would have been read as the two routes agreeing.
 *
 * The candidate pool is narrowed by TOP before the correlated NOT EXISTS
 * filters and the category rollup, because running those across the whole
 * Users table times out at thirty seconds.
 */
const CUSTOMER_USER_ONLY_SQL = `
  WITH candidate AS (
    SELECT TOP 3000 u.MobileNumber, u.UserTypeId
      FROM dbo.Users u
     WHERE u.MobileNumber IS NOT NULL
       AND LEN(u.MobileNumber) = 10
       AND u.MobileNumber LIKE '[6-9]%'
     ORDER BY u.Id DESC)
  SELECT TOP 20 c.MobileNumber AS mobile
    FROM candidate c
    JOIN dbo.UserTypesMaster ut ON ut.Id = c.UserTypeId
   WHERE NOT EXISTS (SELECT 1 FROM dbo.CustomerMaster cm WHERE cm.MobileNo = c.MobileNumber)
     AND NOT EXISTS (SELECT 1 FROM dbo.RawCustomerMaster r WHERE r.MobileNo = c.MobileNumber)
     AND NOT EXISTS (SELECT 1 FROM dbo.ROMaster ro WHERE ro.MobileNo = c.MobileNumber)
   GROUP BY c.MobileNumber
  HAVING SUM(CASE WHEN ut.Category = 'Customer' THEN 0 ELSE 1 END) = 0
     AND COUNT(*) > 0`;

test.describe('Cross-flow — the two routes disagree', () => {
  test.describe.configure({ mode: 'default' });

  test(
    'a mobile Add User accepts, the Office API refuses',
    { tag: ['@regression', '@user-management', '@cross-flow'] },
    async ({ addUserPage, page, db: _db }) => {
      test.setTimeout(240_000);

      await epic('User Management');
      await feature('Cross-flow consistency');
      await story('Add User vs Office API');
      await owner('QA Team');
      await severity('critical');
      await description(
        'Drives both officer-creation routes against one mobile in one run. ' +
          'The number carries only Customer-category users and no customer ' +
          'record, so usp_AddUser has nothing to object to while the Office ' +
          'API refuses on the user alone.'
      );

      const ev = new Evidence(
        'Cross-flow — a mobile Add User accepts and the Office API refuses',
        'cross-flow-divergence'
      );
      let status: 'passed' | 'failed' | 'skipped' = 'passed';

      try {
        const candidates = (
          await DbHelper.query<{ mobile: string }>(CUSTOMER_USER_ONLY_SQL)
        ).map(r => r.mobile);

        let chosen: string | null = null;
        const rejected: string[] = [];
        for (const mobile of candidates) {
          const snap = await MatrixDb.snapshot(mobile);
          if (snap.customers.length) { rejected.push(`  ${mobile}: has a customer record`); continue; }
          if (!snap.users.length) { rejected.push(`  ${mobile}: has no users`); continue; }
          chosen = mobile;
          break;
        }

        if (!chosen) {
          status = 'skipped';
          const reason =
            'No mobile carries only Customer-category users with no customer ' +
            'record, so the two routes cannot be compared on equal ground.\n' +
            (rejected.slice(0, 8).join('\n') || '  (the query returned nothing)');
          await ev.note('Precondition unavailable', 'Nothing isolates the difference.', reason);
          ev.finish(status);
          test.skip(true, reason);
          return;
        }

        const mobile = chosen;
        await parameter('Mobile under test', mobile);
        ev.fact('Mobile under test', mobile);

        const before = await MatrixDb.snapshot(mobile);
        await ev.db(
          'Database before',
          'Only Customer-category users. No customer record for either route to object to.',
          MatrixDb.format('BEFORE', before)
        );

        // ── Route 1: the Office API ──────────────────────────────────────
        const apiOutcome = await OfficeApi.createOfficer({
          userType: 'STATE_ADMIN',
          mobile,
          empCode: runTag(),
        });
        const afterApi = await MatrixDb.snapshot(mobile);
        const apiCreated = afterApi.users.length > before.users.length;

        await ev.note(
          'Route 1 — the Office API',
          apiCreated ? 'Created an officer.' : 'Created nothing.',
          `HTTP ${apiOutcome.httpStatus}, envelope Success=${apiOutcome.envelopeSaidSuccess}\n` +
            `message: "${apiOutcome.message}"\n` +
            `users on the mobile: ${before.users.length} -> ${afterApi.users.length}`
        );

        // ── Route 2: Add User ────────────────────────────────────────────
        const tag = runTag();
        await addUserPage.open();
        await addUserPage.enterMobile(mobile);
        await addUserPage.fillIdentity({
          mobile,
          firstName: tag,
          lastName: 'CrossFlow',
          email: `${tag.toLowerCase()}.crossflow@example.com`,
          userType: 'FP_ADMIN',
        });
        await addUserPage.selectUserType('FP_ADMIN');
        const uiOutcome = await addUserPage.submit();
        await ev.ui(
          page,
          'Route 2 — Add User',
          uiOutcome.created ? 'Reported as created.' : `Refused: “${uiOutcome.message || 'no message'}”.`
        );

        const afterUi = await MatrixDb.snapshot(mobile);
        await ev.db(
          'Database after both routes',
          'The row counts decide, not either screen’s message.',
          MatrixDb.format('AFTER', afterUi)
        );

        const uiCreated = afterUi.users.length > afterApi.users.length;

        ev.fact('Office API', apiCreated ? 'created' : 'refused');
        ev.fact('Add User', uiCreated ? 'created' : 'refused');

        await ev.note(
          'The comparison',
          apiCreated === uiCreated ? 'Both routes agreed.' : 'The routes disagreed.',
          `Office API : ${apiCreated ? 'created' : 'refused'} — "${apiOutcome.message}"\n` +
            `Add User   : ${uiCreated ? 'created' : 'refused'} — ` +
            `"${uiOutcome.message || 'no message'}"\n\n` +
            `usp_AddUser omits every Customer-category type from its ` +
            `blocking list; the Office API blocks on all of them. On a mobile ` +
            `holding only such a user, that is the whole difference.`
        );

        // Asserting the divergence rather than the desired behaviour: this
        // records what ships. If the two are ever reconciled this turns red,
        // which is the moment to delete the test rather than edit it.
        expect(
          apiCreated,
          `The Office API was expected to refuse ${mobile}, which holds only ` +
            `Customer-category users. It said: "${apiOutcome.message}".`
        ).toBe(false);

        expect(
          uiCreated,
          `Add User was expected to accept ${mobile}: usp_AddUser's blocking list ` +
            `excludes CUSTOMER_ADMIN and BRANCH_ADMIN, and the mobile has no ` +
            `customer record. It said: "${uiOutcome.message || 'no message'}".`
        ).toBe(true);
      } catch (error) {
        if (status !== 'skipped') status = 'failed';
        throw error;
      } finally {
        if (status !== 'skipped') ev.finish(status);
      }
    }
  );
});
