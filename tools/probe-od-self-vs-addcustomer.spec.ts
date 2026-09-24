import { test } from '../src/fixtures/page.fixtures';

/**
 * Is the division removal applied to self-onboarded OD as well as Add Customer OD?
 *
 * The requirement covers both paths: an OD customer should carry no real division, so that
 * every division admin in its state can see it while region and state still restrict.
 *
 * Add Customer does that — it stores the "OD Default - <state>" dummy. But reference
 * 1000514974 was raised at 12:32 on 23 September by 7000000187, a user whose type is OD and
 * whose role is Personal with no location mapping at all — a customer enrolling itself — and
 * it carries CustomerDivisionId 34, Noida, a real division. Two minutes later an Add Customer
 * OD in the same business state took dummy 57.
 *
 * Same state, minutes apart, two different answers. This separates the paths by their maker
 * and reports what each one stored, so the comparison rests on more than those two records.
 *
 *   TOOLS=true ENV=qa npx playwright test --project=tools --grep "probe od self vs addcustomer"
 */

test.describe('Tools — probes @tools', () => {
  test('probe od self vs addcustomer', async ({ db }) => {
    const show = (title: string, rows: unknown[]) => {
      console.log(`\n--- ${title} (${rows.length}) ---`);
      for (const row of rows.slice(0, 20)) console.log('  ' + JSON.stringify(row));
      if (!rows.length) console.log('  (none)');
    };

    // Who raised it decides which path it came through: a maker whose own user type is OD,
    // with no location mapping, is the customer itself.
    show('OD applications since the dummy assignment went live, split by who raised them', await db.query(`
      SELECT r.ReferenceNo, r.Status, r.CustomerStateId,
             r.CustomerDivisionId, d.DivisionName, d.IsPlaceholder,
             mk.UserName AS maker, mt.Code AS makerType,
             CASE WHEN mt.Code = 'OD' THEN 'self-onboarded' ELSE 'via Add Customer' END AS path,
             r.CreatedOn
      FROM dbo.RawCustomerMaster r
      JOIN dbo.CustomerTypeMaster t ON t.Id = r.CustomerType
      LEFT JOIN dbo.DivisionMaster d ON d.DivisionId = r.CustomerDivisionId
      LEFT JOIN dbo.Users mk ON mk.Id = r.CreatedBy
      LEFT JOIN dbo.UserTypesMaster mt ON mt.Id = mk.UserTypeId
      WHERE t.CustomerTypeCode = 1004 AND r.CreatedOn >= '2026-09-23 11:08'
      ORDER BY r.CreatedOn`));

    show('the same split, counted — does either path ever store a real division?', await db.query(`
      SELECT CASE WHEN mt.Code = 'OD' THEN 'self-onboarded' ELSE 'via Add Customer' END AS path,
             CASE WHEN d.IsPlaceholder = 1 THEN 'dummy division'
                  WHEN r.CustomerDivisionId = 0 THEN 'no division'
                  ELSE 'REAL division' END AS storedAs,
             COUNT(*) AS applications
      FROM dbo.RawCustomerMaster r
      JOIN dbo.CustomerTypeMaster t ON t.Id = r.CustomerType
      LEFT JOIN dbo.DivisionMaster d ON d.DivisionId = r.CustomerDivisionId
      LEFT JOIN dbo.Users mk ON mk.Id = r.CreatedBy
      LEFT JOIN dbo.UserTypesMaster mt ON mt.Id = mk.UserTypeId
      WHERE t.CustomerTypeCode = 1004 AND r.CreatedOn >= '2026-09-23 11:08'
      GROUP BY CASE WHEN mt.Code = 'OD' THEN 'self-onboarded' ELSE 'via Add Customer' END,
               CASE WHEN d.IsPlaceholder = 1 THEN 'dummy division'
                    WHEN r.CustomerDivisionId = 0 THEN 'no division'
                    ELSE 'REAL division' END
      ORDER BY path, storedAs`));

    // Approved OD customers, which is what the visibility screens actually read.
    show('approved OD customers since the change, and the division each carries', await db.query(`
      SELECT c.CustomerID, c.Status, c.CustomerStateId, c.CustomerDivisionId,
             d.DivisionName, d.IsPlaceholder, c.MobileNo, c.CreatedOn
      FROM dbo.CustomerMaster c
      JOIN dbo.CustomerTypeMaster t ON t.Id = c.CustomerType
      LEFT JOIN dbo.DivisionMaster d ON d.DivisionId = c.CustomerDivisionId
      WHERE t.CustomerTypeCode = 1004 AND c.CreatedOn >= '2026-09-22'
      ORDER BY c.CreatedOn`));
  });
});
