import { test } from '@playwright/test';
import { LoginPage } from '../src/pages/login.page';
import { DashboardPage } from '../src/pages/dashboard.page';

/**
 * VA-31 — reject a queued vehicle, then re-submit it.
 *
 * The scenario assumes a reject path exists. Every inspection of
 * /Vehicle/VehicleApproval so far has found only Approve: each row carries a
 * checkbox and a .btn-approve-vahan button, and the page carries Search, Reset,
 * "Approve Selected", Excel and PDF. No Reject anywhere.
 *
 * Worth confirming properly before concluding it, because this application
 * routinely parks controls in the DOM hidden — the customer review screen has
 * Reject and Send for Correction, and the wizard footer keeps duplicates in
 * inactive tab panes. So this looks at EVERY element, visible or not, for
 * anything that could decline a vehicle.
 *
 *   TOOLS=true ENV=qa npx playwright test --project=tools --grep "va31"
 *
 * Read-only.
 */

const APPROVER = { label: 'Kolkata State Admin', mobile: '9073275904' };
const PASSWORD = process.env.OFFICER_PASSWORD ?? 'Nayara@1';

test.use({ storageState: { cookies: [], origins: [] } });

test.describe('Tools — probes @tools', () => {
  test('va31 — is there any reject path on Vehicle Approval?', async ({ page }) => {
    test.setTimeout(6 * 60_000);

    const loginPage = new LoginPage(page);
    const dashboardPage = new DashboardPage(page);
    await loginPage.navigate();
    await loginPage.login(APPROVER.mobile, PASSWORD);
    await dashboardPage.assertDashboardLoaded();

    await page.goto('/Vehicle/VehicleApproval', { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page.waitForTimeout(4_000);

    const found = await page.evaluate(() => {
      const REJECTY = /reject|decline|deny|refuse|return|correction|cancel vehicle|remove/i;
      const out: { tag: string; id: string; cls: string; text: string; visible: boolean }[] = [];
      for (const el of Array.from(document.querySelectorAll('button, a, input, [data-action], [onclick]'))) {
        const e = el as HTMLElement;
        const text = (e.textContent || (e as HTMLInputElement).value || '').replace(/\s+/g, ' ').trim();
        const attrs = `${e.id} ${e.className} ${e.getAttribute('data-action') ?? ''} ${e.getAttribute('title') ?? ''}`;
        if (!REJECTY.test(text) && !REJECTY.test(attrs)) continue;
        const r = e.getBoundingClientRect();
        out.push({
          tag: e.tagName.toLowerCase(),
          id: e.id || '(no id)',
          cls: (e.className || '').toString().slice(0, 60),
          text: text.slice(0, 40),
          visible: r.width > 0 && r.height > 0,
        });
      }
      return out;
    });

    console.log(`\nanything that could decline a vehicle (visible or hidden): ${found.length}`);
    for (const f of found) console.log(`  <${f.tag}>#${f.id} "${f.text}" cls=${f.cls} visible=${f.visible}`);

    // And the full inventory of what a row does offer, for the record.
    const rowControls = await page.evaluate(() => {
      const row = document.querySelector('tbody tr');
      if (!row) return [];
      return Array.from(row.querySelectorAll('button, a, input')).map(el => {
        const e = el as HTMLElement;
        return `<${e.tagName.toLowerCase()}>#${e.id || '-'}.${(e.className || '').toString().split(/\s+/).filter(Boolean).join('.')}` +
          `:"${(e.textContent || '').replace(/\s+/g, ' ').trim()}"`;
      });
    });
    console.log(`\nwhat one queue row offers:`);
    for (const c of rowControls) console.log(`  ${c}`);

    console.log(
      `\n  VA-31 VERDICT: ${found.some(f => f.visible)
        ? 'a reject control exists and is visible — VA-31 is testable'
        : found.length
          ? 'reject-like controls exist but all hidden — check whether they belong to this screen'
          : '*** no reject path of any kind on Vehicle Approval — an approver can only approve ***'}`
    );
  });
});
