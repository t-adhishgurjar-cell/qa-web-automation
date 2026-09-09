import { request as playwrightRequest } from '@playwright/test';
import { Logger } from './logger.helper';

/**
 * The RO onboarding API — retail outlets, and the TSMs attached to them.
 *
 * One call creates two users on two different mobiles: an RO admin from
 * `mobile`, and a TERRITORY_ADMIN from `tsm_mobile`. That is why RO and
 * TERRITORY_ADMIN share a route in the matrix and why a single request can be
 * accepted for one of them and refused for the other.
 *
 * ── The TSM code identifies a person, and reusing it moves them ────────────
 * TSMs are keyed on `tsm`, not on the mobile. Calling with an existing tsm code
 * and a different tsm_mobile does not create anyone and does not complain — it
 * overwrites that officer's UserName and MobileNumber in place. Measured twice
 * on TSMDIAG16 (user 230199): CreatedOn never moved, ModifiedOn did, and the
 * previous mobile was left with no user at all. The response still says
 * "action":"Created".
 *
 * The consequence outside testing: onboarding an outlet under an existing TSM
 * code with a stale mobile in the payload silently relocates that TSM's login.
 * Their old number stops working and nothing records why.
 *
 * The consequence inside testing: every call must mint a unique tsm code, or
 * the suite mutates real officers while reporting success. uniqueCodes() exists
 * for that and is the default.
 *
 * ── Reading the outcome ───────────────────────────────────────────────────
 * Better than the Office API, but still not the envelope: a refusal comes back
 * HTTP 200 with status 1 and message "Success", and the truth is in
 * data[].action — "Created" or "Error" — with the reason in data[].remarks.
 * Validation failures are the exception and do return a real HTTP 400.
 */

export interface RoOnboardingRequest {
  /** Becomes the RO admin's login. */
  roMobile: string;
  /** Becomes the TERRITORY_ADMIN's login. */
  tsmMobile: string;
  /** Defaults to a unique code. Reusing one MOVES an existing outlet. */
  custCode?: string;
  /** Defaults to a unique code. Reusing one MOVES an existing officer. */
  tsmCode?: string;
  /** Alphabetic only — the API rejects digits with HTTP 400. */
  tsmName?: string;
  custName?: string;
}

export interface RoOnboardingOutcome {
  /** True only when the record's action is "Created". */
  created: boolean;
  /** True when the action was neither Created nor Error. */
  unknown: boolean;
  action: string;
  /** The reason, when refused. */
  remarks: string;
  httpStatus: number;
  envelopeSaidSuccess: boolean;
  referenceNo: string;
  custCode: string;
  tsmCode: string;
  raw: string;
}

/**
 * Reference data the payload must carry.
 *
 * Real values from a working QA example. They are structural — a division that
 * exists, a state node that exists — and not what any test is varying, so they
 * are fixed here rather than parameterised into every call.
 */
const REFERENCE = {
  area: 'Kolkata',
  city: 'Kolkata',
  zipCode: '201301',
  latitude: '28.531525816625',
  longitude: '77.361609495882',
  state: 'WEST BENGAL',
  divisionCode: 'DM1205',
  dm: 'DOGUWAHA',
  zone: 'EAST',
  hRetail: 'HRS2000',
  cro: 'CRS2000',
  cmo: 'CMO2000',
  sh: 'BSTWBNE',
} as const;

/**
 * Distinct codes for one call. Never reuse: reusing mutates a real record.
 *
 * Both fields are capped at ten characters — "500NA" plus eight digits is
 * thirteen and the API rejects it with a 400, which is the API behaving
 * correctly and the first version of this function behaving badly. Base 36
 * keeps the timestamp inside eight characters, and the counter separates calls
 * that land in the same millisecond, which happens when tests run in parallel.
 */
let sequence = 0;

export function uniqueCodes(): { custCode: string; tsmCode: string } {
  const stamp = Date.now().toString(36).slice(-6);
  // Two base-36 characters, so 1296 calls inside one millisecond before the
  // counter repeats rather than 36. Ten characters exactly.
  const seq = (sequence++ % 1296).toString(36).padStart(2, '0');
  return { custCode: `AC${stamp}${seq}`, tsmCode: `AT${stamp}${seq}` };
}

