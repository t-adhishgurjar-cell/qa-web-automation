import * as fs from 'fs';
import * as path from 'path';
import * as XLSX from 'xlsx';
import { Page } from '@playwright/test';
import { BasePage } from '../../base.page';
import { AppDialogs } from './app-dialogs';

/**
 * SFL Claim Upload — /SFLClaim/Upload (sfl-claim-upload.js), FP Admin.
 *
 * Browse (#btnSflClaimUploadExcel) opens a file input the script creates on the fly; a drop
 * on #sflClaimDropZone does the same. A chosen file is validated in the browser — name must
 * be "NEL PAYMENT FILE dd MM yyyy.xls(x)", extension .xls/.xlsx, ≤10 MB, the ten columns
 * DEALER_NAME … SETTLEMENT_DATE present (else "INVALID FORMAT"), every field filled, no
 * duplicate BATCH_TXN_NUMBER — then saved to the server (/SFLClaim/…SaveFile) and shown in
 * #sflClaimUploadTbl with "Total Records: n". Post (#btnSflClaimPost) is a separate step
 * that settles the claims; the suite never presses it.
 */
export const SFL_COLUMNS = ['DEALER_NAME', 'DEALER_PLACE', 'PAYMENT_AMOUNT', 'CARD_NUMBER', 'CARD_STATUS', 'TERMINAL_NUMBER', 'BATCH_ID', 'BATCH_TXN_NUMBER', 'TRANSACTION_DATE', 'SETTLEMENT_DATE'] as const;
export type SflRow = Record<(typeof SFL_COLUMNS)[number], string>;

export class SflClaimPage extends BasePage {
  static readonly route = '/SFLClaim/Upload';

  readonly title = this.page.locator('p.box-head-title').first();
  readonly dropZone = this.page.locator('#sflClaimDropZone');
  readonly browse = this.page.locator('#btnSflClaimUploadExcel');
  readonly reset = this.page.locator('#btnSflClaimResetFile');
  readonly fileName = this.page.locator('#sflClaimSelectedFileName');
  readonly summary = this.page.locator('#sflClaimRecordSummary');
  readonly grid = this.page.locator('#sflClaimUploadTbl');
  readonly rows = this.page.locator('#sflClaimUploadTbl tbody tr');
  readonly post = this.page.locator('#btnSflClaimPost');
  readonly dialogs = new AppDialogs(this.page);

  constructor(page: Page) {
    super(page);
  }

  async open(): Promise<void> {
    await this.navigateTo(SflClaimPage.route);
    await this.browse.waitFor({ state: 'visible', timeout: 30_000 });
    await this.settle();
  }

  /** Browse File → choose `file` in the chooser the page opens. */
  async browseFile(file: string): Promise<void> {
    const chooserP = this.page.waitForEvent('filechooser', { timeout: 15_000 });
    await this.browse.click();
    const chooser = await chooserP;
    await chooser.setFiles(file);
  }

  /** Drops `file` on the drop zone with a real DataTransfer, as a drag from the desktop does. */
  async dropFile(file: string): Promise<void> {
    const buffer = fs.readFileSync(file).toString('base64');
    const name = path.basename(file);
    const dataTransfer = await this.page.evaluateHandle(({ b64, fileName }) => {
      const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
      const dt = new DataTransfer();
      dt.items.add(new File([bytes], fileName, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
      return dt;
    }, { b64: buffer, fileName: name });
    await this.dropZone.dispatchEvent('dragenter', { dataTransfer });
    await this.dropZone.dispatchEvent('dragover', { dataTransfer });
    await this.dropZone.dispatchEvent('drop', { dataTransfer });
  }

  async clear(): Promise<void> {
    await this.dialogs.dismissAll();
    if (await this.reset.isEnabled().catch(() => false)) {
      await this.reset.click();
      const confirm = await this.dialogs.next(3_000, ['confirmation']);
      if (confirm) await this.dialogs.confirmYes.click();
    }
  }
}

/** The file name the page insists on: "NEL PAYMENT FILE dd MM yyyy.xlsx". */
export function nelFileName(d = new Date(), ext = 'xlsx'): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `NEL PAYMENT FILE ${p(d.getDate())} ${p(d.getMonth() + 1)} ${d.getFullYear()}.${ext}`;
}

/** dd/mm/yyyy hh:mm:ss, a day or more in the past. */
export function sflDate(daysAgo: number): string {
  const d = new Date(Date.now() - daysAgo * 86_400_000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} 10:15:00`;
}

/** Valid claim rows; BATCH_TXN_NUMBERs are unique per run. */
export function sflRows(n: number, seed = Date.now()): SflRow[] {
  return Array.from({ length: n }, (_, i) => ({
    DEALER_NAME: `AUTOV3 Dealer ${i + 1}`,
    DEALER_PLACE: 'Kolkata',
    PAYMENT_AMOUNT: String(1 + i),
    CARD_NUMBER: `70001${String(seed).slice(-8)}${i}`,
    CARD_STATUS: 'Active',
    TERMINAL_NUMBER: `T${String(seed).slice(-6)}`,
    BATCH_ID: String(seed).slice(-6),
    BATCH_TXN_NUMBER: `${String(seed).slice(-9)}${i}`,
    TRANSACTION_DATE: sflDate(2),
    SETTLEMENT_DATE: sflDate(1),
  }));
}

/** Writes an .xlsx with the given header and rows into `dir`, named `name`. */
export function writeWorkbook(dir: string, name: string, header: string[], rows: string[][]): string {
  fs.mkdirSync(dir, { recursive: true });
  const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  const file = path.join(dir, name);
  XLSX.writeFile(wb, file);
  return file;
}

export function sflWorkbook(dir: string, rows: SflRow[], name = nelFileName(), header: string[] = [...SFL_COLUMNS]): string {
  return writeWorkbook(dir, name, header, rows.map(r => SFL_COLUMNS.map(c => r[c])));
}
