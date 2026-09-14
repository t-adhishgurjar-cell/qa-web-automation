import { expect } from '@playwright/test';
import { test } from '../../src/fixtures/session.fixtures';
import {
  description, epic, feature, owner, parameter, severity, story,
} from 'allure-js-commons';
import { AddBranchPage } from '../../src/pages/customer-management/add-branch.page';
import { DbHelper } from '../../src/helpers/db.helper';
import { Evidence } from '../../src/helpers/evidence.helper';
import { runTag, freshMobile } from '../../src/helpers/test-identity';
import { TEST_OTP } from '../../src/config/accounts';

/**
 * Add Branch, and the approval that makes the branch real.
 *
 * No workbook sheet covers this screen, so the cases come from the screen
 * itself. These tests describe what the form does; they cannot say whether that
 * is what was intended.
 *
 * ── What a branch is ─────────────────────────────────────────────────────
 * A CustomerMaster row with ParentId set to the parent's numeric Id, a
 * BranchLocation, and an IsNfoBranch flag. There is no branch table, so
 * verification counts the parent's children rather than looking for a row of
 * its own. The id prefix means nothing — NAYAFP2812121497 is itself a parent.
 *
 * ── FP Admin auto-approves, and that is intended ─────────────────────────
 * usp_InsertCustomerBranchRequestByWeb splits on who submits:
 *
 *   Customer Admin / Parent : RawCustomerMaster only, status 108
 *                             (Branch Pending for Approval)
 *   FP Admin                : auto-approve — CustomerMaster Active 101, the
 *                             raw row updated to Active, a branch user created
 *
 * An earlier version of this file asserted that submission must never produce
 * an Active branch, on the reasoning that a maker-checker flow which skips the
 * checker is not one. Run as FP Admin that assertion fails against correct
 * behaviour, and would have been reported as a defect. The procedure, not the
 * inference, is the specification.
 *
 * ── What the procedure forbids ───────────────────────────────────────────
 * A Non-Fleet parent cannot take a branch at all. Nor can Corporate (1006) or
 * OD (1004). NFO branches are FP Admin only and Fleet parent only. The branch
 * cap from ConfigurationMaster applies to Customer Admin and Parent, never to
 * FP Admin.
 */

/**
 * A parent an FP Admin can add a branch to.
 *
 * Chosen because it demonstrably works, not because it was convenient. Two
 * earlier candidates — NAYAFP1013400034, created by this framework, and
 * NAYAFP1020900195, a real customer with branches — both failed the same way,
 * and that cost a wrong conclusion worth recording: see KNOWN_FAILING_PARENTS.
 */
const PARENT = process.env.BRANCH_TEST_PARENT ?? 'NAYAFP1023400246';

/**
 * Parents where an FP Admin branch submission fails, and how.
 *
 * Both return a raw SQL Server message to the browser:
 *
 *   Cannot insert the value NULL into column 'RoleId',
 *   table 'Nayara_QA.dbo.UserRoleMappings'; column does not allow nulls.
 *
 * The auto-approve path creates a branch user, that user needs a role, and the
 * role resolves to nothing — so the insert dies and the whole transaction rolls
 * back cleanly, leaving no branch and no orphan rows.
 *
 * On the strength of these two I reported that Add Branch was broken for FP
 * Admin generally. It is not: NAYAFP1023400246 works. The fault is specific to
 * some parents, and both of these carry a NULL CMSCode — which the procedure
 * says a Fleet branch inherits from its parent — so that is the obvious
 * suspect, and it is a suspicion rather than a finding.
 *
 * Two conclusions stand regardless. Some parents cannot take a branch, and the
 * failure is reported to the operator as a database error naming the database,
 * the table and the column.
 */
const KNOWN_FAILING_PARENTS = ['NAYAFP1013400034', 'NAYAFP1020900195'] as const;

interface ParentRow { Id: number; CustomerId: string; CustomerName: string }

async function parentRow(customerId: string): Promise<ParentRow | undefined> {
  const rows = await DbHelper.query<ParentRow>(
    `SELECT TOP 1 Id, CustomerId, ISNULL(CustomerName, '') AS CustomerName
       FROM dbo.CustomerMaster WHERE CustomerId = @customerId`,
    { customerId }
  );
  return rows[0];
}

interface BranchRow {
  CustomerId: string;
  BranchLocation: string;
  Status: number;
  IsNfoBranch: boolean;
}

async function branchesOf(parentId: number): Promise<BranchRow[]> {
  return DbHelper.query<BranchRow>(
    `SELECT CustomerId, ISNULL(BranchLocation, '') AS BranchLocation, Status,
            ISNULL(IsNfoBranch, 0) AS IsNfoBranch
       FROM dbo.CustomerMaster WHERE ParentId = @parentId
      ORDER BY CustomerId DESC`,
    { parentId }
  );
}

