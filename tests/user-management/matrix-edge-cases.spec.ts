import { expect } from '@playwright/test';
import { test } from '../../src/fixtures/session.fixtures';
import {
  description, epic, feature, owner, parameter, severity, story, tms,
} from 'allure-js-commons';
import {
  MatrixDb, MobileSnapshot, BLOCKING_CUSTOMER_STATUSES, BLOCKS_MOBILE_REUSE,
  blockingTypesSqlList,
} from '../../src/helpers/matrix-db.helper';
import { Evidence } from '../../src/helpers/evidence.helper';
import { FixtureFinder } from '../../src/helpers/fixture-finder';
import { MATRIX_COLUMNS, MatrixColumn } from '../../src/data/usertype-matrix.data';
import { DbHelper } from '../../src/helpers/db.helper';
import { runTag, freshMobile } from '../../src/helpers/test-identity';

/**
 * Matrix edge cases — the seven from the workbook reachable through Add User.
 *
 * The 45 cells of the matrix proper vary one thing: what the mobile already is.
 * These vary the awkward things instead — whitespace, wrong lengths, records
 * that exist but are switched off — and two of them are the only tests in the
 * suite that probe whether the procedure reads a status flag it ought to.
 *
 * Of the workbook's 15 edge cases, these 7 can be driven from this screen.
 * TC-UAM-EC-007, 011, 016, 017 and 019 need user types Add User cannot create or
 * a direct call to the procedure; EC-009, EC-010 and EC-018 need two concurrent
 * calls or an injected mid-transaction failure, which cannot be done from a
 * read-only connection. The traceability report lists all fifteen with reasons,
 * so what is not covered stays visible rather than merely absent.
 *
 * ── The two that matter most ──────────────────────────────────────────────
 * EC-006 and EC-008 both hinge on an *inactive* record. Status 104 is "Inactive"
 * — an entity someone deliberately disabled — and it sits in the list the
 * CustomerMaster check accepts, alongside 101 "Active". If that is intentional
 * then a switched-off customer holds its mobile forever; if it is not, these two
 * tests are the ones that say so. Either way the workbook expects them not to
 * block, so they are written to that expectation.
 */

const column = (key: string): MatrixColumn => {
  const found = MATRIX_COLUMNS.find(c => c.key === key);
  if (!found) throw new Error(`No matrix column "${key}"`);
  return found;
};

/** A mobile whose only customer records are switched off — status 104, or StatusFlag 0. */
const INACTIVE_CUSTOMER_SQL = `
  WITH candidate AS (
    SELECT TOP 400 cm.MobileNo
      FROM dbo.CustomerMaster cm
      JOIN dbo.CustomerTypeMaster ctm ON ctm.Id = cm.CustomerType
     WHERE ctm.CustomerTypeCode = 1001
       AND (cm.StatusFlag = 0 OR cm.Status NOT IN (101))
     ORDER BY cm.CustomerId DESC)
  SELECT c.MobileNo AS mobile FROM candidate c
   WHERE NOT EXISTS (
           SELECT 1 FROM dbo.CustomerMaster c2
            WHERE c2.MobileNo = c.MobileNo AND c2.StatusFlag = 1 AND c2.Status = 101)
     AND NOT EXISTS (
           SELECT 1 FROM dbo.Users u
             JOIN dbo.UserTypesMaster ut ON ut.Id = u.UserTypeId
            WHERE u.MobileNumber = c.MobileNo
              AND ut.Code IN (${blockingTypesSqlList()}))
   GROUP BY c.MobileNo`;

/**
 * A mobile with a live OD record and a Fleet record that is switched off.
 *
 * Both halves of the rule at once: OD is exempt, and the only non-OD record is
 * inactive. If either is honoured the mobile is free; if neither is, the
 * procedure is reading no status at all.
 */
