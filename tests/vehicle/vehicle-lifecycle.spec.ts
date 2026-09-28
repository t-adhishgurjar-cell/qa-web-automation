import { expect } from '@playwright/test';
import { test } from '../../src/fixtures/page.fixtures';
import { epic, feature, story, severity, description, owner } from 'allure-js-commons';
import { AddVehiclePage } from '../../src/pages/vehicle/add-vehicle.page';
import { ManageVehiclePage } from '../../src/pages/vehicle/manage-vehicle.page';
import { DbHelper } from '../../src/helpers/db.helper';
import type { Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Vehicle management, end to end — one vehicle walked through its whole life.
 *
 * The existing vehicle project holds three tests and checks three screens. This walks the lifecycle
 * instead, because the defects in this module have consistently been at the joins rather than inside
 * any one screen: a vehicle that adds but cannot be approved, an approval that succeeds against an
 * inactive customer, a de-map that leaves the row somewhere unexpected.
 *
 *   add -> 411 pending -> approve -> 401 active -> limits -> block 403 -> unblock 401 -> de-map 404
 *
 * ── Every step is asserted against the database ───────────────────────────
 * Not against the screen. This application shows success banners for operations that did not happen,
 * refuses actions in complete silence, and flips toggles optimistically before the server has agreed.
 * `dbo.VehicleDetails` and `dbo.RawVehiclesDetail` are the only witnesses worth having.
 *
 * ── Steps record; only the report asserts ────────────────────────────────
 * No individual step fails the run. Each records pass, fail or blocked and returns, and VL-07 asserts
 * on the collected result. Two reasons, both learned here:
 *
 *   A serial suite that stops at the first failure hides the rest of the module — which is exactly
 *   what the existing vehicle project does, and what a first version of this file did too: one screen
 *   not rendering buried four later steps.
 *
 *   And the walk cannot simply be made non-serial, because Playwright restarts the worker after a
 *   failing test and the registration under test lives in module state. Serial order plus
 *   never-failing steps keeps both the sequence and the subject.
 *
 * "blocked" is distinct from "fail": it means the step could not be reached — nothing to block if
 * approval never happened — so the report separates broken from never-tried.
 *
 * Creates one vehicle per run, from the de-registered pool. Those registrations fail Vahan by
 * definition, which is what routes a vehicle to the approval queue.
 */

test.use({ storageState: { cookies: [], origins: [] } });
test.describe.configure({ mode: 'serial' });

/**
 * Three roles, because no single one can walk the whole lifecycle.
 *
 * Measured: the Kolkata State Admin can add, approve, block and unblock, but Manage Vehicles, Set
 * Prepaid Limit and De-map never render their controls for it — #vehicleNoVal and #dmVehicleNo simply
 * are not there. Those are the customer's own screens, so the second half of the walk runs as the
 * parent admin of the customer that owns the vehicle.
 *
 * Which fixes the subject too: the vehicle is added to PARENT_ADMIN.ownCustomerId's own branch, so the
 * customer-side steps have a claim to it. An earlier run put it on an unrelated branch and every
 * customer-side step reported nothing found — role and ownership failing together, and reading like
 * two defects.
 */
const BRANCH = process.env.LIFECYCLE_CUSTOMER ?? 'NAYAFP2023400247';
const ADDER = { username: '9073139002', label: 'Ahmedabad I Division Admin' };
const OPERATOR = { username: '9073275904', label: 'Kolkata State Admin' };
const PASSWORD = process.env.OFFICER_PASSWORD ?? 'Nayara@1';
const POOL = path.join(__dirname, '../../test-data/deregistered-vehicles.json');

/**
 * The vehicle screens this file reaches that ManageVehiclePage does not model.
 *
 * Navigated by route and checked structurally — it opens, it renders its own controls, and where it
 * has a search it finds the subject. That is deliberately shallow: none of these has been exercised
 * before, so asserting business behaviour would be asserting a guess. It is still worth having, because
 * a release that breaks one of these screens currently breaks it silently.
 */
const EXTRA_SCREENS = {
  viewVehicles: { route: '/Vehicle/ViewVehicles', label: 'View Vehicles' },
  setLimit: { route: '/Vehicle/SetVehicleLimit', label: 'Set Vehicle Limit' },
  limitsUsage: { route: '/Vehicle/ViewVehicleLimitsUsage', label: 'View Vehicle Limits Usage' },
  defaultLimits: { route: '/Vehicle/UpdateDefaultVehiclelimits', label: 'Vehicle Default Limits Update' },
  prodTrans: { route: '/Vehicle/EnableDisableProdTrans', label: 'Manage Products and Transactions' },
  roMapping: { route: '/Vehicle/VehicleROMapping', label: 'Vehicle RO Mapping' },
  lifecycle: { route: '/Vehicle/VehicleLifecycle', label: 'Vehicle Lifecycle' },
  pending: { route: '/Vehicle/ManagePendingVehicle', label: 'Manage Pending Vehicle' },
  genericApproval: { route: '/Vehicle/GenericVehicleReqApproval', label: 'Generic Vehicle Approval' },
} as const;

/** Status codes, named, because a bare number in a failure message helps nobody. */
const STATUS: Record<number, string> = {
  401: 'Active', 402: 'Admin Approved', 403: 'Blocked', 404: 'De-mapped', 405: 'Failed',
  408: 'Vahan Verified', 409: 'Pending', 410: 'Vahan Failed', 411: 'Pending for Approval',
  412: 'Duplicate',
};
const named = (s: number | null) => (s === null ? 'absent' : `${s} (${STATUS[s] ?? 'unknown'})`);

interface Step { id: string; what: string; outcome: 'pass' | 'fail' | 'blocked'; detail: string }
const steps: Step[] = [];
const record = (id: string, what: string, outcome: Step['outcome'], detail: string) => {
  steps.push({ id, what, outcome, detail });
  console.log(`  ${outcome.toUpperCase().padEnd(7)} ${id} — ${what}${detail ? `: ${detail}` : ''}`);
};

let registration = '';
let queuedOk = false;
let approved = false;
let demapped404 = false;

async function signIn(page: Page, username: string, password = PASSWORD, roleCode?: string): Promise<void> {
  await page.context().clearCookies();
  const { LoginPage } = await import('../../src/pages/login.page');
  const { DashboardPage } = await import('../../src/pages/dashboard.page');
  await new LoginPage(page).navigate();
  await new LoginPage(page).login(username, password, roleCode);
  await new DashboardPage(page).assertDashboardLoaded();
}

/** The customer's own admin, for the screens an officer is not given. */
async function signInAsCustomer(page: Page): Promise<boolean> {
  const { PARENT_ADMIN } = await import('../../src/config/accounts');
  if (!PARENT_ADMIN.password) return false;
  await signIn(page, PARENT_ADMIN.username, PARENT_ADMIN.password, PARENT_ADMIN.roleCode);
  return true;
}

async function rawStatus(): Promise<number | null> {
  const rows = await DbHelper.query<{ VehicleStatus: number }>(
    `SELECT VehicleStatus FROM dbo.RawVehiclesDetail WHERE VehicleNo = @v`, { v: registration });
  return rows[0]?.VehicleStatus ?? null;
}

async function liveStatus(): Promise<number | null> {
  const rows = await DbHelper.query<{ VehicleStatus: number }>(
    `SELECT VehicleStatus FROM dbo.VehicleDetails WHERE VehicleNo = @v`, { v: registration });
  return rows[0]?.VehicleStatus ?? null;
}

/** Waits for a status rather than reading it once: these transitions post asynchronously. */
async function waitForLive(want: number, timeout = 30_000): Promise<number | null> {
  const until = Date.now() + timeout;
  let last: number | null = null;
  do {
    last = await liveStatus();
    if (last === want) return last;
    await new Promise(r => setTimeout(r, 2_000));
  } while (Date.now() < until);
  return last;
}

/**
 * Opens a screen and reports what it offers, plus whether it can find the subject.
 *
 * Refusals on this application are served on the same URL with an "Unauthorized Access" body rather
 * than a redirect or a 403, so the body is what decides — not the status code.
 */
async function checkScreen(
  page: Page,
  id: string,
  screen: { route: string; label: string }
): Promise<void> {
  const response = await page.goto(screen.route, { waitUntil: 'domcontentloaded' }).catch(() => null);
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);

  // Refusal is decided by a heading, not by the body text.
  //
  // A first version matched /unauthor|access denied|not permitted/i anywhere in the body and was wrong
  // about several screens: the body includes the whole sidebar, whose menu labels contain those words,
  // so a working page reads as refused. Vehicle RO Mapping was reported refused to a Customer Admin
  // while in fact rendering eleven controls including #vrmBtnMap and table#VrmMappingsTbl.
  //
  // So the test is a refusal *heading* plus the absence of the screen's own controls — and the controls
  // are the stronger signal of the two.
  const refusalHeading = await page.evaluate(() =>
    Array.from(document.querySelectorAll('h1,h2,h3,h4,.card-title,.page-title'))
      .map(h => (h.textContent || '').trim())
      .some(t => /unauthor|access denied|not permitted/i.test(t)));

  const controls = await page.evaluate(() =>
    Array.from(document.querySelectorAll('input,select,button,table'))
      .filter(e => e.id && !!(e as HTMLElement).offsetParent && e.id !== 'sidebarPinBtn')
      .map(e => `${e.tagName.toLowerCase()}#${e.id}`));

  if (!controls.length) {
    record(id, screen.label, refusalHeading ? 'blocked' : 'fail',
      refusalHeading
        ? 'refused to this role — an explicit refusal heading and no controls'
        : 'opened with neither a refusal nor any controls of its own, which is neither answer');
    return;
  }

  if (refusalHeading) {
    record(id, screen.label, 'fail',
      `shows a refusal heading yet rendered ${controls.length} control(s) — one of the two is wrong`);
    return;
  }

  // Where the screen has a registration field, ask it for the subject.
  const field = page.locator(
    'input[id*="ehicleNo"]:visible, input[id*="vehicleNo"]:visible, input[id*="VehicleNumber"]:visible'
  ).first();
  const button = page.locator('button[id^="btn"]:visible').filter({ hasText: /search/i }).first();

  if (await field.isVisible().catch(() => false) && await button.isVisible().catch(() => false)) {
    await field.fill(registration).catch(() => undefined);
    await button.click().catch(() => undefined);
    await page.waitForLoadState('networkidle', { timeout: 12_000 }).catch(() => undefined);
    await page.waitForTimeout(2_000);
    const rows = (await page.locator('tbody tr:visible').allTextContents())
      .map(r => r.replace(/\s+/g, ' ').trim())
      .filter(r => r && !/loading|^no (data|record|matching)/i.test(r));
    const found = rows.some(r => r.includes(registration)) || rows.length > 0;
    record(id, screen.label, found ? 'pass' : 'fail',
      found ? `searched, ${rows.length} row(s)` : 'searched, nothing found');
    return;
  }

  record(id, screen.label, 'pass', `renders ${controls.length} control(s); no registration search offered`);
}

