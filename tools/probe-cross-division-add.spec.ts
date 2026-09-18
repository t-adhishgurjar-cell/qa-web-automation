import { test } from '@playwright/test';
import { LoginPage } from '../src/pages/login.page';
import { DashboardPage } from '../src/pages/dashboard.page';

/**
 * Can an officer add a vehicle for a customer outside its own geography?
 *
 * Officers get a free-text "Enter Branch UID" instead of the parent admin's
 * dropdown of its own branches, so nothing in the form itself constrains which
 * customer they name. Whether the SERVER constrains it is the question, and it
 * matters twice over:
 *
 *   - single Add Vehicles is NOT in the change request's scope, so a cross-
 *     division single add would be a leak, not the feature;
 *   - the Bulk Upload tab beside it probably IS the "bulk mapping" the CR names.
 *
 * This only types the UID and reads what comes back. It adds nothing.
 *
 *   TOOLS=true ENV=qa npx playwright test --project=tools --grep "cross division add"
 */

const PASSWORD = process.env.OFFICER_PASSWORD ?? 'Nayara@1';

const CASES = [
  {
    officer: 'Ahmedabad Division Admin (GJ_I / West)',
    mobile: '9073139002',
    uid: 'NAYAFP2023400247',
    owner: 'Noida branch of NAYAFP1023400246 (UP_UK / North)',
  },
  {
    officer: 'Kolkata State Admin (WB_NE / East)',
    mobile: '9073275904',
    uid: 'NAYAFP2023400247',
    owner: 'Noida branch of NAYAFP1023400246 (UP_UK / North)',
  },
  {
    officer: 'Ahmedabad Division Admin (GJ_I / West)',
    mobile: '9073139002',
    uid: 'NAYAFP2023400255',
    owner: 'Gurgaon branch of NAYAFP1023400254 (HR_HP_PB / North)',
  },
];

test.use({ storageState: { cookies: [], origins: [] } });

test.describe('Tools — probes @tools', () => {
  for (const [i, c] of CASES.entries()) {
    test(`cross division add ${i + 1} — ${c.officer} -> ${c.uid}`, async ({ page }) => {
      test.setTimeout(6 * 60_000);

      page.on('response', async r => {
        if (/Customer|Branch|Vehicle/i.test(r.url()) && r.request().method() === 'POST') {
          const body = await r.text().catch(() => '');
          console.log(`  HTTP ${r.status()} ${r.url().replace(/^https?:\/\/[^/]+/, '')}  ${body.slice(0, 200)}`);
        }
      });

      const loginPage = new LoginPage(page);
      const dashboardPage = new DashboardPage(page);
      await loginPage.navigate();
      await loginPage.login(c.mobile, PASSWORD);
      await dashboardPage.assertDashboardLoaded();

      await page.goto('/Vehicle/AddVehicles', { waitUntil: 'domcontentloaded', timeout: 45_000 });
      await page.waitForTimeout(3_000);

      console.log(`\n${'='.repeat(92)}\n${c.officer}\n  typing UID ${c.uid}  (${c.owner})`);

      await page.locator('#CustomerId').fill(c.uid);
      await page.locator('#CustomerId').blur();
      await page.waitForTimeout(4_000);

      const after = await page.evaluate(() => {
        const v = (id: string) => (document.querySelector(id) as HTMLInputElement | null)?.value ?? '(absent)';
        const onScreen = (el: Element) => {
          const r = (el as HTMLElement).getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        };
        return {
          customerName: v('#CustomerName'),
          errors: Array.from(document.querySelectorAll('.error, .text-danger, .field-validation-error'))
            .filter(onScreen)
            .map(e => (e.textContent || '').replace(/\s+/g, ' ').trim())
            .filter(Boolean),
          modal: Array.from(document.querySelectorAll('.modal.show'))
            .map(m => (m.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 200)),
          addEnabled: !(document.querySelector('#btnAdd') as HTMLButtonElement | null)?.disabled,
        };
      });

      console.log(`  CustomerName resolved to : "${after.customerName}"`);
      console.log(`  inline errors            : ${after.errors.join(' | ') || '(none)'}`);
      console.log(`  modal                    : ${after.modal.join(' | ') || '(none)'}`);
      console.log(`  Add Vehicles enabled     : ${after.addEnabled}`);
      console.log(
        `  VERDICT: ${after.customerName && after.customerName !== '(absent)' && after.customerName.trim()
          ? '*** RESOLVED — this officer can name a customer outside its geography ***'
          : 'not resolved — the server declined to identify the customer'}`
      );
    });
  }
});
