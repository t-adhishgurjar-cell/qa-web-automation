import { test } from '@playwright/test';

/**
 * Conventions shared by every tests/regression-v3 spec.
 *
 * A test answers for sheet cases by naming them at the start of its title:
 *
 *   test(caseTitle(['W-0001', 'F-120'], 'an unknown Customer ID is refused'), ...)
 *   -> "[W-0001][F-120] an unknown Customer ID is refused"
 *
 * scripts/compile-regression-v3.ts reads the IDs back out of the Allure results, so a test
 * is the single source of a case's verdict: one execution can answer a Web case and the
 * Financial case that duplicates it, and the report cannot disagree with the run.
 *
 * A case that cannot be executed is still emitted, as a skipped test carrying its reason,
 * so the Allure report lists every ID and says why each unexecuted one was not run.
 */

export const CASE_ID = /\b[WF]-\d{3,4}\b/g;

export function caseTitle(ids: string[], scenario: string): string {
  return `${ids.map(id => `[${id}]`).join('')} ${scenario}`;
}

/** The ids a result title answers for. */
export function idsIn(title: string): string[] {
  return [...new Set(title.match(CASE_ID) ?? [])];
}

/** Emits a skipped entry for cases that cannot be executed, with the reason recorded. */
export function notExecutable(ids: string[], scenario: string, reason: string): void {
  test(caseTitle(ids, scenario), async () => {
    test.info().annotations.push({ type: 'not-executable', description: reason });
    test.skip(true, `NOT RUN: ${reason}`);
  });
}

/** Reasons shared across lanes, so the report groups them. */
export const REASON = {
  POS: 'Needs a fuel dispense at a POS terminal (Merchant/POS app); not reachable from the web application.',
  MOBILE_APP: 'Mobile application case (Customer App / Merchant App); this framework drives the web application only.',
  REWARD_RUN: 'Needs the monthly reward-calculation run over a seeded period of transactions; no trigger is exposed to the web application.',
  EMAIL: 'Verifies an e-mail or notification delivery; no mailbox is wired to the suite.',
  SYSTEM_DATE: 'Needs the server date moved; QA server time cannot be changed from the suite.',
  SAP: 'Verifies a posting in SAP / CMS, which the suite has no access to.',
  ROLE_MISSING: 'Needs a role the QA environment has no account for.',
  DATA_MISSING: 'Needs data that does not exist in QA for any account available to the suite.',
} as const;
