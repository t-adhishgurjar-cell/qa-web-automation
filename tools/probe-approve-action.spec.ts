import { test } from '@playwright/test';
import { LoginPage } from '../src/pages/login.page';
import { DashboardPage } from '../src/pages/dashboard.page';

/**
 * VA-02 — can a State Admin approve a vehicle from a different division?
 *
 * The listing restriction is measurably gone. The action is the half that
 * matters and is untested: a UI that lists everything while the server still
 * refuses a foreign division is a feature that fails on click, and a server
 * that accepts anything from anyone is a hole. Both are live possibilities.
 *
 * Subject: VehicleNo "demo", customer NAYAFP2020700026, division 15 Dehradun,
 * business state UP_UK, region North. Approver: the Kolkata State Admin —
 * WB_NE, East. Different division, state and region.
 *
 * It lives in RawVehiclesDetail (Id 538, VehicleStatus 411, ApprovedBy null),
 * which is the staging table the queue reads from; VehicleDetails has no row
 * for it yet.
 *
 * APPROVE=true actually approves. Without it this only reports what the row
 * offers, so the controls can be read before anything is clicked.
 *
 *   TOOLS=true ENV=qa APPROVE=true npx playwright test --project=tools --grep "approve action"
 */

const VEHICLE = process.env.PROBE_VEHICLE ?? 'demo';
const APPROVER = { mobile: '9073275904', label: 'Kolkata State Admin (WB_NE / East)' };
const PASSWORD = process.env.OFFICER_PASSWORD ?? 'Nayara@1';

test.use({ storageState: { cookies: [], origins: [] } });

test.describe('Tools — probes @tools', () => {
  test('approve action', async ({ page }) => {
    test.setTimeout(8 * 60_000);

    // Every request the approval makes, so a server-side refusal is visible
    // even when the UI says nothing.
    page.on('response', r => {
      if (/Vehicle/i.test(r.url()) && r.request().method() !== 'GET') {
        console.log(`  HTTP ${r.status()} ${r.request().method()} ${r.url()}`);
      }
    });

    const loginPage = new LoginPage(page);
    const dashboardPage = new DashboardPage(page);
    await loginPage.navigate();
    await loginPage.login(APPROVER.mobile, PASSWORD);
    await dashboardPage.assertDashboardLoaded();

    await page.goto('/Vehicle/VehicleApproval', { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page.waitForTimeout(4_000);

    const row = page.locator('tbody tr').filter({ hasText: VEHICLE }).first();
    if (!(await row.isVisible().catch(() => false))) {
      console.log(`Vehicle "${VEHICLE}" is not listed for ${APPROVER.label}.`);
      return;
    }

    console.log(`\nRow for "${VEHICLE}" as seen by ${APPROVER.label}:`);
    console.log(`  cells   : ${(await row.textContent() ?? '').replace(/\s+/g, ' ').trim()}`);
    const controls = await row.evaluate(tr =>
      Array.from(tr.querySelectorAll('button, a, input')).map(el => {
        const e = el as HTMLElement;
        return `<${e.tagName.toLowerCase()}>#${e.id || '-'}` +
          `[${(e as HTMLInputElement).type || ''}]` +
          `.${(e.className || '').toString().split(/\s+/).filter(Boolean).join('.')}` +
          `:"${(e.textContent || '').replace(/\s+/g, ' ').trim()}"` +
          `${(e as HTMLInputElement).disabled ? ' DISABLED' : ''}`;
      })
    );
    for (const c of controls) console.log(`  control : ${c}`);

    if (process.env.APPROVE !== 'true') {
      console.log('\nAPPROVE is not set — stopping before any click.');
      return;
    }

    // Approve from WITHIN the matched row.
    //
    // The first version of this ticked the row checkbox and then clicked
    // `button:has-text("Approve")).first()` at page level — but there is no
    // page-level Approve. EVERY row carries its own .btn-approve-vahan, so
    // .first() resolved to ROW 1 and approved a different customer's vehicle
    // entirely. The application was blameless and even named the vehicle in its
    // confirmation; the locator was wrong. Scope to the row.
    const approve = row.locator('button.btn-approve-vahan, button:has-text("Approve")').first();
    if (!(await approve.isVisible().catch(() => false))) {
      console.log('  no Approve control in this row');
      return;
    }
    console.log(`\nClicking Approve inside the "${VEHICLE}" row`);
    await approve.click({ timeout: 10_000 });
    await page.waitForTimeout(2_500);

    for (let i = 0; i < 3; i += 1) {
      const modal = page.locator('.modal.show').first();
      if (!(await modal.isVisible().catch(() => false))) break;
      const said = ((await modal.textContent()) ?? '').replace(/\s+/g, ' ').trim();
      console.log(`  MODAL: "${said.slice(0, 260)}"`);
      const yes = modal
        .locator('button:visible, a:visible')
        .filter({ hasText: /^\s*(yes|ok|confirm|proceed|approve)\s*$/i })
        .filter({ hasNotText: /no|cancel|reject/i })
        .first();
      if (!(await yes.isVisible().catch(() => false))) break;
      await yes.click({ timeout: 10_000 }).catch(() => undefined);
      await page.waitForTimeout(3_000);
    }

    await page.waitForTimeout(2_000);
    console.log(`\nFinal url: ${page.url()}`);
  });
});
