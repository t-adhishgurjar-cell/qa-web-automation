import { test } from '@playwright/test';
import { request as playwrightRequest } from '@playwright/test';
import { DbHelper } from '../src/helpers/db.helper';
import { freshMobile, runTag } from '../src/helpers/test-identity';

/**
 * Will the Office API make a TSM if asked for a territory node?
 *
 * The helper wires three node types — ZONE, State, DIVISION — and the API derives the
 * user type from them, producing a region, state or division admin. Nothing it exposes
 * produces a TERRITORY_ADMIN. But the payload carries no user type of its own, so the
 * question is really "does the API know a fourth node type", and that can only be
 * answered by asking it.
 *
 * Existing TSMs point at a different pipeline: theirs is Useragent 'Web' where this API
 * writes 'SAP', and they are tied to divisions through dbo.TSMDivisionMapping by a
 * service account, with ids like TSMDIAG24. So a refusal here is the expected answer and
 * the useful one — it says the TSM route is elsewhere rather than leaving it a guess.
 *
 * Each attempt uses a fresh mobile and is read back from the database, because this API
 * answers HTTP 200 / Success 1 for requests that create nothing — and for requests that
 * create the wrong thing.
 *
 *   TOOLS=true ENV=qa npx playwright test --project=tools --grep "probe tsm node type"
 */

const ATTEMPTS = [
  { nodeType: 'TERRITORY', nodeName: 'DOAHMEDA1' },
  { nodeType: 'Territory', nodeName: 'DOAHMEDA1' },
];

test.describe('Tools — probes @tools', () => {
  test('probe tsm node type', async () => {
    test.setTimeout(300_000);

    const url = process.env.OFFICE_API_URL;
    const apiKey = process.env.OFFICE_API_KEY;
    const clientId = process.env.OFFICE_API_CLIENT_ID;
    if (!url || !apiKey || !clientId) {
      console.log('  Office API credentials are not configured in this environment.');
      return;
    }

    const context = await playwrightRequest.newContext();
    try {
      for (const attempt of ATTEMPTS) {
        const tag = runTag();
        const mobile = freshMobile();
        const payload = [{
          nodeType: attempt.nodeType,
          nodeName: attempt.nodeName,
          nyEmpCode: tag,
          nyEmpName: `${tag} TSM probe`,
          nyEmpEmail: `${tag.toLowerCase()}@example.com`,
          nyEmpMobileNo: mobile,
        }];

        const response = await context.post(url, {
          // Header names as the API wants them — API_Key and Client_Id, not the
          // lowercase-hyphenated spelling most APIs use. Getting them wrong returns
          // HTTP 401 "Client_Id and API_Key are mandatory headers", which reads like
          // missing credentials rather than misnamed headers.
          headers: { 'Content-Type': 'application/json', API_Key: apiKey, Client_Id: clientId },
          data: payload,
        });
        const body = await response.text();
        console.log(`\n  nodeType "${attempt.nodeType}" on ${attempt.nodeName} (mobile ${mobile})`);
        console.log(`    http ${response.status()}: ${body.replace(/\s+/g, ' ').slice(0, 400)}`);

        // The response is not the outcome. Ask the database what exists.
        const rows = await DbHelper.query(`
          SELECT u.Id, u.UserName, ut.Code AS UserTypeCode, m.RegionId, m.BusinessStateId, m.DivisionId
          FROM dbo.Users u
          JOIN dbo.UserTypesMaster ut ON ut.Id = u.UserTypeId
          LEFT JOIN dbo.UserLocationMapping m ON m.UserId = u.Id
          WHERE u.UserName = '${mobile}'`);
        console.log(`    in the database: ${rows.length ? JSON.stringify(rows) : 'nothing was created'}`);
      }
    } finally {
      await context.dispose();
    }
  });
});
