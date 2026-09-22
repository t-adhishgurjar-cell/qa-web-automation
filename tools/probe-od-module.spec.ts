import { test } from '../src/fixtures/page.fixtures';

/**
 * Is there an "OD module" separate from the customer onboarding wizard?
 *
 * The feedback was given as "the other feedbacks for the OD module", and OD is
 * also a customer type on Add Customer (CustomerTypeCode 1004). Those are not
 * necessarily the same screen, and testing the wrong one would prove nothing —
 * so this asks the menu tables what OD screens exist before any test assumes.
 *
 * Read-only.
 *
 *   TOOLS=true ENV=qa npx playwright test --project=tools --grep "probe od module"
 */

test.describe('Tools — probes @tools', () => {
  test('probe od module', async ({ db }) => {
    test.setTimeout(300_000);

    const show = (title: string, rows: unknown[]) => {
      console.log(`\n--- ${title} (${rows.length}) ---`);
      for (const row of rows.slice(0, 40)) console.log('  ' + JSON.stringify(row));
      if (!rows.length) console.log('  (none)');
    };

    show('menu tables', await db.query(`
      SELECT TABLE_NAME AS name FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_NAME LIKE '%Menu%' ORDER BY name`));

    show('menu entries mentioning OD', await db.query(`
      SELECT TOP 40 * FROM dbo.MenuMaster
      WHERE MenuName LIKE '%OD%' OR MenuName LIKE '%outlet%' OR MenuName LIKE '%dealer%'
      ORDER BY MenuName`));

    show('customer types, for the record', await db.query(`
      SELECT Id, CustomerTypeCode, CustomerTypeName FROM dbo.CustomerTypeMaster ORDER BY CustomerTypeCode`));
  });
});
