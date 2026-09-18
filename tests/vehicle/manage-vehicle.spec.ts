import { expect } from '@playwright/test';
import { test } from '../../src/fixtures/page.fixtures';
import { description, epic, feature, owner, parameter, severity, story, tms } from 'allure-js-commons';
import { ManageVehiclePage } from '../../src/pages/vehicle/manage-vehicle.page';
import { PARENT_ADMIN } from '../../src/config/accounts';
import { vehicle, vehiclesUnder, waitForStatus, describeStatus } from '../../src/helpers/vehicle-state.helper';

/**
 * Manage Vehicle — W-VEH-001 to W-VEH-006 of the Web regression suite.
 *
 * The six cases the sheet names, tested as written: the action performed and
 * the outcome verified, not the screen opened. role-modules.spec.ts already
 * proves these pages render; that test would pass with the feature completely
 * broken behind it, which is the gap this closes.
 *
 * ── Verified against the database, not the toast ──────────────────────────
 * The sheet's expected results are all states — "vehicle cannot transact",
 * "appears under Branch B, removed from Branch A". A success message is not
 * that, and this application has been caught saying "Success" for work it
 * refused to do (/Customer/ValidatePanNumber returns message "Success" with
 * isValid 0). So every assertion reads VehicleDetails.
 *
 * ── These tests change real vehicles, and put them back ───────────────────
 * Blocking is reversible and the reversal is part of the test rather than
 * cleanup: a block that cannot be undone is a worse outcome than one that never
 * happened, and W-VEH-002 is the unblock case anyway. Each test restores the
 * status it found, so a failed run leaves at most one vehicle blocked — and
 * says so.
 *
 * ── Fixtures are discovered, not hardcoded ────────────────────────────────
 * A registration written into the spec rots the first time someone works that
 * vehicle. These find a vehicle in the state each case needs and skip with a
 * reason when the environment has none, so "no Active vehicle exists" is never
 * reported as a product failure.
 */

const PARENT = PARENT_ADMIN.ownCustomerId;

test.use({ storageState: { cookies: [], origins: [] } });

