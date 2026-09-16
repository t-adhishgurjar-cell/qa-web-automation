import { expect } from '@playwright/test';
import { test } from '../../src/fixtures/session.fixtures';
import {
  description, epic, feature, owner, parameter, severity, story, tms,
} from 'allure-js-commons';
import { CustomerStatusPage } from '../../src/pages/customer-management/customer-status.page';
import { DbHelper } from '../../src/helpers/db.helper';
import { Evidence } from '../../src/helpers/evidence.helper';

/**
 * Activate / Deactivate Customer — the single-customer flow.
 *
 * 57 cases in the workbook, 28 marked Automate. This covers the ones reachable
 * with the account we hold; the rest need a Customer Admin, an unauthorised
 * user, or a bulk-upload file, and each says so rather than quietly passing.
 *
 * ── Why this screen matters beyond its own cases ──────────────────────────
 * Deactivating a customer here is what produced the EC-006 finding: usp_AddUser
 * counts status 104 as blocking, so a customer switched off on this screen holds
 * its mobile number permanently. Every deactivation is therefore a small
 * irreversible act, and these tests are written to leave the environment as they
 * found it.
 *
 * ── The button label is the status ────────────────────────────────────────
 * The single flow has no status field. The button reads "Deactivate" for an
 * active customer and "Activate" for an inactive one — what you may do, not
 * what is true. currentStatus() inverts it; the tests assert against the
 * database as well, so a change of wording cannot quietly flip a verdict.
 */

/**
 * A customer this framework created, and may safely switch off and on again.
 *
 * Chosen deliberately rather than by pattern. Three approved QA customers have
 * names beginning "auto" — AUTOBAhN TRUCKING, automobile carriers, AUTO
 * LOGISTICS INDIA — and are real records belonging to somebody else.
 * NAYAFP3013400036 is also off-limits: it is the fixture EC-008 needs to be
 * Active.
 */
const TOGGLE_CUSTOMER = process.env.MCS_TOGGLE_CUSTOMER ?? 'NAYAFP1013400034';

/** Already switched off, so the Activate path can be read without changing it. */
const INACTIVE_CUSTOMER = process.env.MCS_INACTIVE_CUSTOMER ?? 'NAYAFP2107000197';

/** No customer has this id. */
const UNKNOWN_CUSTOMER = process.env.MCS_UNKNOWN_CUSTOMER ?? 'NAYAFP0000000000';

async function statusOf(customerId: string): Promise<number | null> {
  const rows = await DbHelper.query<{ Status: number }>(
    `SELECT TOP 1 cm.Status FROM dbo.CustomerMaster cm WHERE cm.CustomerId = @customerId`,
    { customerId }
  );
  return rows[0]?.Status ?? null;
}

const STATUS_NAME: Record<number, string> = { 101: 'Active', 104: 'Inactive' };

