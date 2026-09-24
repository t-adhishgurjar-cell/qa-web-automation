import { test } from '../src/fixtures/page.fixtures';

/**
 * Do the OD customers that predate the change still behave as the change intends?
 *
 * The dummy divisions are storage only — confirmed by dev — so visibility must decide from
 * the customer's *type*, not from whether its division happens to be a placeholder. If that
 * is how it works, then the 135 OD customers created before the change, every one carrying a
 * real division, need nothing: a division admin should see them all regardless.
 *
 * If instead visibility keys off the placeholder, those 135 stay division-restricted and need
 * their divisions backfilled — which is a data migration nobody has mentioned.
 *
 * GJ_I gives a clean pair to ask with. Two approved OD customers predating the change sit in
 * the same business state on different real divisions:
 *
 *   NAYAFP3040500001  state 11, division 1  Ahmedabad I
 *   NAYAFP3043400009  state 11, division 2  Ahmedabad II
 *
 * and this suite holds the division admin for each. Each admin should see both. Whether they
 * do is the whole question, and neither customer is in the other admin's division, so a
 * result either way means something.
 *
 * Read-only.
 *
 *   TOOLS=true ENV=qa npx playwright test --project=tools --grep "probe od legacy division visibility"
 */

test.use({ storageState: { cookies: [], origins: [] } });

const CUSTOMERS = {
  division1: process.env.OD_LEGACY_DIV1 ?? 'NAYAFP3040500001',
  division2: process.env.OD_LEGACY_DIV2 ?? 'NAYAFP3043400009',
};

const ADMINS = [
  { level: 'Ahmedabad I Division Admin', username: '9073139002', ownDivision: 1 },
  { level: 'Ahmedabad II Division Admin', username: '9063600900', ownDivision: 2 },
];

const PASSWORD = process.env.OD_OFFICER_PASSWORD ?? 'Nayara@1';

test.describe('Tools — probes @tools', () => {
  test('probe od legacy division visibility', async ({ loginPage, dashboardPage, page, db }) => {
    test.setTimeout(420_000);

    const facts = await db.query(`
      SELECT c.CustomerID, c.Status, c.CustomerStateId, c.CustomerDivisionId,
             d.DivisionName, d.IsPlaceholder, c.CreatedOn
      FROM dbo.CustomerMaster c
      LEFT JOIN dbo.DivisionMaster d ON d.DivisionId = c.CustomerDivisionId
      WHERE c.CustomerID IN ('${CUSTOMERS.division1}', '${CUSTOMERS.division2}')`);
    console.log('  the two legacy OD customers under test:');
    for (const row of facts as unknown[]) console.log('    ' + JSON.stringify(row));

    for (const admin of ADMINS) {
      await page.context().clearCookies();
      await loginPage.navigate();
      await loginPage.login(admin.username, PASSWORD);
      await dashboardPage.assertDashboardLoaded();

      await page.goto('/Customer/ManageCustomers', { waitUntil: 'domcontentloaded' });
      await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);

      // Search each customer by id rather than reading a page of rows: the grid shows a
      // window of the newest and these two are months old, so absence from page one would
      // mean nothing at all.
      const found: Record<string, boolean> = {};
      for (const [label, customerId] of Object.entries(CUSTOMERS)) {
        const search = page.locator('input[type="search"], input[id*="earch"], input[id*="ilter"]').first();
        if (await search.isVisible().catch(() => false)) {
          await search.fill(customerId);
          await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => undefined);
          await page.waitForTimeout(1_000);
        }
        const row = page.locator('table tbody tr').filter({ hasText: customerId });
        found[label] = await row.first().isVisible().catch(() => false);
      }

      console.log(
        `\n  ${admin.level} (own division ${admin.ownDivision}):` +
        `\n    division-1 customer ${CUSTOMERS.division1}: ${found.division1 ? 'VISIBLE' : 'not visible'}` +
        `\n    division-2 customer ${CUSTOMERS.division2}: ${found.division2 ? 'VISIBLE' : 'not visible'}`
      );
    }

    console.log(
      `\n  Both visible to both admins means visibility keys off the customer type, and the ` +
      `135 pre-change OD customers need nothing.\n` +
      `  Each admin seeing only its own division's customer means visibility still consults ` +
      `the division, and those 135 need their divisions backfilled.`
    );
  });
});
