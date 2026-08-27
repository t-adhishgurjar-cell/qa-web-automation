import * as XLSX from 'xlsx';
import { DataReader } from './data-reader.helper';
import { FleetPlusCredential, LoginTestCase } from '../types/fleetplus.types';

export const MASTER_TESTCASES_FILE = 'test-data/FleetPlusMasterTestCases.xlsx';
export const CREDENTIALS_FILE = 'test-data/FleetPlusUsercredentials.xlsx';
export const LOGIN_SHEET = 'Login';
export const CREDENTIALS_SHEET = 'User Credentials';

/**
 * Columns of the credentials sheet: Role | Username | Password | Region.
 *
 * Matched by name rather than position, and tolerant of case and stray whitespace —
 * the header cells have been "Role " with a trailing space, and this workbook is
 * hand-maintained, so exact-key lookup breaks on an invisible edit.
 */
const CREDENTIAL_COLUMNS = {
  role: ['role', 'user type', 'usertype'],
  username: ['username', 'user name', 'username/phone', 'mobile', 'phone'],
  password: ['password', 'test password'],
  region: ['region', 'who they are', 'division'],
} as const;

type LoginCaseRow = {
  'TC ID': string;
  Module: string;
  Scenario: string;
  'Description/Steps': string;
  'Pre-Conditions': string;
  'Test Data': string;
  'Expected Result': string;
  'Sub-Module': string;
  Status: string;
  Priority: string;
  Severity: string;
  'Automate?': string;
};

export class FleetPlusTestData {
  /** QA environment URL. The credentials sheet no longer carries one. */
  static getEnvironmentUrl(): string {
    return process.env.BASE_URL ?? 'https://webqa.fleetforc.com';
  }

  /** Reads the credentials sheet as a grid, so header position is not assumed. */
  private static readCredentialGrid(): string[][] {
    const workbook = XLSX.readFile(CREDENTIALS_FILE);
    const sheet = workbook.Sheets[CREDENTIALS_SHEET];
    if (!sheet) {
      throw new Error(
        `Sheet "${CREDENTIALS_SHEET}" not found in ${CREDENTIALS_FILE}. ` +
          `Available: ${workbook.SheetNames.join(', ')}`
      );
    }
    return XLSX.utils
      .sheet_to_json<string[]>(sheet, { header: 1, defval: '' })
      .map(row => row.map(cell => String(cell ?? '').trim()));
  }

  /** Locates the header row and maps each needed column to its index. */
  private static resolveColumns(grid: string[][]): { headerRow: number; index: Record<keyof typeof CREDENTIAL_COLUMNS, number> } {
    for (let r = 0; r < Math.min(grid.length, 30); r++) {
      const cells = grid[r].map(c => c.toLowerCase());
      const index = {} as Record<keyof typeof CREDENTIAL_COLUMNS, number>;

      for (const [field, aliases] of Object.entries(CREDENTIAL_COLUMNS)) {
        index[field as keyof typeof CREDENTIAL_COLUMNS] = cells.findIndex(c =>
          (aliases as readonly string[]).includes(c)
        );
      }

      // A usable header row is one that names both identifying columns.
      if (index.username >= 0 && index.password >= 0) return { headerRow: r, index };
    }

    throw new Error(
      `Could not find a header row in "${CREDENTIALS_SHEET}" of ${CREDENTIALS_FILE}. ` +
        `Expected columns named Username and Password.`
    );
  }

  /**
   * Every credential in the workbook.
   *
   * The sheet lists only accounts QA has provisioned, so a present row is treated as
   * usable — there is no longer a Created?/Login Tested? pair to filter on. Blank
   * spacer rows between role groups are skipped.
   */
  static getCredentials(): FleetPlusCredential[] {
    const grid = this.readCredentialGrid();
    const { headerRow, index } = this.resolveColumns(grid);
    const cell = (row: string[], i: number): string => (i >= 0 ? (row[i] ?? '') : '');

    return grid
      .slice(headerRow + 1)
      .map((row, i) => ({
        sno: i + 1,
        userType: cell(row, index.role),
        mobile: cell(row, index.username),
        firstName: '',
        lastName: '',
        email: '',
        password: cell(row, index.password),
        region: cell(row, index.region),
        status: 'Ready',
      }))
      .filter(c => c.mobile && c.password);
  }

