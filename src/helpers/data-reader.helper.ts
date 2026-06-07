import * as fs from 'fs';
import * as path from 'path';
import * as XLSX from 'xlsx';

export class DataReader {
  /**
   * Read data from a JSON file.
   * Returns the full parsed object — use dot notation to access nested keys.
   *
   * @example
   * const data = DataReader.fromJSON<{ users: User[] }>('test-data/users.json');
   * const users = data.users;
   */
  static fromJSON<T>(filePath: string): T {
    const absolutePath = path.resolve(filePath);
    const raw = fs.readFileSync(absolutePath, 'utf-8');
    return JSON.parse(raw) as T;
  }

  /**
   * Read rows from an Excel file (.xlsx / .xls).
   * Each row becomes an object keyed by the header row values.
   * If no sheet name is provided, the first sheet is used.
   *
   * @example
   * const rows = DataReader.fromExcel('test-data/login-data.xlsx');
   * // [{ username: 'Admin', password: 'admin123', scenario: 'valid login' }, ...]
   *
   * const rows = DataReader.fromExcel('test-data/login-data.xlsx', 'InvalidCredentials');
   */
  static fromExcel<T = Record<string, unknown>>(filePath: string, sheetName?: string, headerRow = 0): T[] {
    const absolutePath = path.resolve(filePath);
    const workbook = XLSX.readFile(absolutePath);
    const sheet = sheetName
      ? workbook.Sheets[sheetName]
      : workbook.Sheets[workbook.SheetNames[0]];
    return XLSX.utils.sheet_to_json<T>(sheet, { range: headerRow });
  }

  /**
   * Read rows from a specific sheet by index (0-based).
   *
   * @example
   * const rows = DataReader.fromExcelSheet('test-data/login-data.xlsx', 1);
   */
  static fromExcelSheet<T = Record<string, unknown>>(filePath: string, sheetIndex: number): T[] {
    const absolutePath = path.resolve(filePath);
    const workbook = XLSX.readFile(absolutePath);
    const sheetName = workbook.SheetNames[sheetIndex];
    return XLSX.utils.sheet_to_json<T>(workbook.Sheets[sheetName]);
  }

  /**
   * List all sheet names in an Excel workbook.
   *
   * @example
   * const sheets = DataReader.getSheetNames('test-data/login-data.xlsx');
   * // ['ValidCredentials', 'InvalidCredentials', 'Users']
   */
  static getSheetNames(filePath: string): string[] {
    const absolutePath = path.resolve(filePath);
    const workbook = XLSX.readFile(absolutePath);
    return workbook.SheetNames;
  }
}