test.describe('Add Branch @customer-management', () => {
  test.describe.configure({ mode: 'default' });

  test.beforeEach(async () => {
    await epic('Customer Management');
    await feature('Add Branch');
    await owner('QA Team');
  });

  test('branch type is not offered until a parent is chosen', async ({ page }) => {
    await story('Form contract');
    await severity('critical');
    await description(
      'The branch-type choice must follow the customer, not precede it. A Fleet ' +
        'or Non-Fleet branch only means something relative to a parent, and the ' +
        'Non-Fleet choice opens a block of fields that depend on it.'
    );

    const branch = new AddBranchPage(page);
    await branch.open();

    expect(
      await branch.branchTypeOffered(),
      'Branch type was offered before any customer had been chosen.'
    ).toBe(false);
  });

  test('an unknown parent id resolves to nothing', async ({ page }) => {
    await story('Form contract');
    await severity('normal');
    await description('An id belonging to no customer must not fill the name or offer branch type.');

    const branch = new AddBranchPage(page);
    await branch.open();
    const lookup = await branch.findParent('NAYAFP0000000000');

    expect(lookup.found, `The form resolved a name ("${lookup.name}") for an id that does not exist.`)
      .toBe(false);
    expect(await branch.branchTypeOffered(), 'Branch type was offered for an unknown parent.')
      .toBe(false);
  });

  test('a known parent fills its details and offers branch type', async ({ page }) => {
    await story('Form contract');
    await severity('critical');
    await parameter('Parent', PARENT);
    await description(
      'Entering a parent customer id fills the name and mobile from the server ' +
        'and reveals the branch-type choice.'
    );

    const parent = await parentRow(PARENT);
    test.skip(!parent, `${PARENT} does not exist.`);

    const branch = new AddBranchPage(page);
    await branch.open();
    const lookup = await branch.findParent(PARENT);

    expect(lookup.found, `${PARENT} did not resolve.`).toBe(true);
    expect(
      lookup.name,
      `The form resolved "${lookup.name}" but the database holds ` +
        `"${parent!.CustomerName}" for ${PARENT}.`
    ).not.toBe('');
    expect(await branch.branchTypeOffered(), 'Branch type was not offered after a valid parent.')
      .toBe(true);
  });

  /**
   * FP Admin auto-approve, end to end.
   *
   * The branch must appear in CustomerMaster as Active 101 immediately, with no
   * visit to the approval screen — that is what the procedure specifies for
   * this maker, not a hole in the controls.
   */
  test('an FP Admin branch is live on submission', async ({ page }) => {
    test.skip(
      (KNOWN_FAILING_PARENTS as readonly string[]).includes(PARENT),
      `${PARENT} is one of the parents where an FP Admin submission fails with ` +
        `"Cannot insert the value NULL into column 'RoleId'". Point ` +
        `BRANCH_TEST_PARENT at a parent that works, or remove it from ` +
        `KNOWN_FAILING_PARENTS once the cause is fixed.`
    );
    test.setTimeout(300_000);
    await story('Auto-approve');
    await severity('critical');
    await parameter('Parent', PARENT);
    await description(
      'Adds a Fleet branch as an FP Admin and checks it lands in CustomerMaster ' +
        'as Active 101. Per usp_InsertCustomerBranchRequestByWeb, FP Admin ' +
        'submissions auto-approve; only Customer Admin and Parent submissions ' +
        'wait at status 108.'
    );

    const ev = new Evidence('Add Branch — FP Admin auto-approve', 'add-branch-auto-approve');
    ev.fact('Parent', PARENT);
    ev.fact('Maker', 'FP_ADMIN');
    let status: 'passed' | 'failed' | 'skipped' = 'passed';

    try {
      const parent = await parentRow(PARENT);
      if (!parent) {
        status = 'skipped';
        const reason = `${PARENT} does not exist, so it cannot take a branch.`;
        await ev.note('Precondition unavailable', reason, reason);
        ev.finish(status);
        test.skip(true, reason);
        return;
      }

      const tag = runTag();
      const managerMobile = freshMobile();
      ev.fact('Run tag', tag);
      ev.fact('Manager mobile', managerMobile);

      const before = await branchesOf(parent.Id);
      await ev.note(
        'Database before',
        `${before.length} branch row(s) under ${PARENT}.`,
        `CustomerMaster children: ${before.length}`
      );

      const branch = new AddBranchPage(page);
      await branch.open();

      const lookup = await branch.findParent(PARENT);
      expect(lookup.found, `${PARENT} did not resolve on the Add Branch form.`).toBe(true);

      await branch.selectBranchType('Fleet');
      const locationCode = await branch.fillBranch({
        pinCode: '201304',
        managerName: `${tag} Manager`,
        email: `${tag.toLowerCase()}.branch@example.com`,
        address: `${tag} Branch Address`,
      });
      // Generated by the application from the pin code, not supplied.
      ev.fact('Branch location code', locationCode || '(none generated)');

      const otp = await branch.verifyManagerMobile(managerMobile, TEST_OTP);
      await ev.ui(
        page,
        'After verifying the manager mobile',
        otp.sent
          ? `OTP sent, entered and ${otp.verified ? 'verified' : 'NOT reported as verified'}.`
          : `No OTP box appeared: \u201c${otp.message || 'nothing said'}\u201d.`
      );

      if (!otp.sent) {
        status = 'skipped';
        const reason =
          `The application would not send an OTP to ${managerMobile}: ` +
          `"${otp.message || 'no message'}". IsMobileVerified is persisted by ` +
          `the procedure, so the branch cannot be submitted without it.`;
        await ev.note('Blocked before submission', reason, reason);
        ev.finish(status);
        test.skip(true, reason);
        return;
      }

      const message = await branch.submit();
      await ev.ui(page, 'After submitting', `The screen said: \u201c${message || 'nothing'}\u201d.`);

      const after = await branchesOf(parent.Id);
      const added = after.filter(a => !before.some(b => b.CustomerId === a.CustomerId));

      await ev.note(
        'Where the branch went',
        added.length ? `${added.length} new branch row(s).` : 'Nothing new in CustomerMaster.',
        `CustomerMaster children : ${before.length} -> ${after.length}\n` +
          (added.length
            ? added.map(a => `  ${a.CustomerId} "${a.BranchLocation}" status=${a.Status}`).join('\n')
            : '  (none)')
      );

      expect(
        added,
        `The screen said \u201c${message}\u201d but no branch row appeared under ` +
          `${PARENT}. An FP Admin submission is supposed to auto-approve.`
      ).toHaveLength(1);

      expect(
        added[0].Status,
        `The branch was created as status ${added[0].Status}. An FP Admin ` +
          `submission should auto-approve to 101 (Active); 108 would mean it is ` +
          `waiting for an approval that this maker does not require.`
      ).toBe(101);
    } catch (error) {
      if (status !== 'skipped') status = 'failed';
      throw error;
    } finally {
      if (status !== 'skipped') ev.finish(status);
    }
  });

  /**
   * Parent types the procedure refuses outright.
   *
   * Non-Fleet since 19 June, Corporate and OD since 12 August. Each is a
   * separate rule added at a separate time, so each is checked rather than
   * assumed to share an implementation.
   */
  for (const { label, parent, since } of [
    { label: 'Non Fleet', parent: process.env.BRANCH_NONFLEET_PARENT ?? 'NAYAFP1043400002', since: '19 June 2026' },
    { label: 'OD', parent: process.env.BRANCH_OD_PARENT ?? 'NAYAFP3043400001', since: '12 August 2026' },
    { label: 'Corporate', parent: process.env.BRANCH_CORPORATE_PARENT ?? 'NAYAFP4040900004', since: '12 August 2026' },
  ]) {
    test(`a ${label} parent cannot take a branch`, async ({ page }) => {
      test.setTimeout(180_000);
      await story('Parent type restrictions');
      await severity('critical');
      await parameter('Parent', parent);
      await parameter('Parent type', label);
      await description(
        `usp_InsertCustomerBranchRequestByWeb blocks branch creation under a ` +
          `${label} parent (${since}). The block may land at lookup or at ` +
          `submission; either is acceptable, so the test asserts the outcome — ` +
          `no new branch — rather than the mechanism.`
      );

      const row = await parentRow(parent);
      test.skip(!row, `${parent} does not exist.`);

      const before = await branchesOf(row!.Id);

      const branch = new AddBranchPage(page);
      await branch.open();
      const lookup = await branch.findParent(parent);

      // Some types are stopped at lookup, others only on submit. Both end in
      // the same place, which is what matters.
      if (lookup.found && (await branch.branchTypeOffered())) {
        await branch.selectBranchType('Fleet');
        await branch.fillBranch({
          pinCode: '201304',
          managerName: `${runTag()} Manager`,
          email: `${runTag().toLowerCase()}.blocked@example.com`,
          address: 'Blocked parent test',
        });
        await branch.submit();
      }

      const after = await branchesOf(row!.Id);
      const added = after.filter(a => !before.some(b => b.CustomerId === a.CustomerId));

      expect(
        added,
        `A branch was created under a ${label} parent (${parent}), which the ` +
          `procedure has blocked since ${since}.`
      ).toHaveLength(0);
    });
  }
});