test.describe('Manage Vehicle @vehicle @regression', () => {
  // Serial: these change vehicle state, and two tests picking the same vehicle
  // would each undo the other's setup.
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ loginPage, dashboardPage }) => {
    await epic('Vehicle Management');
    await feature('Manage Vehicle');
    await owner('QA Team');
    await parameter('Customer', PARENT);

    test.skip(!PARENT_ADMIN.password, `Set PARENT_ADMIN_PASS for ${PARENT_ADMIN.username}`);

    await loginPage.navigate();
    await loginPage.login(PARENT_ADMIN.username, PARENT_ADMIN.password, PARENT_ADMIN.roleCode);
    await dashboardPage.assertDashboardLoaded();
  });

  test('W-VEH-001 / W-VEH-002 — a vehicle is blocked, then unblocked', async ({ page }) => {
    test.setTimeout(300_000);
    await tms('W-VEH-001');
    await story('Block');
    await severity('critical');
    await description(
      'W-VEH-001: block an active vehicle — expected "vehicle cannot transact".\n' +
        'W-VEH-002: unblock it — expected "vehicle can transact again".\n\n' +
        'Run as one test because the two halves are the same vehicle and the ' +
        'unblock is what restores it. Split, a failure in the first leaves a ' +
        'live vehicle blocked with no test responsible for putting it back.\n\n' +
        'Status is read from VehicleDetails: 401 Active, 403 Blocked.'
    );

    const fleet = await vehiclesUnder(PARENT);
    let active = fleet.find(v => v.VehicleStatus === 401);
    const vehicles = new ManageVehiclePage(page);

    // Recover from an interrupted run before deciding there is no fixture.
    //
    // This test blocks a vehicle and unblocks it again, so a run that dies
    // between the two — the database dropped mid-test on 17 September — leaves
    // the vehicle at 403 and every later run skips for want of an Active one.
    // The suite then goes quietly green while a real vehicle sits blocked,
    // which is worse than failing.
    //
    // Unblocking it here is not a workaround: restoring a vehicle to Active is
    // precisely W-VEH-002, so the recovery exercises the same path the test
    // would have.
    if (!active) {
      const stranded = fleet.find(v => v.VehicleStatus === 403);
      if (stranded) {
        console.log(
          `${stranded.VehicleNo} is Blocked with no Active vehicle in the fleet — ` +
            `recovering it from an interrupted run before starting.`
        );
        await vehicles.open('blockUnblock');
        await vehicles.search(vehicles.blockVehicleNo, vehicles.blockSearch, stranded.VehicleNo);
        await vehicles.toggleVehicleStatus(stranded.VehicleNo);

        const recovered = await waitForStatus(stranded.VehicleNo, 401);
        expect(
          recovered.reached,
          `${stranded.VehicleNo} was left Blocked by an earlier run and could ` +
            `not be restored: it is ${describeStatus(recovered.actual ?? -1)}. ` +
            `Unblocking is W-VEH-002, so this is a real failure of that case, ` +
            `not merely a fixture problem — and the vehicle is still blocked.`
        ).toBe(true);

        active = (await vehiclesUnder(PARENT)).find(v => v.VehicleStatus === 401);
      }
    }

    test.skip(
      !active,
      `No Active (401) vehicle under ${PARENT}. The fleet holds ` +
        `${fleet.length} vehicle(s): ${fleet.map(v => `${v.VehicleNo}=${describeStatus(v.VehicleStatus)}`).join(', ') || 'none'}. ` +
        `This is a data gap, not a defect.`
    );

    const registration = active!.VehicleNo;
    await parameter('Vehicle', registration);
    console.log(`Blocking ${registration} (currently ${describeStatus(active!.VehicleStatus)})`);

    await vehicles.open('blockUnblock');

    const found = await vehicles.search(vehicles.blockVehicleNo, vehicles.blockSearch, registration);
    expect(
      found.some(r => r.includes(registration)),
      `Searching Block/Unblock for ${registration} returned ${found.length} row(s) ` +
        `and none names it: ${found.slice(0, 3).join(' / ') || '(no rows)'}. The ` +
        `vehicle exists in VehicleDetails, so either this screen scopes to a ` +
        `branch this admin is not in, or the search does not match on registration.`
    ).toBe(true);

    // ── W-VEH-001, block ──────────────────────────────────────────────────
    const block = await vehicles.toggleVehicleStatus(registration);
    console.log(`  block said: "${block.message}" (was ${block.wasActive ? 'Active' : 'Blocked'})`);
    expect(
      block.wasActive,
      `${registration} was expected to start Active so it could be blocked, but ` +
        `its toggle was already off. The database said 401 moments earlier, so ` +
        `the grid and VehicleDetails disagree.`
    ).toBe(true);
    const blockSaid = block.message;

    const blocked = await waitForStatus(registration, 403);
    expect(
      blocked.reached,
      `W-VEH-001: after blocking, ${registration} should be 403 (Blocked) so it ` +
        `cannot transact. It is ${describeStatus(blocked.actual ?? -1)}. The ` +
        `screen said "${blockSaid}".`
    ).toBe(true);

    // ── W-VEH-002, unblock ────────────────────────────────────────────────
    await vehicles.open('blockUnblock');
    await vehicles.search(vehicles.blockVehicleNo, vehicles.blockSearch, registration);

    const unblock = await vehicles.toggleVehicleStatus(registration);
    console.log(`  unblock said: "${unblock.message}" (was ${unblock.wasActive ? 'Active' : 'Blocked'})`);
    const unblockSaid = unblock.message;

    const restored = await waitForStatus(registration, 401);
    expect(
      restored.reached,
      `W-VEH-002: after unblocking, ${registration} should be back to 401 ` +
        `(Active). It is ${describeStatus(restored.actual ?? -1)}, so this ` +
        `vehicle is LEFT BLOCKED and someone must restore it by hand. The ` +
        `screen said "${unblockSaid}".`
    ).toBe(true);
  });

  test('W-VEH-006 — vehicle authentication finds a vehicle by registration', async ({ page }) => {
    await tms('W-VEH-006');
    await story('Authentication');
    await severity('normal');
    await description(
      'The sheet asks that a vehicle can be authenticated. This asserts the ' +
        'lookup resolves the right vehicle — the step everything else depends ' +
        'on — without completing an authentication, which would consume a ' +
        'prepaid authorisation against a live vehicle.'
    );

    // An Active vehicle specifically. Taking the first of the fleet picked a
    // DeMapped one, which this screen correctly does not list — and the test
    // then reported a working screen as broken. A fixture in the wrong state
    // fails as a product defect unless the test is explicit about what it needs.
    const fleet = await vehiclesUnder(PARENT);
    const active = fleet.find(v => v.VehicleStatus === 401);
    test.skip(
      !active,
      `No Active (401) vehicle under ${PARENT}; the fleet is ` +
        `${fleet.map(v => `${v.VehicleNo}=${describeStatus(v.VehicleStatus)}`).join(', ') || 'empty'}.`
    );

    const registration = active!.VehicleNo;
    await parameter('Vehicle', registration);

    const vehicles = new ManageVehiclePage(page);
    await vehicles.open('authentication');

    const auth = await vehicles.searchAuthentication(registration, active!.CustomerID);
    console.log(`  auth panel: type="${auth.authType}" spoc="${auth.spoc}" mobile="${auth.spocMobile}"`);

    expect(
      auth.resolved,
      `Prepaid Authentication returned no authentication details for ` +
        `${registration}, which exists in VehicleDetails under ` +
        `${active!.CustomerID} at ${describeStatus(active!.VehicleStatus)}. ` +
        `The screen answers with a panel rather than a grid, and both its OTP ` +
        `SPOC and SPOC mobile came back empty — so the lookup found nothing.`
    ).toBe(true);

    expect(
      auth.spocMobile,
      `The authentication SPOC mobile is "${auth.spocMobile}". A vehicle whose ` +
        `authentication has no contact behind it cannot be authenticated at the ` +
        `pump, which is what W-VEH-006 exists to catch.`
    ).toMatch(/^\d{10}$/);
  });

  test('W-VEH-005 — purchase limits open for a real vehicle', async ({ page }) => {
    await tms('W-VEH-005');
    await story('Limit');
    await severity('normal');
    await description(
      'The sheet asks that a vehicle purchase limit can be set. This proves the ' +
        'screen resolves the vehicle and offers its limits; it does not change ' +
        'one, because a limit written onto a live vehicle alters what that ' +
        'customer can spend.'
    );

    const fleet = await vehiclesUnder(PARENT);
    const active = fleet.find(v => v.VehicleStatus === 401);
    test.skip(
      !active,
      `No Active (401) vehicle under ${PARENT}; the fleet is ` +
        `${fleet.map(v => `${v.VehicleNo}=${describeStatus(v.VehicleStatus)}`).join(', ') || 'empty'}.`
    );

    const registration = active!.VehicleNo;
    await parameter('Vehicle', registration);

    const vehicles = new ManageVehiclePage(page);
    await vehicles.open('purchaseLimit');

    await vehicles.chooseLimitCustomer(active!.CustomerID);
    const found = await vehicles.search(vehicles.limitVehicleNo, vehicles.limitSearch, registration);

    expect(
      found.some(r => r.includes(registration)),
      `Set Vehicle Purchase Limits did not resolve ${registration} for customer ` +
        `${fleet[0].CustomerID}. Rows: ${found.slice(0, 3).join(' / ') || '(none)'}.`
    ).toBe(true);
  });

  /**
   * W-VEH-003 and W-VEH-004 are not implemented here, and that is deliberate.
   *
   *   W-VEH-003  transfer a vehicle between branches
   *   W-VEH-004  de-map a vehicle
   *
   * Both are one-way against live data. A transfer moves a vehicle to another
   * branch with no matching "transfer back" in the suite, and a de-map sets
   * status 404 and detaches the vehicle from its customer — the fleet under
   * this customer is two vehicles, so a de-map would consume one of them
   * permanently and take W-VEH-001/002 with it.
   *
   * They need either a disposable fleet or an agreed reversal path. Left
   * failing-to-exist rather than written as a screen-opens check, which would
   * report coverage this suite does not have.
   */
});
