import { test } from '@playwright/test';
import { LoginPage } from '../src/pages/login.page';
import { DashboardPage } from '../src/pages/dashboard.page';
import { PARENT_ADMIN } from '../src/config/accounts';

/**
 * The Bulk De-Map flow — the second half of the change request's scope.
 *
 * "Bulk mapping de mapping" covers two controls, neither of which is a menu
 * entry: bulk MAPPING is the Bulk Upload tab on Add Vehicles, and bulk
 * DE-MAPPING is a "Bulk De-Map" control inside /Vehicle/DeMapVehicle.
 *
 * This opens it and prints what it offers, per role, plus the template if one
 * is downloadable — the same shape of question as bulk mapping, where the
 * template turned out to carry a Branch ID and therefore the whole scoping
 * question with it.
 *
 *   TOOLS=true ENV=qa npx playwright test --project=tools --grep "bulk demap"
 *
 * Read-only. It de-maps nothing.
 */

const ROLES = [
  { label: 'Ahmedabad I Division Admin (GJ_I/West)', mobile: '9073139002', password: process.env.OFFICER_PASSWORD ?? 'Nayara@1', role: undefined as string | undefined },
  { label: 'Parent Admin (own branches only)', mobile: PARENT_ADMIN.username, password: PARENT_ADMIN.password, role: PARENT_ADMIN.roleCode as string | undefined },
];

test.use({ storageState: { cookies: [], origins: [] } });

test.describe('Tools — probes @tools', () => {
  for (const r of ROLES) {
    test(`bulk demap — ${r.label}`, async ({ page }) => {
      test.setTimeout(6 * 60_000);
      test.skip(!r.password, 'no password configured');

      const loginPage = new LoginPage(page);
      const dashboardPage = new DashboardPage(page);
      await loginPage.navigate();
      await loginPage.login(r.mobile, r.password!, r.role);
      await dashboardPage.assertDashboardLoaded();

      await page.goto('/Vehicle/DeMapVehicle', { waitUntil: 'domcontentloaded', timeout: 45_000 });
      await page.waitForTimeout(3_500);

      const inventory = async (when: string) => {
        const seen = await page.evaluate(() => {
          const onScreen = (el: Element) => {
            const b = (el as HTMLElement).getBoundingClientRect();
            return b.width > 0 && b.height > 0;
          };
          const txt = (el: Element) => (el.textContent || '').replace(/\s+/g, ' ').trim();
          return {
            title: txt(document.querySelector('p.box-head-title') || document.createElement('i')),
            refused: /unauthorized access|do not have permission/i.test(document.body.innerText || ''),
            fields: Array.from(document.querySelectorAll('input:not([type=hidden]), select, textarea'))
              .filter(onScreen)
              .map(f => {
                const e = f as HTMLInputElement;
                return `${e.tagName.toLowerCase()}#${e.id || '-'}[${e.type || ''}]` +
                  `${e.readOnly ? ' RO' : ''}${e.disabled ? ' DIS' : ''}${e.placeholder ? ` ph="${e.placeholder}"` : ''}`;
              }),
            // Hidden file inputs matter here: the bulk control is likely to sit
            // behind a button, exactly as Bulk Upload does on Add Vehicles.
            hiddenFiles: Array.from(document.querySelectorAll('input[type=file]'))
              .map(f => `#${(f as HTMLElement).id || '(no id)'}${onScreen(f) ? '' : ' (hidden)'}`),
            buttons: Array.from(document.querySelectorAll('button, a.btn'))
              .filter(onScreen)
              .map(b => `#${(b as HTMLElement).id || '-'}:"${txt(b).slice(0, 34)}"`),
          };
        });
        console.log(`\n  ${when} — "${seen.title}"${seen.refused ? '  REFUSED' : ''}`);
        console.log(`    fields      : ${seen.fields.join(' | ') || '(none)'}`);
        console.log(`    file inputs : ${seen.hiddenFiles.join(', ') || '(none)'}`);
        console.log(`    buttons     : ${seen.buttons.join(' | ')}`);
      };

      console.log(`\n${'='.repeat(92)}\n${r.label}`);
      await inventory('single de-map view');

      // Open the bulk side.
      const bulk = page.locator('button:has-text("Bulk De-Map"), a:has-text("Bulk De-Map")').first();
      if (!(await bulk.isVisible().catch(() => false))) {
        console.log('  no "Bulk De-Map" control offered to this role');
        return;
      }
      await bulk.click({ timeout: 10_000 }).catch(e => console.log(`  click failed: ${e}`));
      await page.waitForTimeout(3_000);
      await inventory('after clicking Bulk De-Map');

      // If a template is offered, take it — its columns are the scoping question.
      const template = page
        .locator('button:visible, a:visible')
        .filter({ hasText: /template|sample|format/i })
        .first();
      if (await template.isVisible().catch(() => false)) {
        const download = page.waitForEvent('download', { timeout: 25_000 }).catch(() => null);
        await template.click({ timeout: 10_000 }).catch(() => undefined);
        const file = await download;
        if (file) {
          const target = `${process.env.TMPDIR ?? '/tmp'}/demap-template-${r.mobile}.xlsx`;
          await file.saveAs(target);
          console.log(`    template saved: ${target} ("${file.suggestedFilename()}")`);
        } else {
          console.log('    template button present but no download fired');
        }
      } else {
        console.log('    no template control offered');
      }
    });
  }
});
