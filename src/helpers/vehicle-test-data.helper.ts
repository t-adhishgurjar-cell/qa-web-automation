import { DataReader } from './data-reader.helper';
import { MASTER_TESTCASES_FILE } from './fleetplus-test-data.helper';
import { VehicleTestCase } from '../types/fleetplus.types';

/**
 * Vehicle Management test cases, read from the master workbook.
 *
 * Every Vehicle sheet shares one column layout with the header on the third row
 * (index 2) — unlike the Login sheet, which splits its columns differently. Reading
 * them through one reader keeps that offset in a single place.
 */

export const VEHICLE_HEADER_ROW = 2;

/**
 * Navigation screen -> workbook sheet.
 *
 * Keyed by the screen name as it appears under Vehicle Management in the app, since
 * that is what test authors look for. Two screens share the Vehicle Limit sheet, and
 * three screens have no sheet at all — see tests/vehicle/COVERAGE.md.
 */
export const VEHICLE_SHEETS = {
  addVehicles: 'Single Vehicle Onboarding',
  addVehiclesBulk: 'Bulk Vehicle Onboarding',
  vehicleApproval: 'Manage Pending Vehicle',
  genericVehicleApproval: 'Generic Vehicle & Approval',
  manageVehicles: 'Manage Vehicle',
  vehicleAuthentication: 'Vehicle Authentication',
  blockUnblockVehicle: 'Vehicle StatusBlockUnblock',
  vehicleLimit: 'Vehicle Limit',
  vehicleRoMapping: 'Vehicle RO Mapping',
  transferVehicle: 'Vehicle Transfer',
  demapVehicle: 'Vehicle Demap',
} as const;

export type VehicleSheet = (typeof VEHICLE_SHEETS)[keyof typeof VEHICLE_SHEETS];

type VehicleCaseRow = {
  'TC ID': string;
  Module: string;
  Scenario: string;
  Description: string;
  'Pre-Conditions': string;
  'Test Steps': string;
  'Test Data': string;
  'Expected Result': string;
  Status: string;
  Priority: string;
  Severity: string;
  'Automate?': string;
};

/**
 * Add Vehicles cases that this framework can actually drive through the browser.
 *
 * The sheet marks 29 cases "Automate", but that flag means "worth automating
 * somewhere", not "automatable from a Playwright web suite". The excluded ones are
 * listed in ADD_VEHICLES_NOT_WEB_AUTOMATABLE with the reason, so the gap is visible
 * rather than looking like cases nobody got round to.
 */
export const ADD_VEHICLES_WEB_TC_IDS = new Set([
  'TC001', // page load / empty state
  'TC006', // Vahan verify success
  'TC014', // Customer Admin - own branch allowed
  'TC015', // Customer Admin - other customer's branch denied
  'TC016', // Branch Admin - own branch allowed
  'TC017', // Branch Admin - other branch denied
  'TC018', // Fleet/Nayara Admin - any branch allowed
  'TC019', // OD Customer - own vehicle only
  'TC020', // Vehicle Type dropdown offers only "Registered"
  'TC024', // D-Mapping required popup
  'TC025', // D-Mapping - OTP dialog appears
  'TC026', // D-Mapping - valid OTP completes reassignment
  'TC027', // D-Mapping - invalid OTP rejected
  'TC028', // D-Mapping - OTP resend
  'TC030', // validation - vehicle number required
  'TC032', // validation - ownership type required
  'TC033', // successful submission, all fields valid
]);

/** Add Vehicles cases driven through the API rather than the browser. */
export const ADD_VEHICLES_API_TC_IDS = new Set([
  'TC035', // Customer Admin cannot add for another customer via tampered payload
  'TC036', // Branch Admin cannot add for another branch via tampered payload
]);

/**
 * Why the remaining "Automate" cases are not in the web suite.
 *
 * Kept as data so the coverage report can explain itself, and so re-triaging is an
 * edit here rather than an archaeology exercise across the spec files.
 */
export const ADD_VEHICLES_NOT_WEB_AUTOMATABLE: Record<string, string> = {
  TC008: 'Needs the Vahan KYC API forced down. It is called server-side, so page.route cannot intercept it.',
  TC009: 'Approval happens on the pending-vehicle queue — belongs to the Vehicle Approval module.',
  TC010: 'RO Admin approval on the pending queue; different screen and a role we have no credential for.',
  TC011: 'State Head approval on the pending queue; different screen and a role we have no credential for.',
  TC012: 'FP Admin re-validation against a live Vahan API; different screen and role.',
  TC037: 'Asserts on a vehicleDetails SQL row. The framework has no database layer.',
  TC038: 'Asserts on a RawVehiclesDetail SQL row, and needs Vahan forced down.',
  TC039: 'Asserts on vehicleDetails remarks via SQL.',
  TC040: 'Runs against the FP POS application, not the web portal.',
  TC042: 'Runs against the RO Web Portal, a separate application.',
};

export class VehicleTestData {
  /** Every case on a sheet, blank and placeholder rows dropped. */
  static getTestCases(sheet: VehicleSheet): VehicleTestCase[] {
    return DataReader.fromExcel<VehicleCaseRow>(MASTER_TESTCASES_FILE, sheet, VEHICLE_HEADER_ROW)
      .filter(row => row['TC ID'] && String(row.Scenario).toLowerCase() !== 'nan')
      .map(row => ({
        tcId: String(row['TC ID']).trim(),
        module: String(row.Module ?? '').trim(),
        scenario: String(row.Scenario ?? '').trim(),
        description: String(row.Description ?? '').trim(),
        preConditions: String(row['Pre-Conditions'] ?? '').trim(),
        steps: String(row['Test Steps'] ?? '').trim(),
        testData: String(row['Test Data'] ?? '').trim(),
        expectedResult: String(row['Expected Result'] ?? '').trim(),
        status: String(row.Status ?? '').trim(),
        priority: String(row.Priority ?? '').trim(),
        severity: String(row.Severity ?? '').trim(),
        automate: String(row['Automate?'] ?? '').trim(),
      }));
  }

  /** Cases the workbook flags for automation, on any platform. */
  static getAutomatable(sheet: VehicleSheet): VehicleTestCase[] {
    return this.getTestCases(sheet).filter(tc => tc.automate.toLowerCase() === 'automate');
  }

  /** A single case by ID, for specs that pull their metadata from the workbook. */
  static getById(sheet: VehicleSheet, tcId: string): VehicleTestCase | undefined {
    return this.getTestCases(sheet).find(tc => tc.tcId === tcId);
  }

  /**
   * Cases from `sheet` that the given allowlist admits, in workbook order.
   *
   * Reading the workbook rather than hardcoding titles means a scenario reworded in
   * the sheet shows up reworded in the Allure report, with no code change.
   */
  static getByIds(sheet: VehicleSheet, ids: Set<string>): VehicleTestCase[] {
    return this.getTestCases(sheet).filter(tc => ids.has(tc.tcId));
  }
}
