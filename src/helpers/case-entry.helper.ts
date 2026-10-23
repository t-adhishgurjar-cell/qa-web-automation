import { test } from '@playwright/test';

/**
 * Entries for master-workbook cases that are listed but not executed.
 *
 * Every case in a sheet gets exactly one entry in the report. A case marked
 * Manual is a skipped test carrying the `@manual` tag; a case marked Automate
 * that genuinely cannot run from the web app with the accounts we hold is a
 * skipped test whose annotation says precisely why. Titles follow the feature
 * convention `[<PREFIX>-<ID>] <scenario>`.
 */
export const MANUAL_REASON = 'Marked Manual in the master workbook';

export function caseTitleOf(prefix: string, id: string, scenario: string): string {
  // Sheets whose IDs already carry the prefix (CPL-001, TC_MCS_01) are used as they are.
  return `[${id.toUpperCase().startsWith(prefix.toUpperCase()) ? id : `${prefix}-${id}`}] ${scenario}`;
}

export function manualCase(prefix: string, id: string, scenario: string, tags: string[]): void {
  test(caseTitleOf(prefix, id, scenario), { tag: [...tags, '@manual'] }, async () => {
    test.info().annotations.push({ type: 'manual', description: MANUAL_REASON });
    test.skip(true, MANUAL_REASON);
  });
}

export function notExecutableCase(prefix: string, id: string, scenario: string, reason: string, tags: string[]): void {
  test(caseTitleOf(prefix, id, scenario), { tag: [...tags, '@not-executable'] }, async () => {
    test.info().annotations.push({ type: 'not-executable', description: reason });
    test.skip(true, `NOT RUN: ${reason}`);
  });
}
