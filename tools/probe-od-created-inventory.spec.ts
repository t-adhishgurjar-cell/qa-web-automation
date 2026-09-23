import { test } from '../src/fixtures/page.fixtures';

/**
 * Everything this suite created while testing the OD change, with its identifiers.
 *
 * Asked for as "the OD credentials" — and the honest answer is that there are none
 * yet. These runs created OD *applications*, not users: a customer's login is its
 * mobile number, and it only becomes one once the application is approved and the
 * customer admin user is created. Every application below is at 107, Consent Pending,
 * so nothing here can be signed in with today.
 *
 * What the listing gives is the mobile on each application — which is the login it
 * would get — plus the state, dummy division and status, so any of them can be pushed
 * through consent and approval when a real OD login is needed.
 *
 *   TOOLS=true ENV=qa npx playwright test --project=tools --grep "probe od created inventory"
 */

test.describe('Tools — probes @tools', () => {
  test('probe od created inventory', async ({ db }) => {
    const columns = await db.query<{ c: string }>(`
      SELECT COLUMN_NAME AS c FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_NAME = 'RawCustomerMaster'
        AND (COLUMN_NAME LIKE '%Mobile%' OR COLUMN_NAME LIKE '%Name%' OR COLUMN_NAME LIKE '%PAN%')
      ORDER BY ORDINAL_POSITION`);
    console.log(`\n  identifying columns available: ${columns.map(r => r.c).join(', ')}`);

    const rows = await db.query(`
      SELECT r.ReferenceNo, r.Status, r.CustomerName, r.MobileNo,
             r.PANNumber, r.CustomerStateId, s.BusinessStateName,
             r.CustomerDivisionId, d.DivisionName, d.IsPlaceholder,
             u.UserName AS raisedBy, r.CreatedOn
      FROM dbo.RawCustomerMaster r
      JOIN dbo.CustomerTypeMaster t ON t.Id = r.CustomerType
      LEFT JOIN dbo.BusinessStateMaster s ON s.BusinessStateId = r.CustomerStateId
      LEFT JOIN dbo.DivisionMaster d ON d.DivisionId = r.CustomerDivisionId
      LEFT JOIN dbo.Users u ON u.Id = r.CreatedBy
      WHERE t.CustomerTypeCode = 1004 AND r.CreatedOn >= '2026-09-22 17:00'
      ORDER BY r.CreatedOn`);
    console.log(`\n--- OD applications raised during this testing (${rows.length}) ---`);
    for (const row of rows as unknown[]) console.log('  ' + JSON.stringify(row));

    // Is any of them actually a customer yet, with a user that could sign in?
    const users = await db.query(`
      SELECT c.CustomerID, c.Status AS customerStatus, c.MobileNo, u.UserName,
             ut.Code AS UserTypeCode, u.IsActive
      FROM dbo.CustomerMaster c
      JOIN dbo.CustomerTypeMaster t ON t.Id = c.CustomerType
      LEFT JOIN dbo.Users u ON u.MobileNumber = c.MobileNo
      LEFT JOIN dbo.UserTypesMaster ut ON ut.Id = u.UserTypeId
      WHERE t.CustomerTypeCode = 1004 AND c.CreatedOn >= '2026-09-22 17:00'`);
    console.log(`\n--- of those, any that became a customer with a login (${users.length}) ---`);
    for (const row of users as unknown[]) console.log('  ' + JSON.stringify(row));
    if (!users.length) console.log('  (none — every application is still at 107, Consent Pending)');

    // The one OD customer that does exist and is Active, raised by someone else.
    const existing = await db.query(`
      SELECT TOP 5 c.CustomerID, c.Status, c.MobileNo, c.CustomerDivisionId,
             d.DivisionName, c.CreatedOn
      FROM dbo.CustomerMaster c
      JOIN dbo.CustomerTypeMaster t ON t.Id = c.CustomerType
      LEFT JOIN dbo.DivisionMaster d ON d.DivisionId = c.CustomerDivisionId
      WHERE t.CustomerTypeCode = 1004 AND d.IsPlaceholder = 1
      ORDER BY c.CreatedOn DESC`);
    console.log(`\n--- OD customers already live on a dummy division, not created by me (${existing.length}) ---`);
    for (const row of existing as unknown[]) console.log('  ' + JSON.stringify(row));
  });
});
