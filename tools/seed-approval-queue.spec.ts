import { test, expect } from '@playwright/test';
import { LoginPage } from '../src/pages/login.page';
import { DashboardPage } from '../src/pages/dashboard.page';
import { AddVehiclePage } from '../src/pages/vehicle/add-vehicle.page';
import { DbHelper } from '../src/helpers/db.helper';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Puts fresh vehicles into the approval queue, to be spent on edge cases.
 *
 * Registrations come from the de-registered list in test-data: they fail Vahan
 * by definition, which is the trigger that routes a vehicle to the queue. A
 * number already known to FleetPlus is skipped, so re-running this tops the
 * queue up rather than colliding.
 *
 * Seeded across two customers in DIFFERENT divisions and added by roles from a
 * THIRD, so every later scenario has a cross-geography case available without
 * having to arrange one.
 *
 *   TOOLS=true ENV=qa npx playwright test --project=tools --grep "seed approval queue"
 *
 * THIS CREATES REAL VEHICLES.
 */

const PASSWORD = process.env.OFFICER_PASSWORD ?? 'Nayara@1';
const POOL = path.join(__dirname, '../test-data/deregistered-vehicles.json');

const SEEDS = [
  { adder: { label: 'Ahmedabad Division Admin (GJ_I/West)', mobile: '9073139002' }, uid: 'NAYAFP2023400247', owner: 'Noida / UP_UK / North' },
  { adder: { label: 'Kolkata State Admin (WB_NE/East)', mobile: '9073275904' }, uid: 'NAYAFP2023400247', owner: 'Noida / UP_UK / North' },
  { adder: { label: 'Ahmedabad State Admin (GJ_I/West)', mobile: '9073068501' }, uid: 'NAYAFP2023400255', owner: 'Gurgaon / HR_HP_PB / North' },
  { adder: { label: 'Kolkata Division Admin (WB_NE/East)', mobile: '9073340105' }, uid: 'NAYAFP2023400255', owner: 'Gurgaon / HR_HP_PB / North' },
];

async function nextFreeRegistration(used: Set<string>): Promise<string> {
  const pool: { no: string }[] = JSON.parse(fs.readFileSync(POOL, 'utf8'));
  for (const entry of pool) {
    if (used.has(entry.no)) continue;
    const taken = await DbHelper.query<{ n: number }>(
      `SELECT (SELECT COUNT(*) FROM dbo.VehicleDetails WHERE VehicleNo = @v)
            + (SELECT COUNT(*) FROM dbo.RawVehiclesDetail WHERE VehicleNo = @v) AS n`,
      { v: entry.no }
    );
    if (Number(taken[0]?.n ?? 0) === 0) {
      used.add(entry.no);
      return entry.no;
    }
    used.add(entry.no);
  }
  throw new Error('The de-registered pool is exhausted.');
}

test.use({ storageState: { cookies: [], origins: [] } });

test.describe('Tools — data building @tools', () => {
  for (const [i, seed] of SEEDS.entries()) {
    test(`seed approval queue ${i + 1} — ${seed.adder.label} -> ${seed.owner}`, async ({ page }) => {
      test.setTimeout(6 * 60_000);

      const used = new Set<string>();
      const registration = await nextFreeRegistration(used);

      const loginPage = new LoginPage(page);
      const dashboardPage = new DashboardPage(page);
      const addPage = new AddVehiclePage(page);

      await loginPage.navigate();
      await loginPage.login(seed.adder.mobile, PASSWORD);
      await dashboardPage.assertDashboardLoaded();
      await addPage.open();

      const customer = await addPage.chooseCustomer(seed.uid);
      expect(customer, `${seed.adder.label} could not resolve customer ${seed.uid}`).not.toBe('');

      const result = await addPage.addOne(registration);
      console.log(
        `${registration}  added by ${seed.adder.label}  for ${seed.uid} (${seed.owner})  ` +
          `vahan=${result.vahanStatus}  submitted=${result.submitted}  "${result.message}"`
      );

      // A vehicle that verified successfully never reaches the queue, so the
      // seed would silently produce nothing to test with.
      expect(
        result.vahanStatus,
        `${registration} was expected to FAIL Vahan (405) so that it lands in the ` +
          `approval queue, but Vahan answered ${result.vahanStatus}. Pick a ` +
          `registration that is genuinely de-registered.`
      ).toBe(405);
      expect(result.submitted, `AddVehicle refused: "${result.message}"`).toBe(true);
    });
  }
});