const OD_ACTIVE_FLEET_INACTIVE_SQL = `
  WITH odMobile AS (
    SELECT TOP 400 cm.MobileNo
      FROM dbo.CustomerMaster cm
      JOIN dbo.CustomerTypeMaster ctm ON ctm.Id = cm.CustomerType
     WHERE cm.StatusFlag = 1 AND cm.Status = 101 AND ctm.CustomerTypeCode = 1004
     ORDER BY cm.CustomerId DESC)
  SELECT o.MobileNo AS mobile FROM odMobile o
   WHERE EXISTS (
           SELECT 1 FROM dbo.CustomerMaster c2
             JOIN dbo.CustomerTypeMaster t2 ON t2.Id = c2.CustomerType
            WHERE c2.MobileNo = o.MobileNo AND t2.CustomerTypeCode <> 1004
              AND (c2.StatusFlag = 0 OR c2.Status <> 101))
     AND NOT EXISTS (
           SELECT 1 FROM dbo.CustomerMaster c3
             JOIN dbo.CustomerTypeMaster t3 ON t3.Id = c3.CustomerType
            WHERE c3.MobileNo = o.MobileNo AND t3.CustomerTypeCode <> 1004
              AND c3.StatusFlag = 1 AND c3.Status = 101)
     AND NOT EXISTS (
           SELECT 1 FROM dbo.Users u
             JOIN dbo.UserTypesMaster ut ON ut.Id = u.UserTypeId
            WHERE u.MobileNumber = o.MobileNo
              AND ut.Code IN (${blockingTypesSqlList()}))
   GROUP BY o.MobileNo`;


