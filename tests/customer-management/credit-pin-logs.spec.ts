import { expect } from '@playwright/test';
import { test } from '../../src/fixtures/session.fixtures';
import {
  description, epic, feature, owner, parameter, severity, story, tms,
} from 'allure-js-commons';
import { CreditPinLogsPage } from '../../src/pages/customer-management/credit-pin-logs.page';
import { BRANCH_ADMIN, PARENT_ADMIN } from '../../src/config/accounts';

/**
 * Credit PIN Logs — `/Customer/CreditPinChangeLog`.
 *
 * Workbook sheet `Credit PIN Logs`, 28 cases, every one marked Automate and
 * none marked Manual — the only sheet in the workbook of which that is true.
 *
 * ── Nothing here writes ───────────────────────────────────────────────────
 * The screen is an audit list. These tests search, filter and read; they create
 * no records and change no PIN. That is deliberate for the first pass: the
 * sibling screen, Customer Credit PIN Validity, can change a live branch's PIN
 * expiry, and that deserves its own decision rather than arriving as a side
 * effect of covering the family.
 *
 * ── Accounts ──────────────────────────────────────────────────────────────
 * The workbook writes these cases for 9988776656 (Customer Admin), 9123456789
 * (Branch Admin) and 9654735736 (Admin). We hold none of those. The first two
 * roles are covered by the two cards on 9200000000, which were measured working
 * on this screen. The third is an all-customers view we cannot reach, so CPL-004
 * is not automated here.
 *
 * Signing in as one card ends the other's session, so the two roles are two
 * describes rather than interleaved tests: one login each, in file order.
 *
 * They take `sessionFor` rather than `test.use({ sessionAccount })` because a
 * worker option cannot be set per describe — Playwright refuses it, since a
 * worker option decides which worker a test runs in. `sessionFor` is the
 * per-account form of the same reuse, and it closes the session it holds for a
 * mobile before signing that mobile in under the other role, which is required
 * here: both cards are 9200000000.
 */

const CUSTOMER_ADMIN_CASES = 'Credit PIN Logs — Customer Admin @customer-management @regression';
const BRANCH_ADMIN_CASES = 'Credit PIN Logs — Branch Admin @customer-management @regression';

/** A mobile that is syntactically fine but belongs to nobody, for the empty-result cases. */
const UNUSED_MOBILE = process.env.CPL_UNUSED_MOBILE ?? '9000000001';

/** Far enough ahead that no PIN change can have been logged yet. */
function futureRange(): { from: string; to: string } {
  const start = new Date();
  start.setFullYear(start.getFullYear() + 1);
  const end = new Date(start);
  end.setMonth(end.getMonth() + 1);
  return { from: iso(start), to: iso(end) };
}

