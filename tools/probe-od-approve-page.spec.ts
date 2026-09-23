import { test } from '../src/fixtures/page.fixtures';
import { FP_ADMIN } from '../src/config/accounts';

/**
 * What the checker screen renders for an OD application.
 *
 * Approve is inert on an OD application at 105: the confirmation prompt never appears
 * and nothing is posted. The page's documented gate is the pair of Verify buttons — the
 * checker retypes the PAN and the bank account and each button must end up disabled and
 * reading "Verified" — and the reviewer screen has already shown that OD renders the
 * same screen with different ids (CheckerOd* rather than Checker*). If the Verify
 * controls are named differently here, verifyField() silently verifies nothing and the
 * gate stays shut.
 *
 * So this lists what the OD checker page actually offers.
 *
 *   OD_APPROVE_REF=1000514990 TOOLS=true ENV=qa npx playwright test --project=tools --grep "probe od approve page"
 */

test.use({ storageState: { cookies: [], origins: [] } });

const REFERENCE = process.env.OD_APPROVE_REF ?? '1000514990';

test.describe('Tools — probes @tools', () => {
  test('probe od approve page', async ({ loginPage, dashboardPage, page }) => {
    test.setTimeout(300_000);

    await loginPage.navigate();
    await loginPage.login(FP_ADMIN.username, FP_ADMIN.password);
    await dashboardPage.assertDashboardLoaded();

    await page.goto('/Customer/ValidateNewCustomer', { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);

    const link = page.locator(`a[href*="${REFERENCE}"]`).first();
    console.log(`  queue link for ${REFERENCE}: ${await link.isVisible().catch(() => false)}`);
    if (await link.isVisible().catch(() => false)) {
      await link.click();
      await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);
    }
    console.log(`  url: ${page.url()}`);

    const verify = await page.evaluate(() =>
      Array.from(document.querySelectorAll('input,button'))
        .filter(e => e.id && /verify|pan|bank|account/i.test(e.id))
        .map(e => {
          const element = e as HTMLInputElement;
          return `${element.tagName.toLowerCase()}#${element.id}` +
            ` type=${element.type}` +
            ` value="${(element.value ?? '').slice(0, 20)}"` +
            ` text="${(e.textContent || '').trim().slice(0, 20)}"` +
            ` disabled=${element.disabled}` +
            `${element.offsetParent ? '' : ' (hidden)'}`;
        })
    );
    console.log(`\n  PAN / bank / verify controls:`);
    for (const v of verify) console.log(`    ${v}`);

    const buttons = await page.evaluate(() =>
      Array.from(document.querySelectorAll('button, a.btn, input[type=submit]'))
        .filter(e => !!(e as HTMLElement).offsetParent)
        .map(e => `${e.id || '(no id)'} "${(e.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 28)}"` +
          `${(e as HTMLButtonElement).disabled ? ' DISABLED' : ''}`)
    );
    console.log(`\n  visible controls:`);
    for (const b of buttons) console.log(`    ${b}`);
  });
});
