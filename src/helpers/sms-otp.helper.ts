import { DbHelper } from './db.helper';

/**
 * OTPs read from dbo.UserSMSLog, for numbers the QA whitelist does not cover.
 *
 * Every flow in this framework passed TEST_OTP, '123456', and that worked because every
 * account it was pointed at was whitelisted — for those, FleetPlus issues a fixed OTP.
 * A number outside the whitelist gets a real random one, and the fixed value then fails
 * in the least helpful way available: the OTP box accepts it, Verify reports nothing,
 * and the form refuses at submit with "Please verify the customer mobile number via OTP
 * before submitting" while the box on screen is visibly filled in.
 *
 * Measured on 9999301778: the enrolment OTP logged was 697660.
 *
 * ── Why the baseline is an Id and not a timestamp ─────────────────────────────
 * The OTP has to be told apart from every earlier OTP of the same kind on the same
 * number, and comparing CreatedOn against a locally-taken `new Date()` compares two
 * clocks. So the resolver records the highest UserSMSLog Id for the mobile at the
 * moment it is created — before the send — and then waits for a higher one. That is why
 * createOtpReader is async and must be awaited *before* the action that sends the OTP.
 */

/** Which message to read, by what the application writes into it. */
export const OTP_PATTERNS = {
  MobileVerification: '%OTP to verify your mobile number%',
  Consent: '%for Consent%',
  Login: '%OTP to log in%',
  DeviceBinding: '%for Device Binding%',
  PasswordReset: '%for PasswordReset%',
  UserUnlock: '%for User Unlock%',
  /** Any OTP at all — for sends whose wording has not been measured; the Id baseline keeps it fresh. */
  Any: '%OTP%',
} as const;

export type OtpKind = keyof typeof OTP_PATTERNS;

/** A string, or something that fetches one when the flow needs it. */
export type OtpSource = string | (() => Promise<string>);

export async function resolveOtp(source: OtpSource): Promise<string> {
  return typeof source === 'string' ? source : source();
}

async function highestSmsId(mobile: string): Promise<number> {
  const rows = await DbHelper.query<{ MaxId: number | null }>(
    `SELECT MAX(Id) AS MaxId FROM dbo.UserSMSLog WHERE MobileNo = @mobile`,
    { mobile }
  );
  return rows[0]?.MaxId ?? 0;
}

/**
 * Prepares a reader for the next OTP of `kind` sent to `mobile`.
 *
 * Await this BEFORE triggering the send, then pass the returned function where an OTP
 * is wanted. It polls, because the SMS row is written by the same request that answers
 * the browser and need not be committed by the time the OTP box appears.
 */
export async function createOtpReader(
  mobile: string,
  kind: OtpKind,
  timeout = 30_000
): Promise<() => Promise<string>> {
  return readerFrom(mobile, kind, await highestSmsId(mobile), timeout);
}

/**
 * A reader for the most recent OTP of `kind`, however old.
 *
 * For OTPs the application issues earlier than the step that consumes them — the consent
 * code is sent when the application is submitted, not when the consent page is opened —
 * so a baseline taken at the consent step would exclude the only message there is.
 * Weaker than createOtpReader, because a stale code cannot be told from a fresh one; use
 * it only where the send genuinely precedes the read.
 */
export function readLatestOtp(
  mobile: string,
  kind: OtpKind,
  timeout = 30_000
): () => Promise<string> {
  return readerFrom(mobile, kind, 0, timeout);
}

function readerFrom(
  mobile: string,
  kind: OtpKind,
  baseline: number,
  timeout: number
): () => Promise<string> {
  return async () => {
    const deadline = Date.now() + timeout;
    let seen = '';

    while (Date.now() < deadline) {
      const rows = await DbHelper.query<{ Id: number; SMSText: string }>(
        `SELECT TOP 1 Id, SMSText FROM dbo.UserSMSLog
          WHERE MobileNo = @mobile AND Id > @baseline AND SMSText LIKE @pattern
          ORDER BY Id DESC`,
        { mobile, baseline, pattern: OTP_PATTERNS[kind] }
      );

      const text = rows[0]?.SMSText ?? '';
      if (text) {
        seen = text;
        // Four to eight digits, so "valid for 5 minutes" cannot be mistaken for a code.
        const code = text.match(/\b(\d{4,8})\b/)?.[1];
        if (code) return code;
      }
      await new Promise(resolve => setTimeout(resolve, 1_000));
    }

    throw new Error(
      `No ${kind} OTP was logged for ${mobile} within ${timeout}ms (looking for a ` +
        `UserSMSLog row after Id ${baseline} matching "${OTP_PATTERNS[kind]}").` +
        (seen ? ` The closest match held no code: "${seen.slice(0, 120)}"` : '') +
        `\n\nIf the number is whitelisted the OTP is the fixed one and no row is needed; ` +
        `if it is not, a missing row means the application never sent the OTP.`
    );
  };
}