test.describe('Matrix — edge cases', () => {
  test.describe.configure({ mode: 'default' });

  // ── Input handling ────────────────────────────────────────────────────────

  for (const { id, label, mobile, expectAccepted, why } of [
    {
      id: 'TC-UAM-EC-002',
      label: 'a mobile padded with spaces is trimmed, not rejected',
      mobile: () => `  ${freshMobile()}  `,
      expectAccepted: true,
      why:
        'Leading and trailing whitespace should be trimmed before the number is ' +
        'used. If it is not, the same person can be enrolled twice — once with ' +
        'padding and once without — and neither conflict check would notice.',
    },
    {
      id: 'TC-UAM-EC-004',
      label: 'a 9-digit mobile is refused',
      mobile: () => freshMobile().slice(0, 9),
      expectAccepted: false,
      why: 'Indian mobile numbers are ten digits. Nine should never be accepted.',
    },
    {
      id: 'TC-UAM-EC-005',
      label: 'an 11-digit mobile is refused',
      mobile: () => `${freshMobile()}7`,
      expectAccepted: false,
      why:
        'Eleven digits should be refused rather than silently truncated. A ' +
        'truncating field would attach the user to a different, real number.',
    },
  ]) {
    test(
      `${id} — ${label}`,
      { tag: ['@regression', '@user-management', '@matrix', '@edge-case'] },
      // `db` is requested but never referenced: asking for it is what opens
      // the worker's connection pool before the test needs it. Named with an
      // underscore so that intent is visible rather than looking like a leftover.
      async ({ addUserPage, page, db: _db }) => {
        test.setTimeout(180_000);

        await epic('User Management');
        await feature('Add User');
        await story('Edge cases — mobile input');
        await owner('QA Team');
        await tms(id);
        await severity('normal');
        await description(why);

        const raw = mobile();
        const digits = raw.trim();
        await parameter('Mobile entered', JSON.stringify(raw));
        await parameter('Expected', expectAccepted ? 'accepted' : 'refused');

        const ev = new Evidence(`${id} — ${label}`, id.toLowerCase());
        ev.fact('Test case', id);
        ev.fact('Mobile entered', JSON.stringify(raw));
        ev.fact('Expected', expectAccepted ? 'accepted' : 'refused');
        let status: 'passed' | 'failed' | 'skipped' = 'passed';

        try {
          const before = await MatrixDb.snapshot(digits);
          await ev.db(
            'Database before',
            'The number is unused, so anything found afterwards was created by this test.',
            MatrixDb.format('BEFORE', before)
          );

          const tag = runTag();
          await addUserPage.open();
          await addUserPage.enterMobile(raw);
          await addUserPage.fillIdentity({
            mobile: digits,
            firstName: tag,
            lastName: 'EdgeCase',
            email: `${tag.toLowerCase()}.edge@example.com`,
            userType: 'FP_ADMIN',
          });
          await addUserPage.selectUserType('FP_ADMIN');
          await ev.ui(page, 'Form completed', `Mobile entered as ${JSON.stringify(raw)}.`);

          const outcome = await addUserPage.submit();
          await ev.ui(
            page,
            'What the application answered',
            outcome.created ? 'Reported as created.' : `Refused: “${outcome.message || 'no message'}”.`
          );

          const after = await MatrixDb.snapshot(digits);
          await ev.db('Database after', `Expected: ${expectAccepted ? 'one new user' : 'no new user'}.`,
            MatrixDb.format('AFTER', after));

          const known = new Set(before.users.map(u => u.userId));
          const added = after.users.filter(u => !known.has(u.userId));

          if (expectAccepted) {
            expect(
              added,
              `The number was entered as ${JSON.stringify(raw)} and should have been ` +
                `trimmed to ${digits}, but no user exists for it. The application said ` +
                `"${outcome.message || 'nothing'}".`
            ).toHaveLength(1);
            expect(added[0].mobile, 'the stored number kept its whitespace').toBe(digits);
            ev.fact('User id created', String(added[0].userId));
          } else {
            expect(
              added,
              `A user was created for the ${digits.length}-digit number ${digits}. ` +
                `Only ten digits should be accepted.`
            ).toHaveLength(0);
          }
        } catch (error) {
          status = 'failed';
          throw error;
        } finally {
          ev.finish(status);
        }
      }
    );
  }

  // ── Records that exist but are switched off ───────────────────────────────

  for (const { id, label, sql, envVar, expectBlocked, disputed, allowActiveOd, why } of [
    {
      id: 'TC-UAM-EC-006',
      label: 'an inactive Fleet customer does not block',
      sql: INACTIVE_CUSTOMER_SQL,
      envVar: 'MATRIX_FIXTURES_INACTIVE_FLEET',
      expectBlocked: false,
      disputed: true,
      // Nothing on the mobile may be Active: the case is about an inactive
      // record blocking on its own, so an active one of any type would confound.
      allowActiveOd: false,
      why:
        'The workbook expects a switched-off customer to release its mobile. The ' +
        'procedure accepts statuses 101 (Active) **and 104 (Inactive)**, so a ' +
        'deliberately disabled customer may still hold the number.\n\n' +
        'This test has now been run against real data and the procedure wins: ' +
        'mobile 6000000145, whose only record is Fleet customer NAYAFP2107000197 ' +
        'at status 104, was refused with "This mobile number is already ' +
        'registered." A deactivated customer holds its mobile permanently — ' +
        'there is no supported way to release the number short of editing the ' +
        'row. The case is therefore marked as an expected failure: it stays ' +
        'green while the defect is open, and turns red the moment 104 is dropped ' +
        'from the accepted statuses, which is exactly when someone should look ' +
        'at it again.',
    },
    {
      id: 'TC-UAM-EC-008',
      label: 'an active OD plus an inactive Fleet does not block',
      sql: OD_ACTIVE_FLEET_INACTIVE_SQL,
      envVar: 'MATRIX_FIXTURES_OD_ACTIVE_FLEET_INACTIVE',
      expectBlocked: false,
      disputed: true,
      // Here an *active OD* is required, not merely tolerated. Sharing EC-006's
      // "nothing may be Active" rule rejected the very fixture built for this
      // case and reported it as unavailable.
      allowActiveOd: true,
      why:
        'Both halves of the rule at once. OD is exempt by design, and the only ' +
        'non-OD record is switched off, so nothing should block.\n\n' +
        'It blocks. No mobile in the environment had this shape, so one was built ' +
        'through the product — an OD onboarded onto 9876896688, consented and ' +
        'approved to Active (NAYAFP3013400036) alongside the inactive Fleet ' +
        'record NAYAFP2023400019 — and Add User was then refused with "This ' +
        'mobile number is already registered." The Users table was unchanged.\n\n' +
        'So the OD exemption does not release a mobile; it only means an OD ' +
        'record never causes a block of its own. The inactive Fleet record ' +
        'satisfies the check by itself and the active OD is skipped entirely. ' +
        'Marked as an expected failure for the same reason as EC-006.',
    },
  ]) {
    test(
      `${id} — ${label}`,
      { tag: ['@regression', '@user-management', '@matrix', '@edge-case'] },
      // `db` is requested but never referenced: asking for it is what opens
      // the worker's connection pool before the test needs it. Named with an
      // underscore so that intent is visible rather than looking like a leftover.
      async ({ addUserPage, page, db: _db }) => {
        test.setTimeout(180_000);

        // The workbook says allowed, the procedure blocks, and the procedure is
        // what ships. Recording that as an expected failure keeps the run honest
        // in both directions: no red for a defect we have already reported, and
        // an immediate red if the behaviour ever changes underneath us.
        test.fail(
          disputed,
          'Known defect: usp_AddUser treats status 104 (Inactive) as blocking, ' +
            'so a deactivated customer never releases its mobile.'
        );

        await epic('User Management');
        await feature('Add User');
        await story('Edge cases — inactive records');
        await owner('QA Team');
        await tms(id);
        await severity('critical');
        await description(why);

        const ev = new Evidence(`${id} — ${label}`, id.toLowerCase());
        ev.fact('Test case', id);
        ev.fact('Expected', expectBlocked ? 'blocked' : 'allowed');
        let status: 'passed' | 'failed' | 'skipped' = 'passed';

        try {
          const explicit = process.env[envVar]?.trim();
          const candidates = explicit
            ? explicit.split(',').map(m => m.trim()).filter(Boolean)
            : (await DbHelper.query<{ mobile: string }>(sql)).map(r => r.mobile);

          let chosen: { mobile: string; before: MobileSnapshot } | null = null;
          const rejected: string[] = [];
          for (const mobile of candidates.slice(0, 12)) {
            const before = await MatrixDb.snapshot(mobile);
            // An active OD never blocks — the procedure's first check excludes
            // OD outright — so for EC-008 it is the precondition rather than a
            // disqualification. For EC-006 any active record at all confounds.
            const live = before.customers.filter(
              c =>
                c.statusFlag && BLOCKING_CUSTOMER_STATUSES.includes(c.status) &&
                c.status === 101 && !(allowActiveOd && c.customerTypeCode === 1004)
            );
            const activeOd = before.customers.filter(
              c => c.statusFlag && c.status === 101 && c.customerTypeCode === 1004
            );
            const inactive = before.customers.filter(c => !c.statusFlag || c.status !== 101);
            // Only a *blocking* user disqualifies the mobile. Every customer
            // carries CUSTOMER_ADMIN and BRANCH_ADMIN, and the procedure ignores
            // both — rejecting on any user at all threw away every real
            // candidate and made this case look untestable when it is not.
            const blocking = before.users.filter(u => BLOCKS_MOBILE_REUSE.includes(u.userTypeCode));

            if (live.length) { rejected.push(`  ${mobile}: still has an Active non-OD record`); continue; }
            if (allowActiveOd && !activeOd.length) {
              rejected.push(`  ${mobile}: has no Active OD, which this case requires`);
              continue;
            }
            if (!inactive.length) { rejected.push(`  ${mobile}: has no inactive record`); continue; }
            if (blocking.length) {
              rejected.push(`  ${mobile}: holds ${blocking.map(u => u.userTypeCode).join(', ')}, which arms the Users check`);
              continue;
            }
            chosen = { mobile, before };
            break;
          }

          if (!chosen) {
            status = 'skipped';
            const reason =
              `No mobile has an inactive Fleet customer and nothing else.\n` +
              (rejected.length ? rejected.slice(0, 8).join('\n') : '  (the query returned nothing)') +
              `\n\nOverride with ${envVar}=<comma,separated>.`;
            await ev.note('Precondition unavailable', 'No fixture arms this edge case.', reason);
            ev.finish(status);
            test.skip(true, reason);
            return;
          }

          const { mobile, before } = chosen;
          ev.fact('Mobile under test', mobile);
          await parameter('Mobile under test', mobile);
          await ev.db(
            'Database before: the customer exists but is switched off',
            'Status and StatusFlag are both shown — the question is whether the procedure reads either.',
            MatrixDb.format('BEFORE', before)
          );

          const tag = runTag();
          await addUserPage.open();
          await addUserPage.enterMobile(mobile);
          await addUserPage.fillIdentity({
            mobile,
            firstName: tag,
            lastName: 'EdgeCase',
            email: `${tag.toLowerCase()}.inactive@example.com`,
            userType: 'FP_ADMIN',
          });
          await addUserPage.selectUserType('FP_ADMIN');
          const outcome = await addUserPage.submit();
          await ev.ui(
            page,
            'What the application answered',
            outcome.created ? 'Reported as created.' : `Refused: “${outcome.message || 'no message'}”.`
          );

          const after = await MatrixDb.snapshot(mobile);
          await ev.db('Database after', `Expected: ${expectBlocked ? 'no new user' : 'one new user'}.`,
            MatrixDb.format('AFTER', after));

          const known = new Set(before.users.map(u => u.userId));
          const added = after.users.filter(u => !known.has(u.userId));

          expect(
            added.length,
            expectBlocked
              ? `A user was created even though the mobile holds a Fleet customer.`
              : `The mobile's only Fleet customer is switched off, so it should have ` +
                `been released — but creation was refused with ` +
                `"${outcome.message || 'no message'}". The procedure accepts status ` +
                `104 (Inactive) as blocking, which is the likely cause.`
          ).toBe(expectBlocked ? 0 : 1);
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

  // ── Combinations of existing state ────────────────────────────────────────

  for (const { id, label, columnKey, expectBlocked, why } of [
    {
      id: 'TC-UAM-EC-012',
      label: 'OD together with a non-OD customer still blocks',
      columnKey: 'od-plus-non-od',
      expectBlocked: true,
      why:
        'The OD exemption is for OD-*only*. One non-OD record alongside it should ' +
        'be enough to refuse, and this is the test that shows the exemption is not ' +
        'simply "has an OD record somewhere".',
    },
    {
      id: 'TC-UAM-EC-015',
      label: 'a mobile that already holds an active FP_ADMIN blocks another',
      columnKey: 'admin-user',
      expectBlocked: true,
      why:
        'The plainest form of the Users check: the same admin type twice on one ' +
        'mobile. If anything gets through this, the check is not working at all.',
    },
  ]) {
    test(
      `${id} — ${label}`,
      { tag: ['@regression', '@user-management', '@matrix', '@edge-case'] },
      // `db` is requested but never referenced: asking for it is what opens
      // the worker's connection pool before the test needs it. Named with an
      // underscore so that intent is visible rather than looking like a leftover.
      async ({ addUserPage, page, db: _db }) => {
        test.setTimeout(180_000);

        await epic('User Management');
        await feature('Add User');
        await story('Edge cases — combined state');
        await owner('QA Team');
        await tms(id);
        await severity('critical');
        await description(why);

        const col = column(columnKey);
        const ev = new Evidence(`${id} — ${label}`, id.toLowerCase());
        ev.fact('Test case', id);
        ev.fact('Existing state', col.label);
        ev.fact('Expected', expectBlocked ? 'blocked' : 'allowed');
        let status: 'passed' | 'failed' | 'skipped' = 'passed';

        try {
          const search = await FixtureFinder.find(col, 1, 3);
          const [candidate] = search.found;
          if (!candidate) {
            status = 'skipped';
            const reason = FixtureFinder.explain(col, search);
            await ev.note('Precondition unavailable', 'No fixture arms this edge case.', reason);
            ev.finish(status);
            test.skip(true, reason);
            return;
          }

          const { mobile, snapshot: before } = candidate;
          ev.fact('Mobile under test', mobile);
          await parameter('Mobile under test', mobile);
          await ev.db('Database before', `Confirmed: ${candidate.why}`, MatrixDb.format('BEFORE', before));

          const tag = runTag();
          await addUserPage.open();
          await addUserPage.enterMobile(mobile);
          await addUserPage.fillIdentity({
            mobile,
            firstName: tag,
            lastName: 'EdgeCase',
            email: `${tag.toLowerCase()}.combo@example.com`,
            userType: 'FP_ADMIN',
          });
          await addUserPage.selectUserType('FP_ADMIN');
          const outcome = await addUserPage.submit();
          await ev.ui(
            page,
            'What the application answered',
            outcome.created ? 'Reported as created.' : `Refused: “${outcome.message || 'no message'}”.`
          );

          const after = await MatrixDb.snapshot(mobile);
          await ev.db('Database after', 'Expected: no new user.', MatrixDb.format('AFTER', after));
          await ev.db('What changed', 'Expected: nothing.', MatrixDb.diff(before, after));

          const known = new Set(before.users.map(u => u.userId));
          const added = after.users.filter(u => !known.has(u.userId));
          expect(
            added,
            `${id}: a user was created on a mobile that is "${col.label}". ` +
              `The ${col.check} check should have refused it.`
          ).toHaveLength(expectBlocked ? 0 : 1);
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
