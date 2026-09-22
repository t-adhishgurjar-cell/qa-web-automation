import { test } from '../src/fixtures/page.fixtures';

/**
 * Is View Onboarding scoped to the officer at all?
 *
 * Four officers at four different levels and in two different regions each see
 * the same ten applications, including OD applications raised in states they do
 * not cover. Two readings fit: the screen is deliberately unscoped, or the
 * scoping is broken. Either way the question a test must settle first is whether
 * the rows on show actually span regions and states the viewer has no claim to —
 * and whether that is true of non-OD applications too, which would make it a
 * pre-existing scope defect rather than something this change introduced.
 *
 *   TOOLS=true ENV=qa npx playwright test --project=tools --grep "probe od scope leak"
 */

test.use({ storageState: { cookies: [], origins: [] } });

const VIEWERS = [
  { level: 'Territory admin, Gurgaon (region 2, state 4, division 17)',
    username: '9612200200', password: process.env.TSM_PASS ?? 'Thinkpad@1' },
  { level: 'Division admin, Ahmedabad I (region 4, state 11, division 1)',
    username: '9073139002', password: process.env.OD_OFFICER_PASSWORD ?? 'Nayara@1' },
];

test.describe('Tools — probes @tools', () => {
  for (const viewer of VIEWERS) {
    test(`probe od scope leak — ${viewer.username}`, async ({
      loginPage, dashboardPage, page, db,
    }) => {
      test.setTimeout(300_000);

      await loginPage.navigate();
      await loginPage.login(viewer.username, viewer.password);
      await dashboardPage.assertDashboardLoaded();

      await page.goto('/Customer/CustomerOnboardingStatus', { waitUntil: 'domcontentloaded' });
      await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);

      const references = await page.evaluate(() => {
        const out: string[] = [];
        for (const row of Array.from(document.querySelectorAll('table tbody tr'))) {
          for (const cell of Array.from(row.querySelectorAll('td'))) {
            const text = (cell.textContent || '').trim();
            if (/^10005\d{5}$/.test(text)) out.push(text);
          }
        }
        return [...new Set(out)];
      });

      console.log(`\n=== ${viewer.level} ===`);
      console.log(`  sees ${references.length} application(s)`);
      if (!references.length) return;

      const stateCols = await db.query<{ c: string }>(`
        SELECT COLUMN_NAME AS c FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_NAME = 'BusinessStateMaster' ORDER BY ORDINAL_POSITION`);
      console.log(`  BusinessStateMaster: ${stateCols.map(r => r.c).join(', ')}`);

      const rows = await db.query<{
        ReferenceNo: number; Status: number; CustomerStateId: number;
        CustomerDivisionId: number; RegionId: number | null; CustomerTypeName: string;
      }>(`
        SELECT r.ReferenceNo, r.Status, r.CustomerStateId, r.CustomerDivisionId,
               s.RegionId, t.CustomerTypeName
        FROM dbo.RawCustomerMaster r
        LEFT JOIN dbo.BusinessStateMaster s ON s.BusinessStateId = r.CustomerStateId
        LEFT JOIN dbo.CustomerTypeMaster t ON t.Id = r.CustomerType
        WHERE r.ReferenceNo IN (${references.map(Number).join(',')})
        ORDER BY r.ReferenceNo DESC`);

      for (const row of rows) console.log('    ' + JSON.stringify(row));

      const regions = new Set(rows.map(r => r.RegionId));
      const states = new Set(rows.map(r => r.CustomerStateId));
      const types = new Set(rows.map(r => r.CustomerTypeName));
      console.log(`  regions on show: ${[...regions].join(', ')}`);
      console.log(`  states on show:  ${[...states].join(', ')}`);
      console.log(`  types on show:   ${[...types].join(', ')}`);
      console.log(`  non-OD applications among them: ` +
        `${rows.filter(r => r.CustomerTypeName !== 'OD').map(r => r.ReferenceNo).join(', ') || 'none'}`);
    });
  }
});
