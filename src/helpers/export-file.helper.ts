import * as fs from 'fs';
import * as XLSX from 'xlsx';
import type { Download } from '@playwright/test';

/**
 * Reading what an export button handed over.
 *
 * FleetPlus exports are not all real workbooks: Credit PIN Logs downloads an .xlsx, while
 * Customer Credit PIN Validity downloads an HTML table named .xls. SheetJS reads both, so
 * tests compare the file's cells with the grid rather than trusting its extension.
 */
export interface SavedDownload {
  name: string;
  path: string;
  bytes: number;
}

export async function saveDownload(download: Download, into: string): Promise<SavedDownload> {
  fs.mkdirSync(into, { recursive: true });
  const target = `${into}/${download.suggestedFilename()}`;
  await download.saveAs(target);
  return { name: download.suggestedFilename(), path: target, bytes: fs.statSync(target).size };
}

/** First sheet of a spreadsheet-like file as rows of strings (header row first). */
export function readSheetRows(path: string): string[][] {
  const workbook = XLSX.readFile(path, { raw: false });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  return (XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false }) as unknown[][])
    .map(row => row.map(cell => String(cell).trim()))
    .filter(row => row.some(cell => cell !== ''));
}

/** True when the file begins with the PDF signature and is more than a header. */
export function isPdf(path: string): boolean {
  const bytes = fs.readFileSync(path);
  return bytes.subarray(0, 5).toString('latin1') === '%PDF-' && bytes.length > 500;
}
