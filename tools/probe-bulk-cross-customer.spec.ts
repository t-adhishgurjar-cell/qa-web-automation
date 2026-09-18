import { test } from '@playwright/test';
import { LoginPage } from '../src/pages/login.page';
import { DashboardPage } from '../src/pages/dashboard.page';
import { DbHelper } from '../src/helpers/db.helper';
import { PARENT_ADMIN } from '../src/config/accounts';
import * as XLSX from 'xlsx';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Bulk Upload takes the Branch ID from the spreadsheet. Whose branches may it name?
 *
 * The template is three columns — Vehicle No | Branch ID | Vehicle Type — and the
 * Bulk Upload tab offers no branch selector at all. That matters because Manual
 * Entry does: a parent admin there picks from #avBranchLocation, a dropdown of
 * its OWN branches, and cannot name anyone else's. Bulk Upload removes that
 * constraint from the UI and moves the choice into a file the uploader writes.
 *
 * So the question is whether the SERVER re-checks it. If it does not, a customer
 * admin can map vehicles onto a branch belonging to a different customer
 * entirely — which is not what the change request asked for. The CR relaxes who
 * may APPROVE a vehicle; it says nothing about letting one customer write into
 * another's fleet.
 *
 * Uploader : 9200000000, Customer Admin of NAYAFP1023400246 (Noida)
 * Target   : NAYAFP2023400255, a branch of NAYAFP1023400254 (Gurgaon) — a
 *            DIFFERENT customer, which this admin's own dropdown never offers.
 *
 * UPLOAD=true performs the upload. Without it the sheet is built and the
 * controls are reported, but nothing is sent.
 *
 *   TOOLS=true ENV=qa UPLOAD=true npx playwright test --project=tools --grep "bulk cross customer"
 */

const FOREIGN_BRANCH = process.env.BULK_TARGET ?? 'NAYAFP2023400255';

/**
 * Who uploads. Two very different questions live here:
 *
 *   parent  — a CUSTOMER admin naming ANOTHER CUSTOMER's branch. Nothing in the
 *             change request asks for this to be allowed, and it is not: the
 *             server answers "You are not authorized to upload vehicles for this
 *             Branch UID."
 *
 *   officer — a Nayara DIVISION admin naming a branch in a DIFFERENT DIVISION.
 *             This IS the change request's "bulk mapping": the restriction being
 *             lifted is geographic, between divisions, not between customers.
 */
const UPLOADERS = {
  parent: {
    label: `Customer Admin ${PARENT_ADMIN.username} of ${PARENT_ADMIN.ownCustomerId}`,
    mobile: PARENT_ADMIN.username,
    password: PARENT_ADMIN.password,
    role: PARENT_ADMIN.roleCode as string | undefined,
  },
  ahmedabadDivision: {
    label: 'Ahmedabad I Division Admin (GJ_I / West)',
    mobile: '9073139002',
    password: process.env.OFFICER_PASSWORD ?? 'Nayara@1',
    role: undefined as string | undefined,
  },
  kolkataState: {
    label: 'Kolkata State Admin (WB_NE / East)',
    mobile: '9073275904',
    password: process.env.OFFICER_PASSWORD ?? 'Nayara@1',
    role: undefined as string | undefined,
  },
} as const;
const UPLOADER = UPLOADERS[(process.env.BULK_UPLOADER ?? 'parent') as keyof typeof UPLOADERS];
const POOL = path.join(__dirname, '../test-data/deregistered-vehicles.json');

async function freeRegistration(): Promise<string> {
  const pool: { no: string }[] = JSON.parse(fs.readFileSync(POOL, 'utf8'));
  for (const entry of pool) {
    const taken = await DbHelper.query<{ n: number }>(
      `SELECT (SELECT COUNT(*) FROM dbo.VehicleDetails WHERE VehicleNo = @v)
            + (SELECT COUNT(*) FROM dbo.RawVehiclesDetail WHERE VehicleNo = @v) AS n`,
      { v: entry.no });
    if (Number(taken[0]?.n ?? 0) === 0) return entry.no;
  }
  throw new Error('pool exhausted');
}

test.use({ storageState: { cookies: [], origins: [] } });

