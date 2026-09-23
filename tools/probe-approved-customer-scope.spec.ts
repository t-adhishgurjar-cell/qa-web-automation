import { test } from '../src/fixtures/page.fixtures';

/**
 * The same scope question on a screen with a control that cannot run dry.
 *
 * View Onboarding holds only its ten most recent applications — pagination does not
 * advance it and its date filter is a datepicker that ignores a fill — and this
 * suite's own OD applications now occupy all ten. So its non-OD control, which was
 * populated and in-scope when first measured, is currently empty, and a control that
 * passes on an empty set proves nothing.
 *
 * Approved Customers (/Customer/ManageCustomers) does not have that problem: there
 * are 104,740 Fleet customers and 135 OD customers in dbo.CustomerMaster, so both
 * groups are present whatever was created today.
 *
 * This reports, per officer: what the screen lists, and how the OD and non-OD rows
 * sit against that officer's own region, state and division.
 *
 *   TOOLS=true ENV=qa npx playwright test --project=tools --grep "probe approved customer scope"
 */

test.use({ storageState: { cookies: [], origins: [] } });

const VIEWERS = [
  { level: 'Territory admin, Gurgaon', username: '9612200200',
    password: process.env.TSM_PASS ?? 'Thinkpad@1' },
  { level: 'Division admin, Ahmedabad I', username: '9073139002',
    password: process.env.OD_OFFICER_PASSWORD ?? 'Nayara@1' },
];

test.describe('Tools — probes @tools', () => {
  for (const viewer of VIEWERS) {
    test(`probe approved customer scope — ${viewer.username}`, async ({
      loginPage, dashboardPage, page, db,
    }) => {
      test.setTimeout(300_000);

      await loginPage.navigate();
      await loginPage.login(viewer.username, viewer.password);
      await dashboardPage.assertDashboardLoaded();

      const response = await page.goto('/Customer/ManageCustomers', { waitUntil: 'domcontentloaded' })
        .catch(() => null);
      await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);
      console.log(`\n=== ${viewer.level} — http ${response?.status() ?? 0} ===`);

      const body = (await page.locator('body').textContent().catch(() => '')) ?? '';
      if (/unauthor|access denied/i.test(body)) {
        console.log('  REFUSED');
        return;
      }

      // Customer ids look like NAYAFP3023400261.
      const ids = await page.evaluate(() => {
        const out: string[] = [];
        for (const cell of Array.from(document.querySelectorAll('table tbody td'))) {
          const text = (cell.textContent || '').trim();
          if (/^NAYA[A-Z0-9]{10,}$/.test(text)) out.push(text);
        }
        return [...new Set(out)];
      });
      console.log(`  ${ids.length} customer(s) listed`);
      if (!ids.length) {
        const grid = (await page.locator('table').first().textContent().catch(() => '')) ?? '';
        console.log(`  grid text: ${grid.replace(/\s+/g, ' ').trim().slice(0, 200)}`);
        return;
      }

      const scope = (await db.query<{ RegionId: number; BusinessStateId: number; DivisionId: number }>(`
        SELECT m.RegionId, m.BusinessStateId, m.DivisionId
        FROM dbo.Users u JOIN dbo.UserLocationMapping m ON m.UserId = u.Id
        WHERE u.UserName = '${viewer.username}'`))[0];
      console.log(`  scope: ${JSON.stringify(scope)}`);

      const rows = await db.query<{
        CustomerID: string; CustomerTypeName: string; CustomerStateId: number;
        CustomerDivisionId: number; RegionId: number;
      }>(`
        SELECT c.CustomerID, t.CustomerTypeName, c.CustomerStateId, c.CustomerDivisionId,
               s.RegionId
        FROM dbo.CustomerMaster c
        LEFT JOIN dbo.CustomerTypeMaster t ON t.Id = c.CustomerType
        LEFT JOIN dbo.BusinessStateMaster s ON s.BusinessStateId = c.CustomerStateId
        WHERE c.CustomerID IN (${ids.map(i => `'${i}'`).join(',')})`);

      const outside = (r: typeof rows[number], ignoreDivision: boolean) =>
        (scope.RegionId && r.RegionId !== scope.RegionId) ||
        (scope.BusinessStateId && r.CustomerStateId !== scope.BusinessStateId) ||
        (!ignoreDivision && scope.DivisionId && r.CustomerDivisionId !== scope.DivisionId);

      const od = rows.filter(r => r.CustomerTypeName === 'OD');
      const other = rows.filter(r => r.CustomerTypeName !== 'OD');
      console.log(`  ${rows.length} resolved: ${od.length} OD, ${other.length} non-OD`);
      console.log(`  non-OD outside scope (all three levels): ${other.filter(r => outside(r, false)).length}`);
      console.log(`  OD outside scope (division ignored):     ${od.filter(r => outside(r, true)).length}`);
      for (const r of od.filter(r => outside(r, true)).slice(0, 5)) {
        console.log(`    leaked OD ${r.CustomerID}: region ${r.RegionId}, state ${r.CustomerStateId}, division ${r.CustomerDivisionId}`);
      }
      for (const r of other.filter(r => outside(r, false)).slice(0, 5)) {
        console.log(`    leaked non-OD ${r.CustomerID}: region ${r.RegionId}, state ${r.CustomerStateId}, division ${r.CustomerDivisionId}`);
      }
    });
  }
});
