import { test } from '../src/fixtures/page.fixtures';

/**
 * How much of the application the suite actually reaches.
 *
 * "Is the regression suite enough" cannot be answered from the suite alone — 232 tests is a
 * number without a denominator. dbo.MenuMaster is the denominator: it is what the product
 * offers, one row per screen, with the controller and action that serve it.
 *
 * This lists every active screen so it can be compared against the routes the repository
 * names. It does not judge depth — a screen a test opens once is counted the same as one
 * walked end to end — so treat the result as a ceiling on coverage, not a measure of it.
 *
 *   TOOLS=true ENV=qa npx playwright test --project=tools --grep "probe coverage surface"
 */

test.describe('Tools — probes @tools', () => {
  test('probe coverage surface', async ({ db }) => {
    const byArea = await db.query(`
      SELECT Controller, COUNT(*) AS screens
      FROM dbo.MenuMaster
      WHERE StatusFlag = 1 AND IsFinalPage = 1 AND Controller <> ''
      GROUP BY Controller ORDER BY screens DESC`);
    console.log('\n--- active screens per controller ---');
    let total = 0;
    for (const row of byArea as { Controller: string; screens: number }[]) {
      console.log(`  ${row.Controller.padEnd(20)} ${row.screens}`);
      total += row.screens;
    }
    console.log(`  ${'TOTAL'.padEnd(20)} ${total}`);

    const routes = await db.query(`
      SELECT Controller + '/' + Action AS route, MenuName
      FROM dbo.MenuMaster
      WHERE StatusFlag = 1 AND IsFinalPage = 1 AND Controller <> ''
      ORDER BY Controller, Action`);
    console.log('\n--- every active screen, as a route ---');
    for (const row of routes as { route: string; MenuName: string }[]) {
      console.log(`  ${row.route.padEnd(46)} ${row.MenuName}`);
    }
  });
});
