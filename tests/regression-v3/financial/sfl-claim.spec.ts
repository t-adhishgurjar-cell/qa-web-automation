import * as fs from 'fs';
import * as path from 'path';
import type { Page } from '@playwright/test';
import { test, expect } from '../../../src/fixtures/session.fixtures';
import { LANES } from '../../../src/config/test-accounts';
import { caseTitle } from '../../../src/helpers/v3-sheet.helper';
import { SflClaimPage, SFL_COLUMNS, sflRows, sflWorkbook, nelFileName } from '../../../src/pages/v3/financial/sfl-claim.page';
import { attachOnFailure, observed, deviation } from '../../../src/pages/v3/financial/evidence';
import { openFromSidebar } from '../../../src/pages/v3/financial/sidebar';

/**
 * SFL Claim Upload — v3 sheet W-0127..W-0136 and F-172..F-179. FP Admin (9061909500).
 *
 * Files are generated per run in the test's output folder. Valid uploads are saved by the
 * server as an upload record (the page's own "File uploaded successfully"), but nothing is
 * ever Posted — Post is the step that settles claims, and no case asks for it. Each test
 * clears the page with Reset afterwards.
 *
 * Dealer names carry "AUTOV3": the page's dealer-name rule allows letters, digits, spaces,
 * dots and hyphens only, so the lane's usual "AUTO_V3_" prefix would itself be refused.
 */

let fpPage: Page | undefined;
test.afterEach(async ({}, testInfo) => attachOnFailure(testInfo, [fpPage]));

async function openUpload(sessionFor: (a: typeof LANES.financial.fpAdmin) => Promise<Page>): Promise<SflClaimPage> {
  fpPage = await sessionFor(LANES.financial.fpAdmin);
  const sfl = new SflClaimPage(fpPage);
  await sfl.open();
  return sfl;
}

const dir = () => test.info().outputPath('sfl');

