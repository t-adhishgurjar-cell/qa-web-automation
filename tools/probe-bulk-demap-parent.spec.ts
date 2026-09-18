import { test } from '@playwright/test';
import { LoginPage } from '../src/pages/login.page';
import { DashboardPage } from '../src/pages/dashboard.page';
import { PARENT_ADMIN } from '../src/config/accounts';

/**
 * Can a customer admin use Bulk De-Map at all?
 *
 * The first look showed #bdCustomerId rendered READONLY for a parent admin and
 * none of the upload controls present — no template, no Upload Excel, no file
 * input. That is either correct scoping taken to its conclusion (the customer is
 * pinned, and it simply cannot be changed) or a panel that failed to finish
 * rendering. The two look identical in a screenshot and need separating.
 *
 * So this waits properly, reports what #bdCustomerId actually holds, and watches
 * for the scope call the officer flow makes (/Vehicle/ResolveBulkDemapCustomerScope,
 * which returned scopeMode "child" and a lockedBranchLocation there).
 *
 *   TOOLS=true ENV=qa npx playwright test --project=tools --grep "bulk demap parent"
 *
 * Read-only.
 */

test.use({ storageState: { cookies: [], origins: [] } });

test.describe('Tools — probes @tools', () => {
  test('bulk demap parent', async ({ page }) => {
    test.setTimeout(6 * 60_000);
    test.skip(!PARENT_ADMIN.password, 'Set PARENT_ADMIN_PASS');

    page.on('response', async r => {
      if (/Demap|DeMap/i.test(r.url()) && r.request().method() === 'POST') {
        console.log(`  HTTP ${r.status()} ${r.url().replace(/^https?:\/\/[^/]+/, '')}  ${(await r.text().catch(() => '')).slice(0, 260)}`);
      }
    });

    const loginPage = new LoginPage(page);
    const dashboardPage = new DashboardPage(page);
    await loginPage.navigate();
    await loginPage.login(PARENT_ADMIN.username, PARENT_ADMIN.password, PARENT_ADMIN.roleCode);
    await dashboardPage.assertDashboardLoaded();

    await page.goto('/Vehicle/DeMapVehicle', { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page.waitForTimeout(3_000);
    await page.locator('button:has-text("Bulk De-Map"), a:has-text("Bulk De-Map")').first().click({ timeout: 10_000 });

    // Wait for it to settle rather than sampling immediately — the officer's
    // panel populates from a scope call, so an instant read can catch it empty.
    await page.waitForTimeout(6_000);

    const state = await page.evaluate(() => {
      const onScreen = (el: Element) => {
        const b = (el as HTMLElement).getBoundingClientRect();
        return b.width > 0 && b.height > 0;
      };
      const txt = (el: Element) => (el.textContent || '').replace(/\s+/g, ' ').trim();
      const cid = document.querySelector('#bdCustomerId') as HTMLInputElement | null;
      const cname = document.querySelector('#bdCustomerName') as HTMLInputElement | null;
      return {
        customerId: cid ? `"${cid.value}"${cid.readOnly ? ' READONLY' : ''}${cid.disabled ? ' DISABLED' : ''}` : '(absent)',
        customerName: cname ? `"${cname.value}"` : '(absent)',
        // Present in the DOM at all, visible or not — that is the distinction.
        allBulkControls: ['#btnBdDownloadTemplate', '#btnBdPickExcel', '#btnBdSubmit', '#btnBdReset', '#bdExcelFile']
          .map(sel => {
            const e = document.querySelector(sel) as HTMLElement | null;
            if (!e) return `${sel}: ABSENT from the DOM`;
            return `${sel}: present, ${onScreen(e) ? 'visible' : 'hidden'}`;
          }),
        visibleButtons: Array.from(document.querySelectorAll('button, a.btn')).filter(onScreen)
          .map(b => `#${(b as HTMLElement).id || '-'}:"${txt(b).slice(0, 30)}"`),
        panelText: (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 420),
      };
    });

    console.log(`\n  #bdCustomerId   : ${state.customerId}`);
    console.log(`  #bdCustomerName : ${state.customerName}`);
    console.log(`  bulk controls:`);
    for (const c of state.allBulkControls) console.log(`    ${c}`);
    console.log(`  visible buttons : ${state.visibleButtons.join(' | ')}`);
    console.log(`  panel text      : ${state.panelText.slice(0, 380)}`);
  });
});