test.describe('Tools — probes @tools', () => {
  test('bulk cross customer', async ({ page }) => {
    test.setTimeout(8 * 60_000);
    test.skip(!UPLOADER.password, 'no password for this uploader');

    const registration = await freeRegistration();

    // Confirm the two really are different customers before claiming anything.
    const owners = await DbHelper.query<{ CustomerId: string; ParentCustomerId: string | null; CustomerDivisionId: number }>(
      `SELECT CustomerId, ParentCustomerId, CustomerDivisionId FROM dbo.CustomerMaster
        WHERE CustomerId IN ('NAYAFP2023400247', @foreign)`, { foreign: FOREIGN_BRANCH })
      .catch(async () => DbHelper.query(
        `SELECT CustomerId, NULL AS ParentCustomerId, CustomerDivisionId FROM dbo.CustomerMaster
          WHERE CustomerId IN ('NAYAFP2023400247', @foreign)`, { foreign: FOREIGN_BRANCH }));
    console.log(`ownership check: ${JSON.stringify(owners)}`);
    console.log(`uploader   : ${UPLOADER.label}`);
    console.log(`target     : ${FOREIGN_BRANCH} (a different customer's branch)`);
    console.log(`vehicle    : ${registration}`);

    const sheetPath = path.join(process.env.TMPDIR ?? '/tmp', `bulk-cross-${Date.now()}.xlsx`);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        ['Vehicle No', 'Branch ID', 'Vehicle Type'],
        // "Vehicle Type" in this template is OWNERSHIP, not fuel: the upload
        // answers "Invalid Vehicle Type (must be Owned or Attached)" for
        // anything else. Sending "Diesel" got the sheet rejected on validation
        // before the Branch ID was ever examined, which looked like the server
        // defending the branch when it had not yet looked at it.
        [registration, FOREIGN_BRANCH, process.env.BULK_OWNERSHIP ?? 'Owned'],
      ]),
      'Template'
    );
    XLSX.writeFile(wb, sheetPath);
    console.log(`sheet built: ${sheetPath}`);

    const loginPage = new LoginPage(page);
    const dashboardPage = new DashboardPage(page);
    await loginPage.navigate();
    await loginPage.login(UPLOADER.mobile, UPLOADER.password!, UPLOADER.role);
    await dashboardPage.assertDashboardLoaded();

    await page.goto('/Vehicle/AddVehicles', { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page.waitForTimeout(3_000);

    // What its own dropdown offers, to show the target is genuinely absent.
    const offered = await page.locator('#avBranchLocation option').allTextContents().catch(() => []);
    const listsTarget = offered.some(o => o.includes(FOREIGN_BRANCH));
    console.log(`\nits own branch dropdown offers ${offered.length} option(s); includes ${FOREIGN_BRANCH}? ${listsTarget}`);

    await page.locator('#avTabBulk').click({ timeout: 10_000 });
    await page.waitForTimeout(2_500);

    if (process.env.UPLOAD !== 'true') {
      console.log('UPLOAD not set — stopping before sending the sheet.');
      return;
    }

    page.on('response', async r => {
      if (r.request().method() === 'POST') {
        console.log(`  HTTP ${r.status()} ${r.url().replace(/^https?:\/\/[^/]+/, '')}  ${(await r.text().catch(() => '')).slice(0, 300)}`);
      }
    });

    // The file input is hidden behind "Upload Excel".
    const input = page.locator('input[type=file]').first();
    await input.setInputFiles(sheetPath, { timeout: 15_000 }).catch(async e => {
      console.log(`  direct setInputFiles failed (${e}); trying via the button`);
      const chooser = page.waitForEvent('filechooser', { timeout: 15_000 }).catch(() => null);
      await page.locator('#btnUploadExcel').click({ timeout: 10_000 }).catch(() => undefined);
      const fc = await chooser;
      if (fc) await fc.setFiles(sheetPath);
    });
    await page.waitForTimeout(3_000);
    await page.locator('#btnUploadExcel').click({ timeout: 10_000 }).catch(() => undefined);
    await page.waitForTimeout(6_000);

    // Upload Excel only parses the sheet into the page — CheckVehicleDuplicates
    // returns and nothing is written. There is a second, separate commit step,
    // so dump what the page now offers rather than assuming the upload was the
    // whole transaction.
    const staged = await page.evaluate(() => {
      const onScreen = (el: Element) => {
        const b = (el as HTMLElement).getBoundingClientRect();
        return b.width > 0 && b.height > 0;
      };
      const txt = (el: Element) => (el.textContent || '').replace(/\s+/g, ' ').trim();
      return {
        rows: Array.from(document.querySelectorAll('tbody tr')).filter(onScreen).map(r => txt(r).slice(0, 120)),
        buttons: Array.from(document.querySelectorAll('button, a.btn')).filter(onScreen)
          .map(b => `#${(b as HTMLElement).id || '-'}:"${txt(b).slice(0, 30)}"${(b as HTMLButtonElement).disabled ? ' DIS' : ''}`),
        fields: Array.from(document.querySelectorAll('input:not([type=hidden]), select')).filter(onScreen)
          .map(f => `#${(f as HTMLElement).id || '-'}`),
      };
    });
    console.log(`\n  after Upload Excel — ${staged.rows.length} staged row(s):`);
    for (const r of staged.rows.slice(0, 5)) console.log(`    ${r}`);
    console.log(`  buttons now: ${staged.buttons.join(' | ')}`);
    console.log(`  fields now : ${staged.fields.join(', ')}`);

    // Commit, if a submit control is offered.
    // #btnSubmitPreview, explicitly and :visible. The bulk tab's commit button
    // is NOT #btnsubmit — that one belongs to Manual Entry and sits hidden in
    // the inactive pane, so a combined locator's .first() resolved to the
    // invisible one and reported no submit control at all. This application
    // shadows visible controls with hidden namesakes on several screens.
    const commit = page.locator('#btnSubmitPreview:visible').first();
    if (await commit.isVisible().catch(() => false)) {
      console.log(`  committing with "${(await commit.textContent() ?? '').trim()}"`);
      await commit.click({ timeout: 10_000 }).catch(e => console.log(`  commit failed: ${e}`));
      await page.waitForTimeout(7_000);
    } else {
      console.log('  no submit control offered after the upload');
    }

    let lastModal = '';
    for (let i = 0; i < 4; i += 1) {
      const modal = page.locator('.modal.show').first();
      if (!(await modal.isVisible().catch(() => false))) break;
      lastModal = ((await modal.textContent()) ?? '').replace(/\s+/g, ' ').trim();
      console.log(`  MODAL: "${lastModal.slice(0, 300)}"`);
      const ok = modal.locator('button:visible, a:visible')
        .filter({ hasText: /^\s*(ok|yes|confirm|proceed|continue)\s*$/i }).first();
      if (!(await ok.isVisible().catch(() => false))) break;
      await ok.click({ timeout: 8_000 }).catch(() => undefined);
      await page.waitForTimeout(3_000);
    }

    const landed = await DbHelper.query<{ VehicleNo: string; CustomerID: string; VehicleStatus: number; CreatedBy: number }>(
      `SELECT VehicleNo, CustomerID, VehicleStatus, CreatedBy FROM dbo.RawVehiclesDetail WHERE VehicleNo = @v
       UNION ALL
       SELECT VehicleNo, CustomerID, VehicleStatus, CreatedBy FROM dbo.VehicleDetails WHERE VehicleNo = @v`,
      { v: registration });
    console.log(`\n  database after upload: ${JSON.stringify(landed)}`);
    // Three outcomes, not two. "Nothing landed" only means the branch was
    // defended if the rejection actually mentioned the branch — a sheet thrown
    // out over a bad ownership value never reached that check.
    const accepted = landed.some(l => l.CustomerID === FOREIGN_BRANCH);
    const complaint = lastModal.toLowerCase();
    const aboutBranch = /branch|customer|not\s+(allowed|permitted|authorised|authorized)|access|scope|belong/.test(complaint);
    console.log(
      `  VERDICT: ${accepted
        ? `*** ACCEPTED — ${UPLOADER.label} mapped ${registration} onto ${FOREIGN_BRANCH}, ` +
          `a branch of another customer that its own dropdown never offers ***`
        : aboutBranch
          ? 'REJECTED on the branch — the server re-checks the Branch ID against the uploader'
          : `INCONCLUSIVE — nothing landed, but the rejection was not about the branch: "${lastModal}"`}`
    );
  });
});
