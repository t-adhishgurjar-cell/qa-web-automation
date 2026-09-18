import { test } from '@playwright/test';
import { LoginPage } from '../src/pages/login.page';
import { DashboardPage } from '../src/pages/dashboard.page';
import { PARENT_ADMIN } from '../src/config/accounts';

/**
 * The Add Vehicles form, as each role sees it.
 *
 * The invariant under test is that a vehicle is queued against the CUSTOMER's
 * division regardless of who adds it. Which means the interesting part of this
 * form is how each role names the customer: a customer admin can only add to
 * itself, while an officer must be able to choose one — and whatever it chooses
 * is what decides the division.
 *
 *   TOOLS=true ENV=qa npx playwright test --project=tools --grep "add vehicle form"
 */

const ROLES = [
  { label: 'Parent Admin (Noida customer)', mobile: PARENT_ADMIN.username, password: PARENT_ADMIN.password, role: 'CUSTOMER_ADMIN' },
  { label: 'Kolkata State Admin (WB_NE)', mobile: '9073275904', password: process.env.OFFICER_PASSWORD ?? 'Nayara@1', role: undefined },
  { label: 'Ahmedabad Division Admin', mobile: '9073139002', password: process.env.OFFICER_PASSWORD ?? 'Nayara@1', role: undefined },
];

test.use({ storageState: { cookies: [], origins: [] } });

test.describe('Tools — probes @tools', () => {
  for (const r of ROLES) {
    test(`add vehicle form — ${r.label}`, async ({ page }) => {
      test.setTimeout(6 * 60_000);
      test.skip(!r.password, 'no password configured');

      const loginPage = new LoginPage(page);
      const dashboardPage = new DashboardPage(page);
      await loginPage.navigate();
      await loginPage.login(r.mobile, r.password!, r.role);
      await dashboardPage.assertDashboardLoaded();

      await page.goto('/Vehicle/AddVehicles', { waitUntil: 'domcontentloaded', timeout: 45_000 });
      await page.waitForTimeout(4_000);

      const form = await page.evaluate(() => {
        const onScreen = (el: Element) => {
          const rc = (el as HTMLElement).getBoundingClientRect();
          return rc.width > 0 && rc.height > 0;
        };
        const txt = (el: Element) => (el.textContent || '').replace(/\s+/g, ' ').trim();
        return {
          refused: /unauthorized access|do not have permission/i.test(document.body.innerText || ''),
          title: txt(document.querySelector('p.box-head-title') || document.createElement('i')),
          fields: Array.from(document.querySelectorAll('input:not([type=hidden]), select, textarea'))
            .filter(onScreen)
            .map(f => {
              const e = f as HTMLInputElement & HTMLSelectElement;
              const opts = e.tagName === 'SELECT'
                ? ` opts=[${Array.from(e.options).slice(0, 4).map(o => o.text.trim()).join(' / ')}${e.options.length > 4 ? ` …${e.options.length}` : ''}]`
                : '';
              return `${e.tagName.toLowerCase()}#${e.id || '-'}[${e.type || ''}]` +
                `${e.readOnly ? ' READONLY' : ''}${e.disabled ? ' DISABLED' : ''}` +
                `${e.placeholder ? ` ph="${e.placeholder}"` : ''}${opts}` +
                `${e.value ? ` value="${String(e.value).slice(0, 30)}"` : ''}`;
            }),
          buttons: Array.from(document.querySelectorAll('button, a.btn'))
            .filter(onScreen)
            .map(b => `#${(b as HTMLElement).id || '-'}:"${txt(b)}"`),
        };
      });

      console.log(`\n${'='.repeat(92)}\n${r.label}  —  "${form.title}"${form.refused ? '  REFUSED' : ''}`);
      for (const f of form.fields) console.log(`  field  : ${f}`);
      console.log(`  buttons: ${form.buttons.join(' | ')}`);
    });
  }
});
