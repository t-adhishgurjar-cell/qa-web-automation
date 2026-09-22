import { test } from '../src/fixtures/page.fixtures';

/**
 * Where a pin-code-basis-division rule could live in the database.
 *
 * The UI applies none at entry: every pin code tried resolves through
 * /Common/GetLocationByPincode and fills state, city and district without
 * complaint, whatever division the form carries. So if the restriction exists it
 * is either in the pin code data (a pin code that belongs to one division) or in
 * the procedure that saves the application.
 *
 * Read-only throughout — INFORMATION_SCHEMA, sys.sql_modules and SELECTs.
 *
 *   TOOLS=true ENV=qa npx playwright test --project=tools --grep "probe od division data"
 */

test.describe('Tools — probes @tools', () => {
  test('probe od division data', async ({ db }) => {
    test.setTimeout(300_000);

    const show = (title: string, rows: unknown[]) => {
      console.log(`\n--- ${title} (${rows.length}) ---`);
      for (const row of rows.slice(0, 40)) console.log('  ' + JSON.stringify(row));
    };

    show('tables named for pin codes, divisions or locations', await db.query(`
      SELECT TABLE_SCHEMA + '.' + TABLE_NAME AS name
      FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_NAME LIKE '%Pin%' OR TABLE_NAME LIKE '%Division%'
         OR TABLE_NAME LIKE '%Location%' OR TABLE_NAME LIKE '%Master%' AND TABLE_NAME LIKE '%Geo%'
      ORDER BY name`));

    show('columns that tie a pin code to anything', await db.query(`
      SELECT TABLE_NAME AS [table], COLUMN_NAME AS [column]
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE COLUMN_NAME LIKE '%Pin%'
      ORDER BY TABLE_NAME, COLUMN_NAME`));

    // A procedure that mentions both is the restriction, if one exists.
    show('procedures mentioning a pin code and a division together', await db.query(`
      SELECT o.name
      FROM sys.sql_modules m JOIN sys.objects o ON o.object_id = m.object_id
      WHERE m.definition LIKE '%Pincode%' AND m.definition LIKE '%Division%'
      ORDER BY o.name`));

    // The OD-specific divisions the form offered. "OD Default - HR_HP_PB" is not a
    // place, which suggests OD divisions are a parallel set rather than real ones.
    show('divisions whose name mentions OD', await db.query(`
      SELECT TOP 40 * FROM dbo.DivisionMaster WHERE DivisionName LIKE '%OD%' ORDER BY DivisionName`));
  });
});
