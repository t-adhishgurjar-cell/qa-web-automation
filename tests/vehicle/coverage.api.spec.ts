import { test, expect } from '@playwright/test';
import {
  VehicleTestData,
  VEHICLE_SHEETS,
  ADD_VEHICLES_WEB_TC_IDS,
  ADD_VEHICLES_API_TC_IDS,
  ADD_VEHICLES_NOT_WEB_AUTOMATABLE,
} from '../../src/helpers/vehicle-test-data.helper';

/**
 * Guards the link between the workbook and the vehicle suite.
 *
 * The workbook is hand-maintained and the suite selects cases from it by ID, so a
 * renamed sheet or a re-numbered row silently drops tests instead of failing. These
 * checks turn that into a red test.
 *
 * Named `.api.spec.ts` because that is what routes a spec to the browserless `api`
 * project — nothing here needs a browser, and the browser projects ignore the
 * pattern, so it runs exactly once.
 */

test('vehicle test-data helper resolves the Add Vehicles allowlist', async () => {
  const sheet = VEHICLE_SHEETS.addVehicles;
  const all = VehicleTestData.getTestCases(sheet);
  const auto = VehicleTestData.getAutomatable(sheet);
  const ids = new Set(all.map(t => t.tcId));

  console.log(`total rows: ${all.length} | automate: ${auto.length}`);

  const triaged = [
    ...ADD_VEHICLES_WEB_TC_IDS,
    ...ADD_VEHICLES_API_TC_IDS,
    ...Object.keys(ADD_VEHICLES_NOT_WEB_AUTOMATABLE),
  ];
  const unresolved = triaged.filter(i => !ids.has(i));
  console.log(`UNRESOLVED: ${JSON.stringify(unresolved)}`);

  const untriaged = auto
    .map(t => t.tcId)
    .filter(
      i =>
        !ADD_VEHICLES_WEB_TC_IDS.has(i) &&
        !ADD_VEHICLES_API_TC_IDS.has(i) &&
        !(i in ADD_VEHICLES_NOT_WEB_AUTOMATABLE)
    );
  console.log(`UNTRIAGED: ${JSON.stringify(untriaged)}`);

  const web = VehicleTestData.getByIds(sheet, ADD_VEHICLES_WEB_TC_IDS);
  console.log(`web resolved: ${web.length}/${ADD_VEHICLES_WEB_TC_IDS.size}`);
  web.slice(0, 3).forEach(t => console.log(`  ${t.tcId} | ${t.priority} | ${t.scenario}`));

  expect(unresolved, 'allowlist IDs not present in the sheet').toEqual([]);
  expect(untriaged, 'Automate cases with no triage decision').toEqual([]);
});

test('every vehicle sheet named in VEHICLE_SHEETS exists and parses', async () => {
  for (const [screen, sheet] of Object.entries(VEHICLE_SHEETS)) {
    const rows = VehicleTestData.getTestCases(sheet);
    console.log(`${screen} -> "${sheet}": ${rows.length} rows`);
    expect(rows.length, `${sheet} parsed as empty`).toBeGreaterThan(0);
  }
});
