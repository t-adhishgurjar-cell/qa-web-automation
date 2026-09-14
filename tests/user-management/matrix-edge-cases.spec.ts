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

  // ── Does a refusal say why? ───────────────────────────────────────────────

  /**
   * TC-UAM-EC-021 — three checks, three reasons, one sentence.
   *
   * usp_AddUser can refuse for entirely different reasons: the number belongs
   * to a customer, or to another member of staff, or to a retail outlet. What
   * the admin is told is the same either way.
   *
   * Every refusal this suite has captured, across all three checks, reads
   * "This mobile number is already registered." — measured on Fleet, Non Fleet,
   * Corporate and mixed customer mobiles, and on mobiles holding an RO user, an
   * OTHER_RO user and an admin user. Seven distinct causes, one message.
   *
   * It matters because the causes need different responses. A number held by a
   * customer may be legitimately reusable once that customer is dealt with; a
   * number held by another administrator is somebody else's account and never
   * will be. The admin cannot tell which they are looking at, so the only
   * available action is to ask someone with database access.
   *
   * Written as an expected failure: it records what ships and turns red the day
   * the messages are made distinct, which is when the matrix should be reread.
   */
  test(
    'TC-UAM-EC-021 — a refusal says which check blocked it',
    { tag: ['@regression', '@user-management', '@matrix', '@edge-case'] },
    async ({ addUserPage, page, db: _db }) => {
      test.setTimeout(240_000);

      await epic('User Management');
      await feature('Add User');
      await story('Edge cases — what the admin is told');
      await owner('QA Team');
      await tms('TC-UAM-EC-021');
      await severity('normal');
      await description(
        'Refuses the same user type on two mobiles blocked for different ' +
          'reasons — one by the CustomerMaster check, one by the Users check — ' +
          'and compares what the application said. Identical wording means the ' +
          'admin cannot tell the two situations apart.'
      );

      // Known defect: the two messages are the same today.
      test.fail(
        true,
        'Known defect: every refusal reads "This mobile number is already ' +
          'registered." regardless of which of the three checks fired.'
      );

      const ev = new Evidence(
        'TC-UAM-EC-021 — a refusal says which check blocked it',
        'tc-uam-ec-021'
      );
      ev.fact('Test case', 'TC-UAM-EC-021');
      let status: 'passed' | 'failed' | 'skipped' = 'passed';

      try {
        const cases: { label: string; columnKey: string; message?: string }[] = [
          { label: 'blocked by a customer record', columnKey: 'fleet-only' },
          { label: 'blocked by another staff user', columnKey: 'admin-user' },
        ];

        for (const [index, subject] of cases.entries()) {
          const col = column(subject.columnKey);
          const search = await FixtureFinder.find(col, 1, index);
          if (!search.found.length) {
            status = 'skipped';
            const reason = FixtureFinder.explain(col, search);
            await ev.note('Precondition unavailable', `No mobile ${subject.label}.`, reason);
            ev.finish(status);
            test.skip(true, reason);
            return;
          }

          const mobile = search.found[0].mobile;
          const before = await MatrixDb.snapshot(mobile);
          await ev.db(
            `Database before — ${subject.label}`,
            'Which check this mobile arms.',
            MatrixDb.format('BEFORE', before)
          );

          const tag = runTag();
          await addUserPage.open();
          await addUserPage.enterMobile(mobile);
          await addUserPage.fillIdentity({
            mobile,
            firstName: tag,
            lastName: 'Ec021',
            email: `${tag.toLowerCase()}.ec021@example.com`,
            userType: 'FP_ADMIN',
          });
          await addUserPage.selectUserType('FP_ADMIN');
          const outcome = await addUserPage.submit();
          subject.message = (outcome.message || '').trim();

          await ev.ui(
            page,
            `What the admin is told — ${subject.label}`,
            outcome.created
              ? 'Unexpectedly created.'
              : `Refused: \u201c${subject.message || 'no message'}\u201d.`
          );
          ev.fact(subject.label, subject.message || '(no message)');

          // A creation here means the fixture did not arm what it promised, and
          // the comparison below would be between a refusal and a success.
          expect(
            outcome.created,
            `${mobile} was supposed to be ${subject.label}, but Add User ` +
              `created the user instead. The fixture does not arm this check.`
          ).toBe(false);
        }

        const [customerCase, staffCase] = cases;
        await ev.note(
          'The comparison',
          customerCase.message === staffCase.message
            ? 'Both causes produced the same sentence.'
            : 'The two causes produced different sentences.',
          `blocked by a customer record  : "${customerCase.message}"\n` +
            `blocked by another staff user : "${staffCase.message}"\n\n` +
            `These are different situations. One may become reusable, the other ` +
            `belongs to somebody else's account and never will.`
        );

        expect(
          staffCase.message,
          `Both refusals read "${customerCase.message}". The admin cannot tell ` +
            `whether the number belongs to a customer or to another member of ` +
            `staff, and the two need different responses.`
        ).not.toBe(customerCase.message);
      } catch (error) {
        if (status !== 'skipped') status = 'failed';
        throw error;
      } finally {
        if (status !== 'skipped') ev.finish(status);
      }
    }
  );

  // ── Malformed input, and where it is caught ──────────────────────────────

  /**
   * TC-UAM-EC-001 and EC-003 — input the field should never accept.
   *
   * An empty mobile and a mobile with letters in it. The workbook asks whether
   * the procedure handles them gracefully; from the UI the more useful question
   * is whether they reach the procedure at all, so each case records where it
   * was stopped rather than only that it was.
   *
   * Both are expected to be refused. Neither should create a user, and a crash
   * — a 500, a stack trace, a blank page — is a distinct and worse outcome than
   * a refusal, so the assertion separates the two.
   */
  for (const { id, label, mobile, why } of [
    {
      id: 'TC-UAM-EC-001',
      label: 'an empty mobile is refused without crashing',
      mobile: '',
      why:
        'The workbook asks that a NULL or empty mobile be handled gracefully. ' +
        'The UI cannot send SQL NULL, so this sends the nearest thing it can — ' +
        'nothing at all — and checks that the application refuses rather than ' +
        'breaks, and that no user is written.',
    },
    {
      id: 'TC-UAM-EC-003',
      label: 'a mobile containing letters is refused',
      mobile: '98765ABCDE',
      why:
        'Ten characters, but five of them letters. Worth testing rather than ' +
        'assuming: 4800885800 sits in the Users table today despite not being a ' +
        'valid Indian mobile, so something, somewhere, has accepted a number it ' +
        'should not have.',
    },
  ]) {
    test(
      `${id} — ${label}`,
      { tag: ['@regression', '@user-management', '@matrix', '@edge-case'] },
      async ({ addUserPage, page, db: _db }) => {
        test.setTimeout(180_000);

        await epic('User Management');
        await feature('Add User');
        await story('Edge cases — malformed mobile');
        await owner('QA Team');
        await tms(id);
        await severity('normal');
        await description(why);

        const ev = new Evidence(`${id} — ${label}`, id.toLowerCase());
        ev.fact('Test case', id);
        ev.fact('Mobile entered', JSON.stringify(mobile));
        ev.fact('Expected', 'refused, and nothing written');
        // No skip path here: both cases supply their own input and need no
        // fixture, so the status is only ever passed or failed.
        let status: 'passed' | 'failed' = 'passed';

        try {
          // Counted across the whole table, not for one mobile: an empty or
          // malformed value has no mobile to take a snapshot of, and the
          // question is whether *any* user appeared.
          const countUsers = async (): Promise<number> => {
            const rows = await DbHelper.query<{ n: number }>(
              `SELECT COUNT(*) AS n FROM dbo.Users`
            );
            return rows[0]?.n ?? 0;
          };

          const before = await countUsers();
          ev.fact('Users before', String(before));

          await addUserPage.open();
          await addUserPage.enterMobile(mobile);

          const tag = runTag();
          await addUserPage.fillIdentity({
            mobile,
            firstName: tag,
            lastName: 'EdgeCase',
            email: `${tag.toLowerCase()}.malformed@example.com`,
            userType: 'FP_ADMIN',
          });
          await addUserPage.selectUserType('FP_ADMIN');
          const outcome = await addUserPage.submit();

          // A crash reads differently from a refusal and is worth naming.
          const looksLikeCrash = /error|exception|runtime|stack|500/i.test(
            await page.title().catch(() => '')
          );

          await ev.ui(
            page,
            'What the application did',
            outcome.created
              ? 'Reported as created.'
              : `Refused: \u201c${outcome.message || 'no message — stopped before submitting'}\u201d.`
          );

          const after = await countUsers();
          ev.fact('Users after', String(after));
          await ev.note(
            'Where it was stopped',
            outcome.message
              ? 'The application answered, so the request reached the server.'
              : 'Nothing was said, which is the signature of client-side validation.',
            `message : "${outcome.message || '(none)'}"\n` +
              `users   : ${before} -> ${after}\n` +
              `url     : ${outcome.finalUrl}`
          );

          expect(looksLikeCrash, 'The page looks like an unhandled error.').toBe(false);
          expect(
            after,
            `Entering ${JSON.stringify(mobile)} created a user. It should have ` +
              `been refused at some layer.`
          ).toBe(before);
          expect(
            outcome.created,
            `The application reported success for ${JSON.stringify(mobile)}.`
          ).toBe(false);
        } catch (error) {
          status = 'failed';
          throw error;
        } finally {
          ev.finish(status);
        }
      }
    );
  }

  // ── Where validation happens ─────────────────────────────────────────────

  /**
   * TC-UAM-EC-022 — does the browser catch a bad mobile before the server does?
   *
   * The workbook's reasoning is cost: a number that is obviously malformed
   * should never become a database round trip. So this watches the network
   * while submitting a plainly invalid mobile, and reports whether a request
   * went out.
   *
   * Either answer is a legitimate result and neither is a defect on its own, so
   * nothing here asserts a preference. What it asserts is the part that matters
   * in both worlds: no user is created. The observation about where it was
   * caught goes into the evidence for whoever is deciding.
   */
  test(
    'TC-UAM-EC-022 — an invalid mobile is caught before the server is called',
    { tag: ['@regression', '@user-management', '@matrix', '@edge-case'] },
    async ({ addUserPage, page, db: _db }) => {
      test.setTimeout(180_000);

      await epic('User Management');
      await feature('Add User');
      await story('Edge cases — where validation happens');
      await owner('QA Team');
      await tms('TC-UAM-EC-022');
      await severity('minor');
      await description(
        'Submits an obviously invalid mobile and watches the network. Records ' +
          'whether the browser stopped it or the server did; asserts only that ' +
          'no user was created.'
      );

      const ev = new Evidence(
        'TC-UAM-EC-022 — an invalid mobile is caught before the server is called',
        'tc-uam-ec-022'
      );
      ev.fact('Test case', 'TC-UAM-EC-022');
      let status: 'passed' | 'failed' = 'passed';

      try {
        const INVALID = '12345';
        ev.fact('Mobile entered', INVALID);

        const calls: string[] = [];
        const record = (url: string): void => {
          if (/\/User\/(AddUser|SaveUser|CreateUser|CheckMobile|ValidateMobile)/i.test(url)) {
            calls.push(url);
          }
        };
        page.on('request', req => { if (req.method() !== 'GET') record(req.url()); });

        const rows = await DbHelper.query<{ n: number }>(`SELECT COUNT(*) AS n FROM dbo.Users`);
        const before = rows[0]?.n ?? 0;

        await addUserPage.open();
        // Cleared after open() so the page's own load requests are not counted
        // as a submission attempt.
        calls.length = 0;

        await addUserPage.enterMobile(INVALID);
        const tag = runTag();
        await addUserPage.fillIdentity({
          mobile: INVALID,
          firstName: tag,
          lastName: 'EdgeCase',
          email: `${tag.toLowerCase()}.ec022@example.com`,
          userType: 'FP_ADMIN',
        });
        await addUserPage.selectUserType('FP_ADMIN');
        const outcome = await addUserPage.submit();

        await ev.ui(
          page,
          'What the application did',
          outcome.created
            ? 'Reported as created.'
            : `Refused: \u201c${outcome.message || 'no message'}\u201d.`
        );

        const afterRows = await DbHelper.query<{ n: number }>(`SELECT COUNT(*) AS n FROM dbo.Users`);
        const after = afterRows[0]?.n ?? 0;

        const caughtInBrowser = calls.length === 0;
        ev.fact('Caught by', caughtInBrowser ? 'the browser' : 'the server');
        await ev.note(
          'Where it was caught',
          caughtInBrowser
            ? 'No submission request left the browser.'
            : `${calls.length} request(s) were sent before it was refused.`,
          `user-creation requests observed : ${calls.length}\n` +
            (calls.length ? `${calls.map(u => `  ${u}`).join('\n')}\n` : '') +
            `application said               : "${outcome.message || '(nothing)'}"\n` +
            `users                          : ${before} -> ${after}\n\n` +
            `The workbook prefers the browser to catch this, to save a round ` +
            `trip. Server-side refusal is correct behaviour too, so this is ` +
            `recorded rather than asserted.`
        );

        expect(after, `A user was created for the invalid mobile ${INVALID}.`).toBe(before);
        expect(outcome.created, 'The application reported success for an invalid mobile.').toBe(false);
      } catch (error) {
        status = 'failed';
        throw error;
      } finally {
        ev.finish(status);
      }
    }
  );

  /**
   * TC-UAM-EC-020 — the UI passes the procedure's refusal on to the admin.
   *
   * The blocked path end to end: a mobile that belongs to a Fleet customer, and
   * whether the person at the screen is told anything at all. The matrix
   * already proves no user is created; this is about whether the refusal
   * surfaces rather than failing silently, which this application does
   * elsewhere — the Approve button and the wizard's Next both return quietly
   * when validation fails.
   *
   * It deliberately does not assert on the wording. EC-021 covers the fact that
   * the wording is the same for every cause; here the bar is only that
   * something is said.
   */
  test(
    'TC-UAM-EC-020 — a blocked creation tells the admin something',
    { tag: ['@regression', '@user-management', '@matrix', '@edge-case'] },
    async ({ addUserPage, page, db: _db }) => {
      test.setTimeout(180_000);

      await epic('User Management');
      await feature('Add User');
      await story('Edge cases — what the admin is told');
      await owner('QA Team');
      await tms('TC-UAM-EC-020');
      await severity('normal');
      await description(
        'Attempts FP_ADMIN on a mobile held by a Fleet customer and checks that ' +
          'the refusal is actually displayed. The wording is EC-021 business; ' +
          'this only asks that the admin is not left guessing.'
      );

      const ev = new Evidence(
        'TC-UAM-EC-020 — a blocked creation tells the admin something',
        'tc-uam-ec-020'
      );
      ev.fact('Test case', 'TC-UAM-EC-020');
      let status: 'passed' | 'failed' | 'skipped' = 'passed';

      try {
        const col = column('fleet-only');
        const search = await FixtureFinder.find(col, 1);
        if (!search.found.length) {
          status = 'skipped';
          const reason = FixtureFinder.explain(col, search);
          await ev.note('Precondition unavailable', 'No Fleet-only mobile.', reason);
          ev.finish(status);
          test.skip(true, reason);
          return;
        }

        const mobile = search.found[0].mobile;
        await parameter('Mobile under test', mobile);
        ev.fact('Mobile under test', mobile);

        const before = await MatrixDb.snapshot(mobile);
        await ev.db(
          'Database before',
          'A Fleet customer holds this number, so the CustomerMaster check is armed.',
          MatrixDb.format('BEFORE', before)
        );

        const tag = runTag();
        await addUserPage.open();
        await addUserPage.enterMobile(mobile);
        await addUserPage.fillIdentity({
          mobile,
          firstName: tag,
          lastName: 'EdgeCase',
          email: `${tag.toLowerCase()}.ec020@example.com`,
          userType: 'FP_ADMIN',
        });
        await addUserPage.selectUserType('FP_ADMIN');
        const outcome = await addUserPage.submit();

        await ev.ui(
          page,
          'What the admin sees',
          outcome.message
            ? `Refused: \u201c${outcome.message}\u201d.`
            : 'Nothing was displayed.'
        );

        const after = await MatrixDb.snapshot(mobile);
        await ev.db('Database after', 'Expected: no new user.', MatrixDb.format('AFTER', after));

        const known = new Set(before.users.map(u => u.userId));
        const added = after.users.filter(u => !known.has(u.userId));

        expect(added, 'A user was created on a mobile held by a Fleet customer.').toHaveLength(0);
        expect(
          (outcome.message || '').trim(),
          'The creation was blocked and the admin was told nothing. A silent ' +
            'refusal is indistinguishable from a broken button.'
        ).not.toBe('');
      } catch (error) {
        if (status !== 'skipped') status = 'failed';
        throw error;
      } finally {
        if (status !== 'skipped') ev.finish(status);
      }
    }
  );
});