/** The `yyyy-mm-dd` an <input type="date"> expects, in local time. */
function iso(date: Date): string {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

test.describe(CUSTOMER_ADMIN_CASES, () => {
  test.describe.configure({ mode: 'serial' });

  let logs: CreditPinLogsPage;

  test.beforeEach(async ({ sessionFor }) => {
    await epic('Customer Management');
    await feature('Credit PIN Logs');
    await owner('QA Team');
    await parameter('Customer Admin', PARENT_ADMIN.username);

    test.skip(
      !PARENT_ADMIN.password,
      'No Parent Admin password is configured. Set PARENT_ADMIN_PASS (or ' +
        'TEST_PASSWORD) to the password for ' + PARENT_ADMIN.username + '.'
    );

    logs = new CreditPinLogsPage(await sessionFor(PARENT_ADMIN));
    await logs.navigate();
  });

  test('CPL-001 the screen loads with its filters and grid', async () => {
    await tms('CPL-001', 'Credit PIN Logs');
    await story('Page load');
    await severity('critical');
    await description(
      'Asserts the title is not "Unauthorized Access" as well as the controls. ' +
        'This application refuses an unentitled role with HTTP 200 and that ' +
        'page, so a status-code check passes on a refusal.'
    );

    await logs.assertLoaded();
    await logs.assertColumns();

    await expect(logs.customerId).toBeVisible();
    await expect(logs.branchSelect).toBeVisible();
    await expect(logs.mobileNumber).toBeVisible();
    await expect(logs.fromDate).toBeVisible();
    await expect(logs.toDate).toBeVisible();
    await expect(logs.searchButton).toBeVisible();
    await expect(logs.resetButton).toBeVisible();
  });

  test('CPL-003 the customer is taken from the session and cannot be changed', async () => {
    await tms('CPL-003', 'Credit PIN Logs');
    await story('Scope');
    await severity('critical');
    await description(
      'The Customer ID is prefilled from the session and not editable, which is ' +
        'what stops one customer administrator asking for another customer’s PIN ' +
        'history. The isolation is structural rather than a check.'
    );

    await expect(logs.customerId).toHaveValue(PARENT_ADMIN.ownCustomerId);
    await expect(logs.customerId).not.toBeEditable();
    await expect(logs.customerIdHidden).toHaveValue(PARENT_ADMIN.ownCustomerId);
  });

  test('CPL-031 the branch dropdown offers this customer’s branches', async () => {
    await tms('CPL-031', 'Credit PIN Logs');
    await story('Filters');
    await severity('normal');
    await description('Every branch the customer owns is selectable, alongside an "All branches" entry.');

    await expect(logs.branchSelect).toBeVisible();
    const branches = await logs.branchOptions();
    expect(branches.length, 'the branch dropdown offered nothing to choose').toBeGreaterThan(0);
  });

  test('CPL-005 and CPL-011 an unfiltered search lists this customer’s PIN changes', async () => {
    await tms('CPL-005', 'Credit PIN Logs');
    await story('Search');
    await severity('critical');
    await description(
      'Searching with no filter returns the customer’s log. Every row is checked ' +
        'to carry this customer as its parent — the column assertion of CPL-011 ' +
        'and the isolation of CPL-020 are the same fact read two ways.'
    );

    await logs.search();
    const rows = await logs.readRows();
    expect(rows.length, 'the log was empty for a customer with branches').toBeGreaterThan(0);

    for (const row of rows) {
      expect(row['Parent UID'], `row escaped the customer: ${JSON.stringify(row)}`)
        .toBe(PARENT_ADMIN.ownCustomerId);
      expect(row['Branch Customer ID']).toMatch(/^NAYAFP\d+$/);
      expect(row['PIN Changed On'], 'PIN Changed On is not a date')
        .toMatch(/^\d{2}-\d{2}-\d{4} \d{2}:\d{2}:\d{2}$/);
    }
  });

  test('CPL-006 filtering by branch narrows the log to that branch', async () => {
    await tms('CPL-006', 'Credit PIN Logs');
    await story('Filters');
    await severity('normal');

    await logs.search();
    const before = await logs.readRows();
    const branch = before.find(row => row['Branch Location'])?.['Branch Location'];
    test.skip(!branch, 'No row carries a branch location to filter by.');

    await logs.filterByBranch(branch as string);
    const after = await logs.readRows();
    expect(after.length, 'filtering by a branch that has rows returned none').toBeGreaterThan(0);
    for (const row of after) {
      expect(row['Branch Location']).toBe(branch);
    }
  });

  test('CPL-007 filtering by manager mobile narrows the log to that manager', async () => {
    await tms('CPL-007', 'Credit PIN Logs');
    await story('Filters');
    await severity('normal');

    await logs.search();
    const mobile = (await logs.readRows()).find(row => row['Manager Mobile'])?.['Manager Mobile'];
    test.skip(!mobile, 'No row carries a manager mobile to filter by.');

    await logs.filterByMobile(mobile as string);
    const after = await logs.readRows();
    expect(after.length).toBeGreaterThan(0);
    for (const row of after) {
      expect(row['Manager Mobile']).toBe(mobile);
    }
  });

  test('CPL-013 a future date range returns nothing', async () => {
    await tms('CPL-013', 'Credit PIN Logs');
    await story('Filters');
    await severity('normal');
    await description('A range a year out cannot contain a PIN change that has already happened.');

    const { from, to } = futureRange();
    await logs.filterByDateRange(from, to);

    expect(await logs.readRows(), `rows came back for ${from} to ${to}`).toEqual([]);
  });

  test('CPL-010 reset clears the filters and restores the full log', async () => {
    await tms('CPL-010', 'Credit PIN Logs');
    await story('Filters');
    await severity('normal');

    await logs.search();
    const all = await logs.readRows();

    await logs.filterByMobile(UNUSED_MOBILE);
    expect(await logs.readRows(), 'an unused mobile matched something').toEqual([]);

    await logs.reset();
    await expect(logs.mobileNumber).toHaveValue('');
    await expect(logs.fromDate).toHaveValue('');
    await expect(logs.toDate).toHaveValue('');
    expect((await logs.readRows()).length).toBe(all.length);
  });
});

test.describe(BRANCH_ADMIN_CASES, () => {
  test.describe.configure({ mode: 'serial' });

  let logs: CreditPinLogsPage;

  test.beforeEach(async ({ sessionFor }) => {
    await epic('Customer Management');
    await feature('Credit PIN Logs');
    await owner('QA Team');
    await parameter('Branch Admin', BRANCH_ADMIN.username);

    test.skip(
      !BRANCH_ADMIN.password,
      'No Branch Admin password is configured. Set BRANCH_ADMIN_PASS (or ' +
        'TEST_PASSWORD) to the password for ' + BRANCH_ADMIN.username + '.'
    );

    logs = new CreditPinLogsPage(await sessionFor(BRANCH_ADMIN));
    await logs.navigate();
  });

  test('CPL-002 a branch admin can open the screen', async () => {
    await tms('CPL-002', 'Credit PIN Logs');
    await story('Page load');
    await severity('critical');

    await logs.assertLoaded();
    await logs.assertColumns();
  });

  test('CPL-002 the branch is fixed, not chosen', async () => {
    await tms('CPL-002', 'Credit PIN Logs');
    await story('Scope');
    await severity('critical');
    await description(
      'A Customer Admin picks a branch from #cplBranchLocationSelect; a Branch ' +
        'Admin is given #cplBranchLocationReadonly holding its own. The dropdown ' +
        'is still in the DOM for this role — empty and hidden — so this asserts ' +
        'visibility. toBeAttached() would pass on a control the role cannot use.'
    );

    await expect(logs.branchReadonly).toBeVisible();
    await expect(logs.branchReadonly).not.toBeEditable();
    await expect(logs.branchSelect).toBeHidden();
  });

  test('CPL-020 a branch admin sees only its own branch’s PIN history', async () => {
    await tms('CPL-020', 'Credit PIN Logs');
    await story('Scope');
    await severity('critical');
    await description(
      'The isolation that matters on this screen: a branch administrator must not ' +
        'read another branch’s PIN changes, including its siblings under the same ' +
        'parent customer.'
    );

    await logs.search();
    const rows = await logs.readRows();
    expect(rows.length, 'the branch admin’s own log was empty').toBeGreaterThan(0);

    const own = await logs.customerId.inputValue();
    for (const row of rows) {
      expect(row['Branch Customer ID'], `row belongs to another branch: ${JSON.stringify(row)}`)
        .toBe(own);
    }
  });
});
