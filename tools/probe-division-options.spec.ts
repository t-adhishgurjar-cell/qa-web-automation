import { test } from '../src/fixtures/page.fixtures';
import { DSA } from '../src/config/accounts';

/**
 * What the state and division lists actually offer.
 *
 * Asking for "Gurgaon" produced Hyderabad, because selectDropdown falls back to
 * the first option when a label does not match and says nothing about it. So
 * the label is wrong, or the division list is filtered by state and Haryana was
 * not selected either. Read both lists rather than guess a third time.
 *
 *   TOOLS=true ENV=qa npx playwright test --project=tools --grep "division options"
 */

test.use({ storageState: { cookies: [], origins: [] } });

test.describe('Tools — probes @tools', () => {
  test('probe division options', async ({ loginPage, dashboardPage, page }) => {
    test.setTimeout(8 * 60_000);

    await loginPage.navigate();
    await loginPage.login(DSA.username, DSA.password);
    await dashboardPage.assertDashboardLoaded();

    await page.goto('/Customer/AddCustomer', { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page.waitForTimeout(3_500);

    const dump = async (id: string) =>
      page.evaluate((selectId: string) => {
        const sel = document.getElementById(selectId) as HTMLSelectElement | null;
        if (!sel) return { missing: true, options: [] as { value: string; text: string }[] };
        return {
          missing: false,
          options: Array.from(sel.options).map(o => ({ value: o.value, text: o.text.trim() })),
        };
      }, id);

    const states = await dump('CustStateID');
    console.log(`\nCustStateID: ${states.options.length} option(s)`);
    for (const o of states.options.slice(0, 40)) console.log(`  ${o.value.padEnd(6)} ${o.text}`);

    // Divisions may be filtered by the chosen state, so read them before and
    // after picking one.
    const before = await dump('CustDivisionID');
    console.log(`\nCustDivisionID before choosing a state: ${before.options.length} option(s)`);
    for (const o of before.options.slice(0, 40)) console.log(`  ${o.value.padEnd(6)} ${o.text}`);

    const haryana = states.options.find(o => /haryana/i.test(o.text));
    console.log(`\nHaryana in the state list: ${haryana ? `yes (value ${haryana.value})` : 'NO'}`);

    if (haryana) {
      await page.selectOption('#CustStateID', haryana.value);
      await page.waitForTimeout(3_000);
      const after = await dump('CustDivisionID');
      console.log(`\nCustDivisionID after selecting ${haryana.text}: ${after.options.length} option(s)`);
      for (const o of after.options.slice(0, 40)) console.log(`  ${o.value.padEnd(6)} ${o.text}`);
    }
  });
});
