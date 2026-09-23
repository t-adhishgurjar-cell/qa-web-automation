import { test } from '../src/fixtures/page.fixtures';
import { TSM } from '../src/config/accounts';

/**
 * Drives an OD review by hand, to find what ReviewCustomerPage.review() trips on.
 *
 * The page is not the problem and neither is scope: the application is in this TSM's
 * queue, the detail page loads, and it carries the same controls the page object knows —
 * #reviewerPanDocAck, #reviewerBankDocAck, #Remarks and #btnApprove ("Reviewed").
 * Yet review() returned steps: 0 and "the page refused without a dialog".
 *
 * So this does each step explicitly and reports after every one: tick both
 * acknowledgements, write remarks, click Reviewed, and watch the network and the
 * dialogs. Whatever the real gate is, it shows up here rather than being summarised
 * away.
 *
 *   OD_REVIEW_REF=1000514990 TOOLS=true ENV=qa npx playwright test --project=tools --grep "probe od review drive"
 */

test.use({ storageState: { cookies: [], origins: [] } });

const REFERENCE = process.env.OD_REVIEW_REF ?? '1000514990';

test.describe('Tools — probes @tools', () => {
  test('probe od review drive', async ({ loginPage, dashboardPage, page, db }) => {
    test.setTimeout(420_000);

    const status = async () => (await db.query<{ Status: number }>(
      `SELECT Status FROM dbo.RawCustomerMaster WHERE ReferenceNo = ${Number(REFERENCE)}`))[0]?.Status;

    await loginPage.navigate();
    await loginPage.login(TSM.username, TSM.password);
    await dashboardPage.assertDashboardLoaded();

    console.log(`  ${REFERENCE} status before: ${await status()}`);

    page.on('response', async r => {
      if (/Customer\//i.test(r.url()) && r.request().method() === 'POST') {
        console.log(`    <- ${r.status()} ${r.url().split('/').pop()}: ` +
          `${(await r.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 250)}`);
      }
    });

    await page.goto(`/Customer/ReviewCustomerDetails?ReferenceNo=${REFERENCE}`,
      { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);

    // Hypothesis: the reviewer must actually open each document before "Reviewed"
    // becomes live. The OD page offers three — PAN, address proof and bank proof — and
    // a gate of that shape would explain a button that sends nothing and says nothing.
    for (const id of ['btnCheckerViewPanCardOd', 'btnCheckerViewMakerAddressProof', 'btnCheckerViewBankProof']) {
      const view = page.locator(`#${id}`);
      if (!(await view.isVisible().catch(() => false))) {
        console.log(`  ${id}: not on this page`);
        continue;
      }
      await view.click().catch(() => undefined);
      await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => undefined);
      const opened = await page.locator('.modal.show').first().isVisible().catch(() => false);
      // Close it again by its own control, so the next click is not swallowed.
      const close = page.locator('.modal.show [data-bs-dismiss="modal"], .modal.show .btn-close').first();
      if (await close.isVisible().catch(() => false)) await close.click().catch(() => undefined);
      await page.locator('.modal.show').first().waitFor({ state: 'hidden', timeout: 8_000 })
        .catch(() => undefined);
      console.log(`  ${id}: preview ${opened ? 'opened' : 'did not open'}`);
    }

    for (const id of ['reviewerPanDocAck', 'reviewerBankDocAck']) {
      const box = page.locator(`#${id}`);
      const before = await box.isChecked().catch(() => null);
      await box.check({ timeout: 10_000 }).catch(async () => {
        console.log(`    ${id}: check() refused, clicking its label instead`);
        await page.locator(`label[for="${id}"]`).click({ timeout: 5_000 }).catch(() => undefined);
      });
      console.log(`  ${id}: ${before} -> ${await box.isChecked().catch(() => null)}`);
    }

    await page.locator('#Remarks').fill('Reviewed by QA automation — OD documents verified.');
    console.log(`  Remarks: "${await page.locator('#Remarks').inputValue()}"`);

    const approve = page.locator('#btnApprove');
    console.log(`  #btnApprove visible=${await approve.isVisible()} text="${(await approve.textContent())?.trim()}"`);
    await approve.click();
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);

    // Anything the page says, dialog or inline, with the asterisks filtered out —
    // a bare "*" is a required-field marker, not a complaint, and reporting it as one
    // is what made review() look as though the page had refused silently.
    const said = await page.evaluate(() => {
      const out: string[] = [];
      for (const element of Array.from(document.querySelectorAll('.modal.show, .text-danger, .field-validation-error'))) {
        const text = (element.textContent || '').replace(/\s+/g, ' ').trim();
        if (text && text !== '*' && !!(element as HTMLElement).offsetParent) out.push(text.slice(0, 200));
      }
      return [...new Set(out)];
    });
    console.log(`  page said: ${said.join(' | ') || 'nothing'}`);

    // A confirmation dialog may be waiting for an OK.
    const confirm = page.locator('.modal.show button:visible, .modal.show .btn:visible');
    if (await confirm.first().isVisible().catch(() => false)) {
      const labels = await confirm.allTextContents();
      console.log(`  dialog buttons: ${labels.map(l => l.trim()).join(' | ')}`);
      const ok = confirm.filter({ hasText: /^(ok|yes|confirm|proceed)$/i }).first();
      if (await ok.isVisible().catch(() => false)) {
        await ok.click();
        await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);
        console.log(`  clicked OK`);
        const after = await page.evaluate(() =>
          Array.from(document.querySelectorAll('.modal.show'))
            .map(e => (e.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 200)));
        console.log(`  then: ${after.join(' | ') || 'no dialog'}`);
      }
    }

    console.log(`\n  ${REFERENCE} status after: ${await status()}`);
  });
});
