/**
 * Names and numbers for records the suites create in a live environment.
 *
 * These ran as private copies in three specs. That was harmless while they
 * agreed and quietly dangerous when they did not: the cleanup story depends on
 * every created record carrying the same recognisable prefix, and a spec with
 * its own slightly different tag would leave records nobody thinks to look for.
 */

/** The prefix every record this framework creates is marked with. */
export const AUTOMATION_PREFIX = 'AUTO';

/**
 * A label for one run's records, so QA can find and remove them.
 *
 * The last 8 digits of the epoch are enough to be unique within a run and short
 * enough to survive the app's field length limits.
 */
export function runTag(): string {
  return `${AUTOMATION_PREFIX}${String(Date.now()).slice(-8)}`;
}

/**
 * A mobile number no previous run has used, and no concurrent caller either.
 *
 * The app refuses an already-registered number, so a fixed one works exactly
 * once. Leading 9 keeps it a plausible Indian mobile; the rest is the clock,
 * the worker, and a counter.
 *
 * Both extra parts are there because both have already bitten:
 *
 *   the counter — two calls in the same millisecond returned the same number,
 *   which the RO onboarding API refused with "RO Admin mobile cannot be the
 *   same as TSM mobile on the same RO." That read as a rule about the API and
 *   was two identical timestamps.
 *
 *   the worker — each Playwright worker is its own process, so the counter
 *   restarts at zero in every one of them. Running the API matrix eight-wide,
 *   separate workers minted the same number and the second was refused with
 *   "already registered with another user type". A per-process counter is not
 *   unique across processes, however carefully it is incremented.
 */
let counter = 0;

function workerSlot(): number {
  // Playwright sets this per worker process; 0 when running outside a test.
  return Number(process.env.TEST_WORKER_INDEX ?? 0) % 10;
}

export function freshMobile(): string {
  const tick = counter++ % 100;
  return `9${workerSlot()}${String(Date.now()).slice(-6)}${String(tick).padStart(2, '0')}`;
}
