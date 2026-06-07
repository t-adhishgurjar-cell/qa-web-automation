import * as XLSX from 'xlsx';
import { DataReader } from './data-reader.helper';
import { FleetPlusCredential, LoginTestCase } from '../types/fleetplus.types';

export const MASTER_TESTCASES_FILE = 'test-data/FleetPlusMasterTestCases.xlsx';
export const CREDENTIALS_FILE = 'test-data/FleetPlusUsercredentials.xlsx';
export const LOGIN_SHEET = 'Login';
export const CREDENTIALS_SHEET = 'User Creation Checklist';

type CredentialRow = {
  '#': number | string;
  Role: string;
  'Who They Are': string;
  'username/phone': string | number;
  'Test Password': string;
  'first name': string;
  'Test Email': string;
  'Additional Info Needed': string;
  'Created? ✅': string;
  'Login Tested? ✅': string;
  'Notes / Remarks': string;
};

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
  /** QA environment URL parsed from the credentials sheet header row. */
  static getEnvironmentUrl(): string {
    const workbook = XLSX.readFile(CREDENTIALS_FILE);
    const sheet = workbook.Sheets[CREDENTIALS_SHEET];
    const rows = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, defval: '' });
    const header = String(rows[1]?.[0] ?? '');
    const match = header.match(/webqa\.[\w.-]+|https?:\/\/[\w.-]+/i);
    if (match) {
      const url = match[0];
      return url.startsWith('http') ? url : `https://${url}`;
    }
    return process.env.BASE_URL ?? 'https://webqa.fleetforc.com';
  }

  static getCredentials(): FleetPlusCredential[] {
    return DataReader.fromExcel<CredentialRow>(CREDENTIALS_FILE, CREDENTIALS_SHEET, 2)
      .filter(row => row['username/phone'] && row['Test Password'])
      .map(row => {
        const created = String(row['Created? ✅'] ?? '').trim().toLowerCase();
        const loginTested = String(row['Login Tested? ✅'] ?? '').trim().toLowerCase();
        return {
          sno: Number(row['#']),
          userType: String(row.Role ?? '').trim(),
          mobile: String(row['username/phone']).trim(),
          firstName: String(row['first name'] ?? '').trim(),
          lastName: '',
          email: String(row['Test Email'] ?? '').trim(),
          password: String(row['Test Password'] ?? '').trim(),
          status: created === 'yes' && loginTested === 'yes' ? 'Ready' : 'Not Ready',
        };
      })
      .filter(row => row.mobile && row.password && row.status.toLowerCase() === 'ready');
  }

  static getCredentialByUserType(userType: string): FleetPlusCredential | undefined {
    return this.getCredentials().find(
      c => c.userType.toLowerCase() === userType.toLowerCase()
    );
  }

  static getPrimaryCredential(): FleetPlusCredential {
    const creds = this.getCredentials();
    if (creds.length === 0) {
      throw new Error(`No Ready credentials found in ${CREDENTIALS_FILE}`);
    }

    const preferred = creds.find(c => /HO Admin/i.test(c.userType))
      || creds.find(c => /HO(?! Admin)/i.test(c.userType))
      || creds.find(c => /Territory Admin/i.test(c.userType))
      || creds.find(c => /3rd Party/i.test(c.userType))
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
