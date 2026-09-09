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
 * A mobile number no previous run has used, and no concurrent call either.
 *
 * The app refuses an already-registered number, so a fixed one works exactly
 * once. Leading 9 keeps it a plausible Indian mobile; the rest is the clock.
 *
 * The counter matters more than it looks. Derived from the clock alone, two
 * calls inside the same millisecond return the *same* number — which the RO
 * onboarding API, needing an RO mobile and a TSM mobile in one payload, refused
 * with "RO Admin mobile cannot be the same as TSM mobile on the same RO." That
 * read as a rule about the API and was really two identical timestamps.
 */
let counter = 0;

export function freshMobile(): string {
  const tick = counter++ % 100;
  return `9${String(Date.now()).slice(-7)}${String(tick).padStart(2, '0')}`;
}