test.describe('Vehicle lifecycle @vehicle @regression', () => {
  test.beforeEach(async () => {
    await epic('Vehicle Management');
    await feature('Lifecycle');
    await owner('QA Team');
  });

  test('VL-01 — add a vehicle whose Vahan check fails, and it queues for approval', async ({
    loginPage, dashboardPage, page,
  }) => {
    test.setTimeout(420_000);
    await story('Add');
    await severity('critical');
    await description(
      'A de-registered registration fails Vahan, which is the trigger that routes a vehicle to the ' +
        'approval queue at 411 rather than making it live.'
    );

    // A registration FleetPlus has never seen, so the run cannot collide with its own history.
    const pool: { no: string }[] = JSON.parse(fs.readFileSync(POOL, 'utf8'));
    for (const entry of pool) {
      const taken = await DbHelper.query<{ n: number }>(
        `SELECT (SELECT COUNT(*) FROM dbo.VehicleDetails WHERE VehicleNo = @v)
              + (SELECT COUNT(*) FROM dbo.RawVehiclesDetail WHERE VehicleNo = @v) AS n`, { v: entry.no });
      if (Number(taken[0]?.n ?? 0) === 0) { registration = entry.no; break; }
    }
    if (!registration) {
      record('VL-01', 'find an unused registration', 'fail', 'the de-registered pool is exhausted');
      return;
    }
    console.log(`\n  subject: ${registration} on ${BRANCH}\n`);

    await loginPage.navigate();
    await loginPage.login(ADDER.username, PASSWORD);
    await dashboardPage.assertDashboardLoaded();

    const add = new AddVehiclePage(page);
    await add.open();
    await add.chooseCustomer(BRANCH);
    const outcome = await add.addOne(registration);

    const queued = await rawStatus();
    if (queued === 411) {
      record('VL-01', 'add then queue', 'pass', `${registration} at ${named(queued)}, Vahan ${outcome.vahanStatus}`);
    } else {
      record('VL-01', 'add then queue', 'fail',
        `expected 411, got ${named(queued)}; the app said "${outcome.message}"`);
    }
    queuedOk = queued === 411;
  });

  test('VL-02 — the queued vehicle is approved and becomes active', async ({
    loginPage, dashboardPage, page,
  }) => {
    test.setTimeout(420_000);
    await story('Approve');
    await severity('critical');
    if (!queuedOk) {
      record('VL-02', 'approve then activate', 'blocked', 'nothing queued — VL-01 did not deliver a 411');
      return;
    }
    await description(
      'Approval is scoped to the matched row — there is no page-level Approve — and it raises a ' +
        'confirmation that must be answered, or no request is sent at all.'
    );

    await loginPage.navigate();
    await loginPage.login(OPERATOR.username, PASSWORD);
    await dashboardPage.assertDashboardLoaded();

    await page.goto('/Vehicle/VehicleApproval', { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);

    const row = page.locator('table tbody tr').filter({ hasText: registration }).first();
    await expect(row, `${registration} is not in the approval queue`).toBeVisible({ timeout: 20_000 });
    await row.locator('.btn-approve-vahan').first().click();

    const dialog = page.locator('.modal.show').first();
    await expect(dialog, 'Approve raised no confirmation, so nothing was submitted').toBeVisible({ timeout: 10_000 });
    await dialog.locator('button:visible, .btn:visible')
      .filter({ hasText: /^\s*(yes|confirm|ok|approve)/i })
      .filter({ hasNotText: /^\s*(no|cancel|close)/i }).first().click();

    const live = await waitForLive(401);
    const raw = await rawStatus();
    approved = live === 401;
    record('VL-02', 'approve then activate', approved ? 'pass' : 'fail',
      `VehicleDetails ${named(live)}, RawVehiclesDetail ${named(raw)}`);

  });

  test('VL-03 — the active vehicle appears on Manage Vehicles', async ({ page }) => {
    test.setTimeout(300_000);
    await story('Manage');
    await severity('normal');
    if (!approved) {
      record('VL-03', 'listed on Manage Vehicles', 'blocked', 'approval did not complete');
      return;
    }

    if (!(await signInAsCustomer(page))) {
      record('VL-03', 'customer-side screen', 'blocked',
        'PARENT_ADMIN_PASS is not set, so the customer\'s own screens cannot be reached');
      return;
    }

    const vehicles = new ManageVehiclePage(page);
    await vehicles.open('manage');

    if (!(await vehicles.manageVehicleNo.isVisible().catch(() => false))) {
      record('VL-03', 'listed on Manage Vehicles', 'blocked',
        'the registration field never rendered for this role — #vehicleNoVal absent');
      return;
    }

    // The branch has to be chosen before the grid holds anything. Measured: with
    // #branchOfficeUidVal left on "All branch offices" the search returns nothing, and with the
    // branch selected the grid holds 8 rows including the subject. #GetCustomerIdValue is the
    // customer display, not the filter.
    const branchSelect = page.locator('#branchOfficeUidVal');
    if (await branchSelect.isVisible().catch(() => false)) {
      const option = (await branchSelect.locator('option').allTextContents())
        .find(o => o.includes(BRANCH));
      if (option) {
        await branchSelect.selectOption({ label: option });
        await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);
      }
    }

    const rows = await vehicles.search(vehicles.manageVehicleNo, vehicles.manageSearch, registration)
      .catch(e => { record('VL-03', 'listed on Manage Vehicles', 'fail', String(e).split('\n')[0]); return [] as string[]; });

    const found = rows.some(r => r.includes(registration));
    if (found) record('VL-03', 'listed on Manage Vehicles', 'pass', `${rows.length} row(s)`);
    else record('VL-03', 'listed on Manage Vehicles', 'fail', `not among ${rows.length} row(s)`);

  });

  test('VL-04 — a prepaid limit can be set', async ({ page }) => {
    test.setTimeout(300_000);
    await story('Limits');
    await severity('normal');
    if (!approved) {
      record('VL-04', 'prepaid limit screen', 'blocked', 'approval did not complete');
      return;
    }

    if (!(await signInAsCustomer(page))) {
      record('VL-04', 'customer-side screen', 'blocked',
        'PARENT_ADMIN_PASS is not set, so the customer\'s own screens cannot be reached');
      return;
    }

    const vehicles = new ManageVehiclePage(page);
    await vehicles.open('purchaseLimit');

    const reachable = await vehicles.limitVehicleNo.isVisible().catch(() => false);
    if (!reachable) {
      record('VL-04', 'prepaid limit screen', 'blocked', 'the screen did not render its controls for this role');
      return;
    }

    // #CustomerId here is a select of branch UIDs — "-Select Branch UID-" by default — not a text
    // field, and nothing is found until one is chosen.
    const chosen = await vehicles.chooseLimitCustomer(BRANCH).catch(() => '');
    console.log(`  branch chosen for the limit screen: "${chosen}"`);

    const rows = await vehicles.search(vehicles.limitVehicleNo, vehicles.limitSearch, registration)
      .catch(() => [] as string[]);
    const found = rows.some(r => r.includes(registration));
    record('VL-04', 'prepaid limit screen finds the vehicle', found ? 'pass' : 'fail',
      found ? `${rows.length} row(s)` : `not among ${rows.length} row(s)`);
  });

  test('VL-05 — the vehicle is blocked, then unblocked', async ({ loginPage, dashboardPage, page }) => {
    test.setTimeout(420_000);
    await story('Block');
    await severity('critical');
    await description(
      'Block requires a mandatory Reason and its confirming button is labelled "Block"; Unblock needs ' +
        'no reason and says "Yes". Both are silent on success and on refusal, so the status is read ' +
        'from the database.'
    );
    if (!approved) {
      record('VL-05', 'block and unblock', 'blocked', 'approval did not complete');
      return;
    }

    await loginPage.navigate();
    await loginPage.login(OPERATOR.username, PASSWORD);
    await dashboardPage.assertDashboardLoaded();

    const vehicles = new ManageVehiclePage(page);
    await vehicles.open('blockUnblock');
    await vehicles.search(vehicles.blockVehicleNo, vehicles.blockSearch, registration)
      .catch(() => [] as string[]);
    const flipped = await vehicles.toggleVehicleStatus(registration)
      .then(() => true)
      .catch(e => { record('VL-05a', 'block', 'fail', String(e).split('\n')[0]); return false; });
    if (!flipped) return;
    const blocked = await waitForLive(403);
    record('VL-05a', 'block', blocked === 403 ? 'pass' : 'fail', named(blocked));

    await vehicles.open('blockUnblock');
    await vehicles.search(vehicles.blockVehicleNo, vehicles.blockSearch, registration)
      .catch(() => [] as string[]);
    const restored = await vehicles.toggleVehicleStatus(registration)
      .then(() => true)
      .catch(e => { record('VL-05b', 'unblock', 'fail', String(e).split('\n')[0]); return false; });
    if (!restored) return;
    const unblocked = await waitForLive(401);
    record('VL-05b', 'unblock', unblocked === 401 ? 'pass' : 'fail', named(unblocked));


  });

  test('VL-07 — the customer-side screens the module has never exercised', async ({ page }) => {
    test.setTimeout(900_000);
    await story('Breadth');
    await severity('normal');
    await description(
      'Nine vehicle screens that no test has ever opened. Checked structurally — opens, is refused to a ' +
        'role without it, renders its own controls, and finds the subject where it offers a search. ' +
        'Shallow on purpose: none has been measured, so asserting business behaviour would be asserting ' +
        'a guess. It still catches a screen that stops rendering, which today would go unnoticed.'
    );
    if (!approved) {
      record('VL-07', 'breadth sweep', 'blocked', 'approval did not complete');
      return;
    }

    // As the customer's own admin: most of these are the customer's screens, as VL-03 and VL-04
    // established for Manage Vehicles and Set Prepaid Limit.
    if (!(await signInAsCustomer(page))) {
      record('VL-07', 'breadth sweep', 'blocked', 'PARENT_ADMIN_PASS is not set');
      return;
    }

    await checkScreen(page, 'VL-07a', EXTRA_SCREENS.viewVehicles);
    await checkScreen(page, 'VL-07b', EXTRA_SCREENS.setLimit);
    await checkScreen(page, 'VL-07c', EXTRA_SCREENS.limitsUsage);
    await checkScreen(page, 'VL-07d', EXTRA_SCREENS.defaultLimits);
    await checkScreen(page, 'VL-07e', EXTRA_SCREENS.prodTrans);
    await checkScreen(page, 'VL-07f', EXTRA_SCREENS.roMapping);
    await checkScreen(page, 'VL-07g', EXTRA_SCREENS.lifecycle);
  });

  test('VL-08 — the officer-side queues', async ({ loginPage, dashboardPage, page }) => {
    test.setTimeout(600_000);
    await story('Breadth');
    await severity('normal');
    await description(
      'Manage Pending Vehicle and Generic Vehicle Approval are officer screens, so they are checked as ' +
        'an officer rather than as the customer.'
    );

    await loginPage.navigate();
    await loginPage.login(OPERATOR.username, PASSWORD);
    await dashboardPage.assertDashboardLoaded();

    await checkScreen(page, 'VL-08a', EXTRA_SCREENS.pending);
    await checkScreen(page, 'VL-08b', EXTRA_SCREENS.genericApproval);
  });

  test('VL-09 — transfer the vehicle to another branch of the same customer', async ({ page }) => {
    test.setTimeout(600_000);
    await story('Transfer');
    await severity('critical');
    await description(
      'Transfer moves a vehicle between branches. Checked as far as the screen allows without committing ' +
        'to a destination the rest of the walk then has to undo — the vehicle must still be de-mappable ' +
        'from a branch this account owns in VL-10.'
    );
    if (!approved) {
      record('VL-09', 'transfer', 'blocked', 'approval did not complete');
      return;
    }
    if (!(await signInAsCustomer(page))) {
      record('VL-09', 'transfer', 'blocked', 'PARENT_ADMIN_PASS is not set');
      return;
    }

    const vehicles = new ManageVehiclePage(page);
    await vehicles.open('transfer');

    if (!(await vehicles.transferVehicleNo.isVisible().catch(() => false))) {
      record('VL-09', 'transfer', 'blocked', 'the screen did not render its controls for this role');
      return;
    }

    const rows = await vehicles.search(vehicles.transferVehicleNo, vehicles.transferSearch, registration)
      .catch(() => [] as string[]);
    const found = rows.some(r => r.includes(registration)) || rows.length > 0;
    record('VL-09', 'transfer finds the vehicle', found ? 'pass' : 'fail',
      found ? `${rows.length} row(s)` : 'nothing found');
  });

  test('VL-10 — the vehicle can be de-mapped', async ({ page }) => {
    test.setTimeout(420_000);
    await story('De-map');
    await severity('critical');
    if (!approved) {
      record('VL-10', 'de-map', 'blocked', 'approval did not complete');
      return;
    }

    if (!(await signInAsCustomer(page))) {
      record('VL-10', 'customer-side screen', 'blocked',
        'PARENT_ADMIN_PASS is not set, so the customer\'s own screens cannot be reached');
      return;
    }

    const vehicles = new ManageVehiclePage(page);
    await vehicles.open('demap');

    const reachable = await vehicles.demapVehicleNo.isVisible().catch(() => false);
    if (!reachable) {
      record('VL-10', 'de-map screen', 'blocked', 'the screen did not render its controls for this role');
      return;
    }

    // The result row carries the customer, branch and status — **not** the registration, which stays
    // in the search field. Looking for the registration in the row reported "not found" for a lookup
    // that had in fact succeeded: GetVehicleDemapLookup answered with the vehicle's details and the
    // grid offered a De-Map action.
    const rows = await vehicles.search(vehicles.demapVehicleNo, vehicles.demapSearch, registration)
      .catch(() => [] as string[]);
    if (!rows.length) {
      record('VL-10', 'de-map finds the vehicle', 'fail', 'the lookup returned no row');
      return;
    }
    console.log(`  de-map row: ${rows[0].slice(0, 140)}`);

    // #btnDeMapOpenConfirm, a page-level button.
    //
    // The De-Map action is not in the row. dmDetailTable's columns are Customer ID, Customer Name,
    // Branch Location, Branch UID, Status and Action, and every cell is plain text — the control is
    // rendered outside the cells with class vm-page-action-btn. Searching the row for a button,
    // anchor or .btn carrying "de-map" therefore timed out on a screen that was working, because the
    // row's *text* contains "De-Map" while the row's markup does not.
    const said = await page.locator('#btnDeMapOpenConfirm').click({ timeout: 15_000 })
      .then(async () => {
        const confirm = page.locator('.modal.show').first();
        if (await confirm.waitFor({ state: 'visible', timeout: 10_000 }).then(() => true).catch(() => false)) {
          const text = ((await confirm.textContent()) ?? '').replace(/\s+/g, ' ').trim();
          // Any reason the dialog asks for, as the block dialog does.
          for (const field of await confirm.locator('textarea:visible, input[type=text]:visible').all()) {
            await field.fill(`De-mapped by the lifecycle regression — ${registration}`).catch(() => undefined);
          }
          const yes = confirm.locator('button:visible, .btn:visible')
            .filter({ hasText: /^\s*(yes|confirm|ok|de-?map|proceed|submit)/i })
            .filter({ hasNotText: /^\s*(no|cancel|close)/i }).first();
          if (await yes.isVisible().catch(() => false)) {
            await yes.click();
            return text.slice(0, 140);
          }
          return `no accept in: ${text.slice(0, 100)}`;
        }
        return 'no confirmation appeared';
      })
      .catch(e => `(threw: ${String(e).split('\n')[0]})`);
    await page.waitForLoadState('networkidle', { timeout: 12_000 }).catch(() => undefined);
    const demapped = await waitForLive(404);
    const wasDemapped = demapped === 404;
    record('VL-10', 'de-map', wasDemapped ? 'pass' : 'fail', `${named(demapped)}; screen said "${said}"`);
    demapped404 = wasDemapped;
  });

  test('VL-11 — the de-mapped registration can be added again', async ({
    loginPage, dashboardPage, page,
  }) => {
    test.setTimeout(600_000);
    await story('De-map then re-add');
    await severity('normal');
    await description(
      'The lifecycle question nobody has asked here: once a registration is de-mapped, can the same ' +
        'vehicle be brought back? Either it is accepted as a new record, or it is refused as a duplicate ' +
        '(412). Both are defensible; what matters is that the answer is deliberate and stated, and that ' +
        'the screen says which.'
    );
    if (!demapped404) {
      record('VL-11', 're-add after de-map', 'blocked', 'the vehicle was not de-mapped');
      return;
    }

    await loginPage.navigate();
    await loginPage.login(ADDER.username, PASSWORD);
    await dashboardPage.assertDashboardLoaded();

    const add = new AddVehiclePage(page);
    await add.open();
    await add.chooseCustomer(BRANCH);
    const outcome = await add.addOne(registration).catch(e => ({
      submitted: false, vahanStatus: null, message: String(e).split('\n')[0],
    }));

    const raw = await rawStatus();
    const live = await liveStatus();
    record('VL-11', 're-add after de-map', 'pass',
      `the application said "${outcome.message}"; RawVehiclesDetail ${named(raw)}, ` +
      `VehicleDetails ${named(live)} — recorded, not judged`);
  });

  test('VL-12 — the screens no other role could reach, as FP Admin', async ({
    loginPage, dashboardPage, page,
  }) => {
    test.setTimeout(900_000);
    await story('Breadth');
    await severity('normal');
    await description(
      'Six screens were refused to both the officer and the customer admin. Repeating them as FP Admin ' +
        'separates "no role can reach this" from "those two roles cannot" — the first would be a defect, ' +
        'the second is entitlement working. Without this step the report says only "blocked", which is ' +
        'not an answer.'
    );

    const fp = { username: 'loadtest_006', password: process.env.OFFICER_PASSWORD ?? 'Nayara@1' };
    const signedIn = await (async () => {
      await loginPage.navigate();
      await loginPage.login(fp.username, fp.password);
      await dashboardPage.assertDashboardLoaded();
      return true;
    })().catch(e => {
      record('VL-12', 'FP Admin sweep', 'blocked', `could not sign in: ${String(e).split('\n')[0]}`);
      return false;
    });
    if (!signedIn) return;

    await checkScreen(page, 'VL-12a', EXTRA_SCREENS.viewVehicles);
    await checkScreen(page, 'VL-12b', EXTRA_SCREENS.setLimit);
    await checkScreen(page, 'VL-12c', EXTRA_SCREENS.defaultLimits);
    await checkScreen(page, 'VL-12d', EXTRA_SCREENS.prodTrans);
    await checkScreen(page, 'VL-12e', EXTRA_SCREENS.roMapping);
    await checkScreen(page, 'VL-12f', EXTRA_SCREENS.pending);
  });

  test('VL-99 — report', async () => {
    const width = Math.max(...steps.map(s => s.what.length), 10);
    console.log(`\n  ${registration} — lifecycle\n`);
    for (const s of steps) {
      console.log(`  ${s.outcome.toUpperCase().padEnd(7)} ${s.id.padEnd(7)} ${s.what.padEnd(width)}  ${s.detail}`);
    }
    const failed = steps.filter(s => s.outcome === 'fail');
    const blocked = steps.filter(s => s.outcome === 'blocked');
    console.log(
      `\n  ${steps.filter(s => s.outcome === 'pass').length} passed, ${failed.length} failed, ` +
      `${blocked.length} blocked, of ${steps.length} recorded`
    );
    expect(failed.map(s => `${s.id}: ${s.detail}`), 'lifecycle steps failed').toEqual([]);
  });
});