test.describe('Customer Status — activate and deactivate @customer-management', () => {
  // Not serial. Each test opens the screen itself and shares no state, and the
  // one that changes a customer restores it before finishing. Under serial a
  // single failure — a missing validation message — stopped the deactivate and
  // reactivate test from running at all, which is the one worth protecting.
  test.describe.configure({ mode: 'default' });

  test.beforeEach(async () => {
    await epic('Customer Management');
    await feature('Activate / Deactivate Customer');
    await owner('QA Team');
  });

  // ── The screen itself ────────────────────────────────────────────────────

  test('TC_MCS_01 — the screen loads for an entitled user', async ({ page }) => {
    await tms('TC_MCS_01');
    await story('Access');
    await severity('normal');
    await description('An FP Admin can reach Activate / Deactivate Customer and the form renders.');

    const screen = new CustomerStatusPage(page);
    await screen.open();

    expect(await screen.isAccessible(), 'The screen did not render its search form.').toBe(true);
    await expect(screen.searchButton, 'TC_MCS_07 — Search button').toBeVisible();
    await expect(screen.resetButton).toBeVisible();
  });

  test('TC_MCS_09 — the bulk action defaults to Activate', async ({ page }) => {
    await tms('TC_MCS_09');
    await story('Access');
    await severity('critical');
    await description(
      'The bulk radio pair must default to Activate. A default of Deactivate ' +
        'would turn an unreviewed upload into a mass switch-off.'
    );

    const screen = new CustomerStatusPage(page);
    await screen.open();

    expect(
      await screen.selectedBulkAction(),
      'Neither bulk radio is selected, or Deactivate is the default.'
    ).toBe('Activate');
  });

  // ── Searching ────────────────────────────────────────────────────────────

  test('TC_MCS_15 / TC_MCS_23 — an active customer is offered Deactivate', async ({ page }) => {
    await tms('TC_MCS_15');
    await story('Search');
    await severity('critical');
    await parameter('Customer', TOGGLE_CUSTOMER);
    await description(
      'Searching an active customer offers Deactivate — the action available, ' +
        'which is how this screen conveys that the customer is currently Active.'
    );

    const dbStatus = await statusOf(TOGGLE_CUSTOMER);
    test.skip(dbStatus !== 101, `${TOGGLE_CUSTOMER} is not Active (status ${dbStatus}).`);

    const screen = new CustomerStatusPage(page);
    await screen.open();
    await screen.search(TOGGLE_CUSTOMER);

    expect(await screen.availableAction(), 'Expected Deactivate for an active customer.')
      .toBe('Deactivate');
    expect(await screen.currentStatus()).toBe('Active');
  });

  test('TC_MCS_16 / TC_MCS_24 — an inactive customer is offered Activate', async ({ page }) => {
    await tms('TC_MCS_16');
    await story('Search');
    await severity('critical');
    await parameter('Customer', INACTIVE_CUSTOMER);
    await description('Searching an inactive customer offers Activate.');

    const dbStatus = await statusOf(INACTIVE_CUSTOMER);
    test.skip(dbStatus !== 104, `${INACTIVE_CUSTOMER} is not Inactive (status ${dbStatus}).`);

    const screen = new CustomerStatusPage(page);
    await screen.open();
    await screen.search(INACTIVE_CUSTOMER);

    expect(await screen.availableAction(), 'Expected Activate for an inactive customer.')
      .toBe('Activate');
    expect(await screen.currentStatus()).toBe('Inactive');
  });

  test('TC_MCS_17 — an unknown customer id is refused', async ({ page }) => {
    await tms('TC_MCS_17');
    await story('Search');
    await severity('normal');
    await description('An id belonging to no customer must say so rather than offer an action.');

    const screen = new CustomerStatusPage(page);
    await screen.open();
    await screen.search(UNKNOWN_CUSTOMER);

    const action = await screen.availableAction();
    const messages = await screen.messages();

    expect(
      action,
      `The screen offered "${action}" for ${UNKNOWN_CUSTOMER}, which does not exist.`
    ).toBeNull();
    expect(
      messages.join(' | '),
      'Nothing was displayed for an unknown customer id. A silent empty result ' +
        'is indistinguishable from a search that never ran.'
    ).not.toBe('');
  });

  test('TC_MCS_18 — searching with no customer id is refused', async ({ page }) => {
    await tms('TC_MCS_18');
    await story('Search');
    await severity('normal');
    await description(
      'The workbook expects validation when Search is clicked with an empty ' +
        'box. Nothing is displayed: no modal, no inline error, and no browser ' +
        'constraint message either — that last one was checked explicitly, ' +
        'because a native bubble is invisible to any DOM query and would have ' +
        'made this look like a defect when it was not.\n\n' +
        'It is the same silent no-op this application performs on the Approve ' +
        'button and the wizard\u2019s Next: the click is simply discarded. The ' +
        'user is left unable to tell a rejected search from a broken button.'
    );

    // Known defect: the screen discards the click without a word.
    test.fail(
      true,
      'Known defect: a blank search produces no message on any surface — modal, ' +
        'inline or native.'
    );

    const screen = new CustomerStatusPage(page);
    await screen.open();
    await screen.search('');

    expect(await screen.availableAction(), 'An action was offered for a blank search.').toBeNull();
    expect(
      (await screen.messages()).join(' | '),
      'A blank search produced no validation message.'
    ).not.toBe('');
  });

  // ── Changing status ──────────────────────────────────────────────────────

  test('TC_MCS_21 — cancelling leaves the customer untouched', async ({ page }) => {
    await tms('TC_MCS_21');
    await story('Change status');
    await severity('critical');
    await parameter('Customer', TOGGLE_CUSTOMER);
    await description(
      'Opening the confirmation and cancelling must not change anything. ' +
        'Verified against the database, not against the dialog.'
    );

    const before = await statusOf(TOGGLE_CUSTOMER);
    test.skip(before === null, `${TOGGLE_CUSTOMER} does not exist.`);

    const screen = new CustomerStatusPage(page);
    await screen.open();
    await screen.search(TOGGLE_CUSTOMER);
    const outcome = await screen.act('cancel');

    const after = await statusOf(TOGGLE_CUSTOMER);
    expect(
      after,
      `Cancelling ${outcome.action} changed the status from ${before} to ${after}.`
    ).toBe(before);
  });

  /**
   * TC_MCS_20 and TC_MCS_19 in one test, deliberately.
   *
   * Deactivating is not reversible in its side effects — EC-006 showed the
   * mobile stays held — so the environment must be put back before the test
   * ends. Splitting them across two tests would leave the customer switched off
   * if the first failed, and would make each depend on the other's ordering.
   */
  test('TC_MCS_20 / TC_MCS_19 — deactivate, then activate again', async ({ page }) => {
    test.setTimeout(180_000);
    await tms('TC_MCS_20');
    await story('Change status');
    await severity('critical');
    await parameter('Customer', TOGGLE_CUSTOMER);
    await description(
      'Switches a customer off and back on, checking the database after each ' +
        'step. Run as one test so the customer is never left deactivated — a ' +
        'deactivated customer holds its mobile number permanently.'
    );

    const ev = new Evidence('TC_MCS_20 / TC_MCS_19 — deactivate then activate', 'tc-mcs-20-19');
    ev.fact('Customer', TOGGLE_CUSTOMER);
    let status: 'passed' | 'failed' | 'skipped' = 'passed';

    try {
      const before = await statusOf(TOGGLE_CUSTOMER);
      if (before !== 101) {
        status = 'skipped';
        const reason = `${TOGGLE_CUSTOMER} is ${STATUS_NAME[before ?? 0] ?? before}, not Active.`;
        await ev.note('Precondition unavailable', reason, reason);
        ev.finish(status);
        test.skip(true, reason);
        return;
      }
      ev.fact('Status before', `${before} (${STATUS_NAME[before]})`);

      const screen = new CustomerStatusPage(page);
      await screen.open();
      await screen.search(TOGGLE_CUSTOMER);

      // ── Deactivate ────────────────────────────────────────────────────
      const off = await screen.act('confirm');
      await ev.ui(page, 'After deactivating', `The screen said: “${off.message || 'nothing'}”.`);
      const afterOff = await statusOf(TOGGLE_CUSTOMER);
      ev.fact('Status after deactivate', `${afterOff} (${STATUS_NAME[afterOff ?? 0] ?? '?'})`);

      expect(
        afterOff,
        `Deactivate reported “${off.message}” but the database still reads ` +
          `${afterOff}. The screen and the record disagree.`
      ).toBe(104);

      // ── Activate again, restoring the environment ─────────────────────
      await screen.open();
      await screen.search(TOGGLE_CUSTOMER);
      expect(
        await screen.availableAction(),
        'After deactivating, the screen should offer Activate.'
      ).toBe('Activate');

      const on = await screen.act('confirm');
      await ev.ui(page, 'After activating again', `The screen said: “${on.message || 'nothing'}”.`);
      const afterOn = await statusOf(TOGGLE_CUSTOMER);
      ev.fact('Status after activate', `${afterOn} (${STATUS_NAME[afterOn ?? 0] ?? '?'})`);

      expect(
        afterOn,
        `Activate reported “${on.message}” but the database reads ${afterOn}. ` +
          `${TOGGLE_CUSTOMER} has been left switched off.`
      ).toBe(101);
    } catch (error) {
      if (status !== 'skipped') status = 'failed';
      throw error;
    } finally {
      if (status !== 'skipped') ev.finish(status);
    }
  });

  // ── Cases that need something we do not have ─────────────────────────────

  test('TC_MCS_02 — a Customer Admin can reach the screen', async () => {
    await tms('TC_MCS_02');
    await story('Access');
    await severity('normal');
    await description('Needs a Customer Admin account; only an FP Admin is configured.');
    test.skip(
      true,
      'No Customer Admin credentials are configured. Set CUSTOMER_ADMIN_USER and ' +
        'CUSTOMER_ADMIN_PASS to an account of that type and remove this skip.'
    );
  });

  test('TC_MCS_03 — an unentitled user is refused the screen', async () => {
    await tms('TC_MCS_03');
    await story('Access');
    await severity('critical');
    await description('Needs an account without the entitlement; none is configured.');
    // Now covered, in role-scope.spec.ts — "a Customer Admin is refused Manage
    // Customer Status". It lives there because it needs its own login as
    // 9200000000, and this spec runs on the worker-scoped FP Admin session.
    test.skip(
      true,
      'Covered by role-scope.spec.ts as "a Customer Admin is refused Manage ' +
        'Customer Status", which logs in as 9200000000 — a role that has this ' +
        'screen in none of its 39 modules. Kept here as a pointer so the ' +
        'workbook id still resolves.'
    );
  });
});