  static getCredentialByUserType(userType: string): FleetPlusCredential | undefined {
    return this.getCredentials().find(
      c => c.userType.toLowerCase() === userType.toLowerCase()
    );
  }

  /**
   * The account tests log in with by default.
   *
   * PRIMARY_CREDENTIAL_MOBILE pins a specific account and wins over the userType
   * preference below. The preference is only a guess about which account is healthy,
   * and accounts get blocked — password expiry, lockout — long before the workbook
   * records it. Pinning lets a run move to a working account without editing the
   * source of truth.
   *
   * If the pinned mobile is absent from the workbook it is synthesized from
   * TEST_USERNAME / TEST_PASSWORD, so a newly-issued account is usable before the
   * workbook catches up. That is a stopgap: the workbook stays the source of truth,
   * and the pin should be dropped once it holds a working account.
   */
  static getPrimaryCredential(): FleetPlusCredential {
    const creds = this.getCredentials();
    const pinned = process.env.PRIMARY_CREDENTIAL_MOBILE?.trim();

    if (pinned) {
      const match = creds.find(c => c.mobile === pinned);
      if (match) return match;

      const password = process.env.TEST_PASSWORD?.trim();
      if (!password) {
        throw new Error(
          `PRIMARY_CREDENTIAL_MOBILE=${pinned} is not in ${CREDENTIALS_FILE}, and ` +
            `TEST_PASSWORD is not set, so no password can be resolved for it. Either add ` +
            `the account to the workbook, or set TEST_PASSWORD.`
        );
      }

      return {
        sno: 0,
        userType: 'Env Override',
        mobile: pinned,
        firstName: '',
        lastName: '',
        email: '',
        password,
        status: 'Ready',
      };
    }

    if (creds.length === 0) {
      throw new Error(`No Ready credentials found in ${CREDENTIALS_FILE}`);
    }

    const preferred = creds.find(c => /^tsm$|territory admin/i.test(c.userType))
      || creds.find(c => /^dsa$|3rd party/i.test(c.userType))
      || creds.find(c => /customer admin/i.test(c.userType))
      || creds[0];

    return preferred;
  }

  static getLoginTestCases(): LoginTestCase[] {
    return DataReader.fromExcel<LoginCaseRow>(MASTER_TESTCASES_FILE, LOGIN_SHEET, 2)
      .filter(row => row['TC ID'] && String(row.Scenario).toLowerCase() !== 'nan')
      .map(row => ({
        tcId: String(row['TC ID']).trim(),
        module: String(row.Module ?? '').trim(),
        scenario: String(row.Scenario ?? '').trim(),
        steps: String(row['Description/Steps'] ?? '').trim(),
        preConditions: String(row['Pre-Conditions'] ?? '').trim(),
        testData: String(row['Test Data'] ?? '').trim(),
        expectedResult: String(row['Expected Result'] ?? '').trim(),
        subModule: String(row['Sub-Module'] ?? '').trim(),
        status: String(row.Status ?? '').trim(),
        priority: String(row.Priority ?? '').trim(),
        severity: String(row.Severity ?? '').trim(),
        automate: String(row['Automate?'] ?? '').trim(),
      }));
  }

  static getAutomatableLoginTestCases(): LoginTestCase[] {
    return this.getLoginTestCases().filter(
      tc => tc.automate.toLowerCase() === 'automate'
    );
  }

  /** TC IDs that can run on web with current page objects. */
  static getWebAutomatableTcIds(): Set<string> {
    return new Set([
      'LOG-001', 'LOG-002', 'LOG-003', 'LOG-004', 'LOG-005',
      'LOG-007', 'LOG-008', 'LOG-009',
      'LOG-010', 'LOG-011', 'LOG-012',
      'LOG-013', 'LOG-014', 'LOG-015',
      'LOG-055', 'LOG-057', 'LOG-058', 'LOG-059', 'LOG-060',
      'LOG-061', 'LOG-062', 'LOG-065', 'LOG-066',
      'LOG-071', 'LOG-073', 'LOG-075',
      'LOG-086', 'LOG-087', 'LOG-089',
    ]);
  }
}
