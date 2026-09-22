import { test } from '../src/fixtures/page.fixtures';

/**
 * What became of the OD applications these runs raised.
 *
 * Reads them by reference, with the division resolved, so "the submit click did
 * nothing" can be told apart from "it submitted and the confirmation was
 * dismissed before the assertion saw it".
 *
 *   OD_REFS=1000514927 TOOLS=true ENV=qa npx playwright test --project=tools --grep "probe od refs"
 */

test.describe('Tools — probes @tools', () => {
  test('probe od refs', async ({ db }) => {
    const refs = (process.env.OD_REFS ?? '').split(',').map(r => r.trim()).filter(Boolean);

    const rows = await db.query(`
      SELECT TOP 20 r.ReferenceNo, r.Status, r.CustomerDivisionId, d.DivisionName,
             d.IsPlaceholder, r.CustomerStateId, r.BusinessName, r.CreatedOn, r.CreatedBy
      FROM dbo.RawCustomerMaster r
      LEFT JOIN dbo.DivisionMaster d ON d.DivisionId = r.CustomerDivisionId
      ${refs.length ? `WHERE r.ReferenceNo IN (${refs.map(Number).join(',')})` : ''}
      ORDER BY r.CreatedOn DESC`);

    for (const row of rows as unknown[]) console.log('  ' + JSON.stringify(row));
    if (!rows.length) console.log('  (nothing found)');
  });
});
