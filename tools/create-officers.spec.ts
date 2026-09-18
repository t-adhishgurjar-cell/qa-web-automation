import { test, expect } from '@playwright/test';
import { OfficeApi, OfficerUserType } from '../src/helpers/office-api.helper';
import { DbHelper } from '../src/helpers/db.helper';
import { freshMobile, runTag } from '../src/helpers/test-identity';

/**
 * Creates Region, State and Division administrators for Ahmedabad I and Kolkata.
 *
 * THIS CREATES REAL USERS in whichever environment it is pointed at. It lives
 * in tools/ so a normal run cannot reach it: the project only exists when
 * TOOLS=true.
 *
 *   TOOLS=true ENV=qa npx playwright test --project=tools --grep "create officers"
 *
 * ── "Region admin of Ahmedabad division" needs unpacking ──────────────────
 * Only one of these three is division-scoped. UserLocationMapping fills
 * progressively more columns as the role narrows:
 *
 *   REGION_ADMIN     RegionId only                      (a whole zone)
 *   STATE_ADMIN      RegionId + BusinessStateId         (a business state)
 *   DIVISION_ADMIN   RegionId + BusinessStateId + DivisionId
 *
 * So the region and state administrators below are not "of Ahmedabad" — they
 * are of the zone and the business state that CONTAIN Ahmedabad, which is the
 * nearest thing the hierarchy allows. Same for Kolkata.
 *
 * ── The node names are not guesses ────────────────────────────────────────
 * DIVISION takes DivisionMaster.DMId; State takes StateNodeMapping.ShNodeId
 * (NOT the BusinessStateName — "GJ_I" is the name, "BSTGUJ1" is the node);
 * ZONE takes "<REGION> Zone", matching the helper's measured 'NORTH Zone'.
 *
 * ── Why every creation is checked against the database ────────────────────
 * This API answers HTTP 200 / Success 1 / Message "Success" for requests that
 * create nothing; the real outcome is prose inside data[].Message. So each
 * officer is read back from dbo.Users and dbo.UserLocationMapping, and the
 * scope columns are asserted — a user created against the wrong node is worse
 * than one not created at all, because it looks fine.
 */

interface Target {
  label: string;
  userType: OfficerUserType;
  nodeName: string;
  /** What UserLocationMapping must show if the node was understood. */
  expect: { RegionId: number; BusinessStateId: number | null; DivisionId: number | null };
}

const TARGETS: Target[] = [
  // Ahmedabad I — DivisionId 1, DMId DOAHMEDA1, GJ_I (11), West (4)
  { label: 'Ahmedabad — Region Admin (West zone)', userType: 'REGION_ADMIN', nodeName: 'WEST Zone',
    expect: { RegionId: 4, BusinessStateId: null, DivisionId: null } },
  { label: 'Ahmedabad — State Admin (GJ_I)', userType: 'STATE_ADMIN', nodeName: 'BSTGUJ1',
    expect: { RegionId: 4, BusinessStateId: 11, DivisionId: null } },
  { label: 'Ahmedabad I — Division Admin', userType: 'DIVISION_ADMIN', nodeName: 'DOAHMEDA1',
    expect: { RegionId: 4, BusinessStateId: 11, DivisionId: 1 } },

  // Kolkata — DivisionId 26, DMId DOKOLKAT, WB_NE (3), East (1)
  { label: 'Kolkata — Region Admin (East zone)', userType: 'REGION_ADMIN', nodeName: 'EAST Zone',
    expect: { RegionId: 1, BusinessStateId: null, DivisionId: null } },
  { label: 'Kolkata — State Admin (WB_NE)', userType: 'STATE_ADMIN', nodeName: 'BSTWBNE',
    expect: { RegionId: 1, BusinessStateId: 3, DivisionId: null } },
  { label: 'Kolkata — Division Admin', userType: 'DIVISION_ADMIN', nodeName: 'DOKOLKAT',
    expect: { RegionId: 1, BusinessStateId: 3, DivisionId: 26 } },
];

interface Row {
  Id: number; MobileNumber: string; UserTypeId: number;
  RegionId: number | null; BusinessStateId: number | null; DivisionId: number | null;
}

test.describe('Tools — data building @tools', () => {
  test('create officers', async () => {
    test.setTimeout(10 * 60_000);

    const results: string[] = [];
    const problems: string[] = [];

    for (const target of TARGETS) {
      const mobile = freshMobile();
      const empCode = runTag();

      const outcome = await OfficeApi.createOfficer({
        userType: target.userType,
        // Without this the helper silently substitutes its own default node —
        // NORTH Zone / BSTUPUK / DOAKOLA — and every officer is created
        // successfully against the wrong part of the country. Omitting it once
        // produced six users that looked fine and were scoped to Akola and
        // UP_UK, which is exactly why the scope is asserted below.
        nodeName: target.nodeName,
        mobile,
        empCode,
        empName: `${empCode} ${target.userType}`,
      });

      if (!outcome.created) {
        problems.push(
          `${target.label}: the API did not create it — "${outcome.message}" ` +
            `(HTTP ${outcome.httpStatus}, envelope Success=${outcome.envelopeSaidSuccess})`
        );
        results.push(`✗ ${target.label.padEnd(42)} ${mobile}  ${outcome.message}`);
        continue;
      }

      // Read it back. The API's word is not evidence.
      const rows = await DbHelper.query<Row>(
        `SELECT TOP 1 u.Id, u.MobileNumber, u.UserTypeId,
                m.RegionId, m.BusinessStateId, m.DivisionId
           FROM dbo.Users u
           LEFT JOIN dbo.UserLocationMapping m ON m.UserId = u.Id
          WHERE u.MobileNumber = @mobile
          ORDER BY u.Id DESC`,
        { mobile }
      );

      const row = rows[0];
      if (!row) {
        problems.push(`${target.label}: API said created, but no dbo.Users row exists for ${mobile}.`);
        results.push(`✗ ${target.label.padEnd(42)} ${mobile}  no database row`);
        continue;
      }

      const got = {
        RegionId: row.RegionId, BusinessStateId: row.BusinessStateId, DivisionId: row.DivisionId,
      };
      const scopeOk = JSON.stringify(got) === JSON.stringify(target.expect);
      if (!scopeOk) {
        problems.push(
          `${target.label}: created as Users.Id ${row.Id}, but its scope is ` +
            `${JSON.stringify(got)} rather than ${JSON.stringify(target.expect)}. ` +
            `Sent nodeType/nodeName for "${target.nodeName}". Either the node name ` +
            `is not one this API recognises, or it was not sent — check the ` +
            `request log line above, which prints the node actually used.`
        );
      }

      results.push(
        `${scopeOk ? '✓' : '!'} ${target.label.padEnd(42)} ${mobile}  ` +
          `Users.Id=${row.Id} type=${row.UserTypeId} ` +
          `region=${row.RegionId} state=${row.BusinessStateId} division=${row.DivisionId} ` +
          `empCode=${empCode}`
      );
    }

    console.log(`\n${'='.repeat(100)}\nOfficers created\n${'='.repeat(100)}`);
    for (const line of results) console.log(line);
    console.log('='.repeat(100));

    expect(problems, `\n${problems.join('\n')}\n`).toEqual([]);
  });
});
