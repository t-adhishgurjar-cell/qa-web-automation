import { Page, TestInfo, test } from '@playwright/test';

/**
 * Evidence for the financial lane's held sessions.
 *
 * The session fixture keeps its own browser context open for the whole worker, so the
 * built-in `screenshot: 'only-on-failure'` (which shoots the per-test `page` context) never
 * sees these pages. Each spec's afterEach calls this with every page it used.
 */
export async function attachOnFailure(testInfo: TestInfo, pages: Array<Page | undefined>): Promise<void> {
  if (testInfo.status === testInfo.expectedStatus) return;
  let i = 0;
  for (const page of pages) {
    if (!page || page.isClosed()) continue;
    const body = await page.screenshot({ fullPage: true }).catch(() => null);
    if (body) await testInfo.attach(`failure-${++i}`, { body, contentType: 'image/png' });
    await testInfo.attach(`failure-${i}-url`, { body: page.url(), contentType: 'text/plain' });
  }
}

/** Records what the application actually showed, for the report reader. */
export function observed(description: string): void {
  test.info().annotations.push({ type: 'observed', description });
  console.log(`  [observed] ${description}`);
}

/** Records where the run deviated from the sheet's literal wording, and why it still counts. */
export function deviation(description: string): void {
  test.info().annotations.push({ type: 'deviation', description });
}
