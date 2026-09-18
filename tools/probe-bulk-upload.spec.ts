import { test } from '@playwright/test';
import { LoginPage } from '../src/pages/login.page';
import { DashboardPage } from '../src/pages/dashboard.page';
import { PARENT_ADMIN } from '../src/config/accounts';

/**
 * The Bulk Upload tab on Add Vehicles — the change request's "bulk mapping"?
 *
 * The CR names two in-scope activities: vehicle approval, and "bulk mapping de
 * mapping". Bulk DE-mapping was found as a "Bulk De-Map" control inside
 * /Vehicle/DeMapVehicle. The mapping half appears in none of the FP Admin's 111
 * menu entries, which leaves #avTabBulk beside Manual Entry on Add Vehicles as
 * the only candidate: uploading a sheet of vehicles maps them to a customer in
 * bulk.
 *
 * Read-only. It opens the tab, prints its controls, and downloads the template
 * if one is offered, so the column layout is known before anything is uploaded.
 *
 *   TOOLS=true ENV=qa npx playwright test --project=tools --grep "bulk upload"
 */

const ROLES = [
  { label: 'Parent Admin (own branches only)', mobile: PARENT_ADMIN.username, password: PARENT_ADMIN.password, role: 'CUSTOMER_ADMIN' },
  { label: 'Ahmedabad Division Admin (GJ_I/West)', mobile: '9073139002', password: process.env.OFFICER_PASSWORD ?? 'Nayara@1', role: undefined },
];

test.use({ storageState: { cookies: [], origins: [] } });

test.describe('Tools — probes @tools', () => {
  for (const r of ROLES) {
    test(`bulk upload — ${r.label}`, async ({ page }) => {
      test.setTimeout(6 * 60_000);
      test.skip(!r.password, 'no password configured');

      const loginPage = new LoginPage(page);
      const dashboardPage = new DashboardPage(page);
      await loginPage.navigate();
      await loginPage.login(r.mobile, r.password!, r.role);
      await dashboardPage.assertDashboardLoaded();

      await page.goto('/Vehicle/AddVehicles', { waitUntil: 'domcontentloaded', timeout: 45_000 });
      await page.waitForTimeout(3_000);

      await page.locator('#avTabBulk').click({ timeout: 10_000 }).catch(e => console.log(`  tab click failed: ${e}`));
      await page.waitForTimeout(3_000);

      const tab = await page.evaluate(() => {
        const onScreen = (el: Element) => {
          const b = (el as HTMLElement).getBoundingClientRect();
          return b.width > 0 && b.height > 0;
        };
        const txt = (el: Element) => (el.textContent || '').replace(/\s+/g, ' ').trim();
        return {
          fields: Array.from(document.querySelectorAll('input:not([type=hidden]), select, textarea'))
            .filter(onScreen)
            .map(f => {
              const e = f as HTMLInputElement;
              return `${e.tagName.toLowerCase()}#${e.id || '-'}[${e.type || ''}]` +
                `${e.readOnly ? ' RO' : ''}${e.disabled ? ' DIS' : ''}` +
                `${e.accept ? ` accept="${e.accept}"` : ''}${e.placeholder ? ` ph="${e.placeholder}"` : ''}`;
            }),
          buttons: Array.from(document.querySelectorAll('button, a')).filter(onScreen)
            .filter(b => txt(b) || (b as HTMLElement).id)
            .map(b => `<${b.tagName.toLowerCase()}>#${(b as HTMLElement).id || '-'}:"${txt(b).slice(0, 40)}"` +
              `${(b as HTMLAnchorElement).href && /\.(xlsx|xls|csv)/i.test((b as HTMLAnchorElement).href) ? ' [TEMPLATE LINK]' : ''}`),
          instructions: (document.body.innerText || '')
            .split('\n').map(l => l.trim())
            .filter(l => /upload|template|column|format|maximum|limit|\.xls|csv|row/i.test(l))
            .slice(0, 10),
        };
      });

      console.log(`\n${'='.repeat(92)}\n${r.label} — Bulk Upload tab`);
      for (const f of tab.fields) console.log(`  field  : ${f}`);
      console.log(`  buttons: ${tab.buttons.join(' | ')}`);
      console.log(`  notes  :`);
      for (const i of tab.instructions) console.log(`    ${i}`);

      // The tab offers no customer or branch field at all — unlike Manual
      // Entry, where a parent admin must pick from its own branches. So the
      // customer each vehicle is mapped to has to come from inside the
      // spreadsheet, and the template's columns are the whole question: a
      // customer column means whoever uploads decides the mapping.
      const download = page.waitForEvent('download', { timeout: 30_000 }).catch(() => null);
      await page.locator('#btnDownloadTemplate').click({ timeout: 10_000 }).catch(() => undefined);
      const file = await download;
      if (!file) {
        console.log('  template: no download fired');
        return;
      }
      const target = `${process.env.TMPDIR ?? '/tmp'}/bulk-template-${r.mobile}.xlsx`;
      await file.saveAs(target);
      console.log(`  template saved: ${target}  (suggested name "${file.suggestedFilename()}")`);
    });
  }
});
