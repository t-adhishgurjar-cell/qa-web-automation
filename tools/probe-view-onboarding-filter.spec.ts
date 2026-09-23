import { test } from '../src/fixtures/page.fixtures';

/**
 * Can View Onboarding be made to show more than its ten most recent rows?
 *
 * The scope test needs non-OD applications on screen as its control, and page one is
 * now entirely OD because this suite has been raising OD applications all day.
 * Pagination does not advance, so either the screen caps at ten or the control has to
 * come from its date filter (#cosFromDate, #cosToDate, #cosBtnSearch).
 *
 * This tries a date range that ends before the OD runs began, and reports how many
 * rows come back and of what type.
 *
 *   TOOLS=true ENV=qa npx playwright test --project=tools --grep "probe view onboarding filter"
 */

test.use({ storageState: { cookies: [], origins: [] } });

const VIEWER = { username: '9612200200', password: process.env.TSM_PASS ?? 'Thinkpad@1' };

test.describe('Tools — probes @tools', () => {
  test('probe view onboarding filter', async ({ loginPage, dashboardPage, page, db }) => {
    test.setTimeout(300_000);

    await loginPage.navigate();
    await loginPage.login(VIEWER.username, VIEWER.password);
    await dashboardPage.assertDashboardLoaded();

    await page.goto('/Customer/CustomerOnboardingStatus', { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);

    const read = async (label: string) => {
      const refs = await page.evaluate(() => {
        const out: string[] = [];
        for (const row of Array.from(document.querySelectorAll('table tbody tr'))) {
          for (const cell of Array.from(row.querySelectorAll('td'))) {
            const text = (cell.textContent || '').trim();
            if (/^10005\d{5}$/.test(text)) out.push(text);
          }
        }
        return [...new Set(out)];
      });
      console.log(`\n  ${label}: ${refs.length} row(s)`);
      if (refs.length) {
        const rows = await db.query(`
          SELECT t.CustomerTypeName, COUNT(*) AS n
          FROM dbo.RawCustomerMaster r
          LEFT JOIN dbo.CustomerTypeMaster t ON t.Id = r.CustomerType
          WHERE r.ReferenceNo IN (${refs.map(Number).join(',')})
          GROUP BY t.CustomerTypeName`);
        console.log(`    types: ${JSON.stringify(rows)}`);
      }
      return refs;
    };

    await read('unfiltered');

    // The date inputs' format is whatever the page renders; read one first.
    const format = await page.locator('#cosFromDate').getAttribute('placeholder');
    console.log(`\n  #cosFromDate placeholder: ${format ?? '(none)'}`);

    for (const [from, to] of [['01/09/2026', '16/09/2026'], ['2026-09-01', '2026-09-16']]) {
      await page.locator('#cosFromDate').fill(from).catch(() => undefined);
      await page.locator('#cosToDate').fill(to).catch(() => undefined);
      await page.locator('#cosBtnSearch').click().catch(() => undefined);
      await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);
      await read(`filtered ${from} to ${to}`);
    }
  });
});
