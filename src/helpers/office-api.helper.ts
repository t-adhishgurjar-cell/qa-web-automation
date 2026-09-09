import { request as playwrightRequest } from '@playwright/test';
import { Logger } from './logger.helper';
import { runTag } from './test-identity';

/**
 * The Office API — how Nayara officers are created.
 *
 * State, Zone and Division administrators never come through Add User. SAP
 * pushes them into FleetPlus through insert_nayara_user, which is why 27 cells
 * of the matrix sat untestable until this existed.
 *
 * ── Do not trust the envelope ─────────────────────────────────────────────
 * A refused request looks exactly like a successful one from the outside:
 *
 *   HTTP 200
 *   {"Success":1,"Message":"Success","FPReferenceNo":"...",
 *    "data":[{"nyEmpCode":"...","Message":"No action: mobile number already
 *             registered to another user"}]}
 *
 * Status 200, Success 1, Message "Success" — for a request that created
 * nothing. The real outcome is prose in data[].Message. Anything reading the
 * status code or the Success flag concludes the officer exists. This client
 * therefore decides from the per-record message and never from the envelope,
 * and treats an unrecognised message as "unknown" rather than guessing.
 *
 * ── Its rule is not usp_AddUser's ─────────────────────────────────────────
 * Measured, not assumed. It exempts OD and blocks every other user type,
 * including the whole Customer category that usp_AddUser's blocking list omits
 * — 83% of all users. On 6000000126, whose only user is a CUSTOMER_PARENT_USER,
 * this API refused and Add User created an FP_ADMIN in the same run.
 *
 * Measured against the workbook it is the correct one of the two: all 27 matrix
 * cells match the specification. Add Customer, which ignores users entirely, is
 * looser than either. Three flows, three rules, and this is the only one that
 * matches what was written down.
 */

/** What the API calls each node level, and the user type it produces. */
export const OFFICER_NODE_TYPES = {
  STATE_ADMIN: { nodeType: 'State', defaultNode: 'BSTUPUK' },
  REGION_ADMIN: { nodeType: 'ZONE', defaultNode: 'NORTH Zone' },
  DIVISION_ADMIN: { nodeType: 'DIVISION', defaultNode: 'DOAKOLA' },
} as const;

export type OfficerUserType = keyof typeof OFFICER_NODE_TYPES;

export interface OfficerRequest {
  userType: OfficerUserType;
  mobile: string;
  /** Defaults to a run-tagged code so QA can find what automation created. */
  empCode?: string;
  empName?: string;
  empEmail?: string;
  /** Overrides the node this officer is attached to. */
  nodeName?: string;
}

export interface OfficerOutcome {
  /**
   * Whether a user was created — as the API reports it. The database is still
   * the arbiter; this is what the caller was *told*.
   */
  created: boolean;
  /** True when the message matched neither success nor refusal. */
  unknown: boolean;
  /** The per-record message, which is where the truth lives. */
  message: string;
  /** The envelope's claim, kept so tests can show the two disagreeing. */
  envelopeSaidSuccess: boolean;
  httpStatus: number;
  referenceNo: string;
  empCode: string;
  raw: string;
}

const CREATED = /request processed successfully/i;
const REFUSED = /no action|already registered|not\s+(created|processed)|invalid|fail/i;

export class OfficeApi {
  private static readonly logger = new Logger('OfficeApi');

  private static config(): { url: string; apiKey: string; clientId: string } {
    const url = process.env.OFFICE_API_URL;
    const apiKey = process.env.OFFICE_API_KEY;
    const clientId = process.env.OFFICE_API_CLIENT_ID;
    if (!url || !apiKey || !clientId) {
      throw new Error(
        'The Office API needs OFFICE_API_URL, OFFICE_API_KEY and ' +
          'OFFICE_API_CLIENT_ID. They are secrets, so they live in the ' +
          'gitignored .env.<env> file rather than in the repository.'
      );
    }
    return { url, apiKey, clientId };
  }

  /**
   * Creates one officer and reports what the API said.
   *
   * Deliberately does not throw on a refusal: a refusal is a result the matrix
   * needs to record, not an error. It throws only when the call itself failed
   * or the response could not be read.
   */
  static async createOfficer(req: OfficerRequest): Promise<OfficerOutcome> {
    const { url, apiKey, clientId } = this.config();
    const node = OFFICER_NODE_TYPES[req.userType];
    const tag = req.empCode ?? runTag();

    const payload = [{
      nodeType: node.nodeType,
      nodeName: req.nodeName ?? node.defaultNode,
      nyEmpCode: tag,
      nyEmpName: req.empName ?? `${tag} ${req.userType}`,
      nyEmpEmail: req.empEmail ?? `${tag.toLowerCase()}@example.com`,
      nyEmpMobileNo: req.mobile,
    }];

    this.logger.info(
      `${req.userType} (${node.nodeType}/${payload[0].nodeName}) on ${req.mobile} as ${tag}`
    );

    const context = await playwrightRequest.newContext();
    try {
      const response = await context.post(url, {
        headers: {
          'Content-Type': 'application/json',
          API_Key: apiKey,
          Client_Id: clientId,
        },
        data: payload,
        timeout: 60_000,
      });

      const raw = await response.text();
      let body: {
        Success?: number; Message?: string; FPReferenceNo?: string;
        data?: { nyEmpCode?: string; Message?: string }[];
      };
      try {
        body = JSON.parse(raw);
      } catch {
        throw new Error(
          `The Office API returned something that is not JSON ` +
            `(HTTP ${response.status()}): ${raw.slice(0, 300)}`
        );
      }

      const record = body.data?.[0] ?? {};
      const message = (record.Message ?? body.Message ?? '').trim();
      const created = CREATED.test(message);
      const refused = REFUSED.test(message);

      const outcome: OfficerOutcome = {
        created,
        // Neither pattern matched. Saying so beats defaulting to one of them —
        // reading an unrecognised message as success is how a suite reports a
        // user that was never created.
        unknown: !created && !refused,
        message,
        envelopeSaidSuccess: body.Success === 1,
        httpStatus: response.status(),
        referenceNo: body.FPReferenceNo ?? '',
        empCode: record.nyEmpCode ?? tag,
        raw,
      };

      this.logger.info(
        `-> ${outcome.created ? 'CREATED' : outcome.unknown ? 'UNRECOGNISED' : 'REFUSED'}: ` +
          `"${outcome.message}" (HTTP ${outcome.httpStatus}, Success=${body.Success})`
      );
      return outcome;
    } finally {
      await context.dispose();
    }
  }
}