test.describe('v3 Financial — SFL Claim Upload', () => {
  test.describe.configure({ timeout: 120_000 });

  test(caseTitle(['W-0130', 'F-175'], 'SFL Claim Upload shows the upload section, Browse File and Reset'), async ({ sessionFor }) => {
    fpPage = await sessionFor(LANES.financial.fpAdmin);
    await openFromSidebar(fpPage, 'SFL Claim Management', SflClaimPage.route);
    const sfl = new SflClaimPage(fpPage);
    await expect(sfl.title, 'page heading').toHaveText(/SFL Claim Upload/i);
    await expect(sfl.dropZone, 'upload section').toBeVisible();
    await expect(sfl.browse, 'Browse File button').toBeVisible();
    await expect(sfl.browse).toHaveText(/Browse File/i);
    await expect(sfl.reset, 'Reset button').toBeVisible();
  });

  test(caseTitle(['W-0131', 'F-176', 'W-0133', 'F-178', 'W-0135', 'W-0136'], 'browsing a valid Excel shows its name, uploads with a success pop-up, and the grid and total match the file'), async ({ sessionFor }) => {
    const sfl = await openUpload(sessionFor);
    const rows = sflRows(3);
    const file = sflWorkbook(dir(), rows);
    await sfl.browseFile(file);
    const shown = await sfl.dialogs.next(30_000);
    observed(`upload: ${JSON.stringify(shown)}; name "${(await sfl.fileName.innerText()).trim()}"; summary "${(await sfl.summary.innerText().catch(() => '')).trim()}"`);
    await expect(sfl.fileName, 'W-0131: selected file name displayed').toContainText(path.basename(file));
    expect(shown?.kind, 'W-0133: success pop-up').toBe('success');
    expect(shown?.text, 'W-0133: "File uploaded successfully"').toMatch(/File uploaded successfully/i);
    await sfl.dialogs.dismissAll();

    const grid = await Promise.all((await sfl.rows.all()).map(async r => (await r.locator('td').allInnerTexts()).map(c => c.trim())));
    expect(grid.length, 'W-0135: every uploaded row is shown').toBe(rows.length);
    rows.forEach((r, i) => {
      const cells = grid.find(g => g[8] === r.BATCH_TXN_NUMBER);
      expect(cells, `W-0135: row ${i + 1} (${r.BATCH_TXN_NUMBER}) displayed`).toBeTruthy();
      SFL_COLUMNS.forEach((c, j) => expect(cells![j + 1], `W-0135: row ${i + 1} ${c}`).toBe(r[c]));
    });
    await expect(sfl.summary, 'W-0136: total records count matches the file').toHaveText(new RegExp(`Total Records:\\s*${rows.length}\\b`));
    await sfl.clear();
  });

  test(caseTitle(['W-0132', 'F-177'], 'dragging a valid Excel onto the upload area selects it'), async ({ sessionFor }) => {
    const sfl = await openUpload(sessionFor);
    const file = sflWorkbook(dir(), sflRows(2, Date.now() + 7));
    await sfl.dropFile(file);
    const shown = await sfl.dialogs.next(30_000);
    observed(`drop: ${JSON.stringify(shown)}; name "${(await sfl.fileName.innerText()).trim()}"`);
    await expect(sfl.fileName, 'the dropped file is selected').toContainText(path.basename(file));
    expect(shown?.kind, 'the dropped file is accepted').toBe('success');
    await sfl.dialogs.dismissAll();
    await expect(sfl.rows, 'its rows are read').toHaveCount(2);
    await sfl.clear();
  });

  test(caseTitle(['W-0127', 'F-172'], 'a .pdf or .txt file is not uploaded'), async ({ sessionFor }) => {
    const sfl = await openUpload(sessionFor);
    fs.mkdirSync(dir(), { recursive: true });
    for (const ext of ['pdf', 'txt']) {
      const file = path.join(dir(), nelFileName(new Date(), ext));
      fs.writeFileSync(file, ext === 'pdf' ? '%PDF-1.4\n%AUTOV3\n' : 'AUTOV3 not an excel file\n');
      await sfl.browseFile(file);
      const shown = await sfl.dialogs.next(15_000);
      observed(`.${ext}: ${JSON.stringify(shown)}`);
      expect(shown?.kind, `.${ext} refused`).not.toBe('success');
      expect(shown?.text, `.${ext}: only Excel allowed`).toMatch(/Only Excel/i);
      await sfl.dialogs.dismissAll();
      await expect(sfl.rows.filter({ has: fpPage!.locator('td:nth-child(9)') }), `.${ext}: nothing uploaded`).toHaveCount(0);
    }
  });

  test(caseTitle(['W-0128', 'F-173'], 'a modified template header gives INVALID FORMAT'), async ({ sessionFor }) => {
    const sfl = await openUpload(sessionFor);
    const header = [...SFL_COLUMNS].map(c => (c === 'CARD_NUMBER' ? 'CARD_NO_MODIFIED' : c));
    const file = sflWorkbook(dir(), sflRows(1, Date.now() + 11), nelFileName(), header);
    await sfl.browseFile(file);
    const shown = await sfl.dialogs.next(15_000);
    observed(JSON.stringify(shown));
    expect(shown?.kind, 'refused').not.toBe('success');
    expect(shown?.text, 'INVALID FORMAT message').toMatch(/INVALID FORMAT/);
    await sfl.dialogs.dismissAll();
  });

  test(caseTitle(['W-0129', 'F-174'], 'a duplicate FP Transaction ID raises the duplicate validation'), async ({ sessionFor }) => {
    const sfl = await openUpload(sessionFor);
    const rows = sflRows(2, Date.now() + 13);
    rows[1].BATCH_TXN_NUMBER = rows[0].BATCH_TXN_NUMBER;
    rows[1].PAYMENT_AMOUNT = '9';
    const file = sflWorkbook(dir(), rows);
    await sfl.browseFile(file);
    const shown = await sfl.dialogs.next(15_000);
    observed(JSON.stringify(shown));
    deviation('The sheet\'s "FP Transaction Id" is the template\'s BATCH_TXN_NUMBER column (the page maps it to fpTransactionId).');
    expect(shown?.kind, 'refused').not.toBe('success');
    expect(shown?.text, 'duplicate validation message').toMatch(/duplicate/i);
    await sfl.dialogs.dismissAll();
  });

  test(caseTitle(['W-0134', 'F-179'], 'blank mandatory fields raise a validation'), async ({ sessionFor }) => {
    const sfl = await openUpload(sessionFor);
    const rows = sflRows(1, Date.now() + 17);
    rows[0].DEALER_PLACE = '';
    rows[0].CARD_STATUS = '';
    const file = sflWorkbook(dir(), rows);
    await sfl.browseFile(file);
    const shown = await sfl.dialogs.next(15_000);
    observed(JSON.stringify(shown));
    expect(shown?.kind, 'refused').not.toBe('success');
    expect(shown?.text, 'names the missing mandatory fields').toMatch(/required.*Dealer Place.*Card Status/i);
    await sfl.dialogs.dismissAll();
  });
});
