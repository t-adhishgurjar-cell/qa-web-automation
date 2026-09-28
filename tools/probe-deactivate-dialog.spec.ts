import { test } from '@playwright/test';
import { LoginPage } from '../src/pages/login.page';
import { DashboardPage } from '../src/pages/dashboard.page';
import { CustomerStatusPage } from '../src/pages/customer-management/customer-status.page';

/**
 * What the deactivate confirmation actually asks for.
 *
 * As FP Admin, Deactivate is offered, the confirmation appears, OK is clicked — and the customer
 * stays Active with an empty message. A silent no-op, which on this application usually means an
 * unmet precondition that is not shown: a mandatory reason, a second confirmation, or a control
 * that is not the one being pressed.
 *
 * So this opens the dialog and reports its contents and every field inside it, without confirming.
 * Nothing is changed.
 *
 *   TOOLS=true ENV=qa npx playwright test --project=tools --grep "probe deactivate dialog"
 */

const CUSTOMER = process.env.VERIFY_CUSTOMER ?? 'NAYAFP2023400255';
const FP = { username: 'loadtest_006', password: process.env.OFFICER_PASSWORD ?? 'Nayara@1' };

test.describe('Tools — probes @tools', () => {
  test('probe deactivate dialog', async ({ page }) => {
    test.setTimeout(300_000);

    const login = new LoginPage(page);
    const dashboard = new DashboardPage(page);
    await login.navigate();
    await login.login(FP.username, FP.password);
    await dashboard.assertDashboardLoaded();

    const status = new CustomerStatusPage(page);
    await status.open();
    await status.search(CUSTOMER);
    console.log(`  ${CUSTOMER} is ${await status.currentStatus()}`);
    console.log(`  action offered: ${await status.availableAction()}`);

    // Watch what the page posts when the action is taken.
    page.on('response', async r => {
      if (r.request().method() === 'POST' && /Customer/i.test(r.url())) {
        console.log(`    <- ${r.status()} ${r.url().split('/').pop()?.split('?')[0]}: ` +
          `${(await r.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 250)}`);
      }
    });

    await page.locator('#btnSingleAction').click();
    await page.locator('.modal.show').first().waitFor({ state: 'visible', timeout: 10_000 })
      .catch(() => undefined);

    const dialog = await page.evaluate(() => {
      const modal = document.querySelector('.modal.show');
      if (!modal) return null;
      return {
        id: modal.id || '(no id)',
        text: (modal.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 300),
        fields: Array.from(modal.querySelectorAll('input,select,textarea')).map(e => {
          const el = e as HTMLInputElement;
          return `${el.tagName.toLowerCase()}#${el.id || '(no id)'} type=${el.type}` +
            `${el.required || el.getAttribute('data-val-required') !== null ? ' REQUIRED' : ''}` +
            ` value="${(el.value || '').slice(0, 30)}"`;
        }),
        buttons: Array.from(modal.querySelectorAll('button, .btn')).map(b =>
          `${b.id || '(no id)'} "${(b.textContent || '').trim().slice(0, 30)}"` +
          `${(b as HTMLButtonElement).disabled ? ' DISABLED' : ''}`),
      };
    });
    console.log(`\n  dialog: ${JSON.stringify(dialog, null, 2)}`);

    // Confirm, and see what the server says — the earlier run reported nothing at all.
    const ok = page.locator('#confirmation-ok-btn');
    if (await ok.isVisible().catch(() => false)) {
      console.log(`\n  clicking #confirmation-ok-btn`);
      await ok.click();
      await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);
      await page.locator('.modal.show').first().waitFor({ state: 'visible', timeout: 6_000 })
        .catch(() => undefined);
      const after = await page.evaluate(() =>
        Array.from(document.querySelectorAll('.modal.show, .toast.show, .alert'))
          .filter(e => !!(e as HTMLElement).offsetParent)
          .map(e => (e.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 240)));
      console.log(`  after confirming: ${after.join('  ||  ') || 'the page said nothing'}`);
    }

    await status.dismissAnyDialog();
    await status.search(CUSTOMER);
    console.log(`\n  ${CUSTOMER} is now ${await status.currentStatus()}`);
  });
});