export class RoOnboardingApi {
  private static readonly logger = new Logger('RoOnboardingApi');

  private static config(): { url: string; apiKey: string; clientId: string } {
    const url = process.env.RO_API_URL;
    const apiKey = process.env.RO_API_KEY;
    const clientId = process.env.RO_API_CLIENT_ID;
    if (!url || !apiKey || !clientId) {
      throw new Error(
        'The RO onboarding API needs RO_API_URL, RO_API_KEY and ' +
          'RO_API_CLIENT_ID, which live in the gitignored .env.<env> file.'
      );
    }
    return { url, apiKey, clientId };
  }

  static async onboard(req: RoOnboardingRequest): Promise<RoOnboardingOutcome> {
    const { url, apiKey, clientId } = this.config();
    const codes = uniqueCodes();
    const custCode = req.custCode ?? codes.custCode;
    const tsmCode = req.tsmCode ?? codes.tsmCode;

    const payload = [{
      cust_code: custCode,
      cust_name: req.custName ?? 'Auto Ro Pump',
      area: REFERENCE.area,
      city: REFERENCE.city,
      zip_code: REFERENCE.zipCode,
      mobile: req.roMobile,
      mobile1: req.roMobile,
      email: `auto.${custCode.toLowerCase()}@example.com`,
      latitude: REFERENCE.latitude,
      longitude: REFERENCE.longitude,
      status: '',
      state: REFERENCE.state,
      division_code: REFERENCE.divisionCode,
      tsm: tsmCode,
      dm: REFERENCE.dm,
      // Alphabetic only. A tag with digits returns HTTP 400
      // "Only alphabetic values allowed".
      tsm_name: req.tsmName ?? 'Autotsm',
      tsm_mobile: req.tsmMobile,
      tsm_email: `auto.tsm.${custCode.toLowerCase()}@example.com`,
      zone: REFERENCE.zone,
      HRetail: REFERENCE.hRetail,
      CRO: REFERENCE.cro,
      CMO: REFERENCE.cmo,
      sh: REFERENCE.sh,
    }];

    this.logger.info(
      `RO ${custCode} on ${req.roMobile}, TSM ${tsmCode} on ${req.tsmMobile}`
    );

    const context = await playwrightRequest.newContext();
    try {
      const response = await context.post(url, {
        headers: { 'Content-Type': 'application/json', API_Key: apiKey, Client_Id: clientId },
        data: payload,
        timeout: 60_000,
      });

      const raw = await response.text();
      let body: {
        status?: number; message?: string;
        data?: { fpReferenceNo?: string; custCode?: string; action?: string; remarks?: string }[];
        errors?: Record<string, string[]>; title?: string;
      };
      try {
        body = JSON.parse(raw);
      } catch {
        throw new Error(
          `The RO API returned something that is not JSON ` +
            `(HTTP ${response.status()}): ${raw.slice(0, 300)}`
        );
      }

      // Model validation is the one path that fails honestly, with a 400 and a
      // field-keyed errors object rather than a success envelope.
      if (body.errors) {
        const fields = Object.entries(body.errors)
          .map(([field, messages]) => `${field}: ${messages.join('; ')}`)
          .join(' | ');
        return {
          created: false, unknown: false, action: 'ValidationError', remarks: fields,
          httpStatus: response.status(), envelopeSaidSuccess: false,
          referenceNo: '', custCode, tsmCode, raw,
        };
      }

      const record = body.data?.[0] ?? {};
      const action = (record.action ?? '').trim();
      const created = /^created$/i.test(action);
      const errored = /^error$/i.test(action);

      const outcome: RoOnboardingOutcome = {
        created,
        unknown: !created && !errored,
        action,
        remarks: (record.remarks ?? '').trim(),
        httpStatus: response.status(),
        envelopeSaidSuccess: body.status === 1,
        referenceNo: record.fpReferenceNo ?? '',
        custCode: record.custCode ?? custCode,
        tsmCode,
        raw,
      };

      this.logger.info(
        `-> action=${outcome.action || '(none)'} remarks="${outcome.remarks}" ` +
          `(HTTP ${outcome.httpStatus}, status=${body.status})`
      );
      return outcome;
    } finally {
      await context.dispose();
    }
  }
}
