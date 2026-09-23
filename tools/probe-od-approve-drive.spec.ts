import { test } from '../src/fixtures/page.fixtures';
import { FP_ADMIN } from '../src/config/accounts';

/**
 * Drives an OD approval by hand, to find what keeps Approve inert.
 *
 * The ids on the OD checker page are the ones the page object already uses —
 * #approverPanVerifyInput / #btnApproverVerifyPan and the bank pair — and verifyField()
 * asserts each button ends up reading "Verified", so those checks are passing. Yet
 * Approve produces no confirmation prompt and no request.
 *
 * The reviewer screen turned out to need its documents previewed first. This does the
 * same steps explicitly here, reporting after each, and watches the network — so
 * "the button did nothing" is separated from "it posted and the server refused".
 *
 *   OD_APPROVE_REF=1000514990 TOOLS=true ENV=qa npx playwright test --project=tools --grep "probe od approve drive"
 */

test.use({ storageState: { cookies: [], origins: [] } });

const REFERENCE = process.env.OD_APPROVE_REF ?? '1000514990';
const PAN = process.env.OD_APPROVE_PAN ?? 'HSBPP4359Q';
const BANK = process.env.OD_APPROVE_BANK ?? '1234567890';

test.describe('Tools — probes @tools', () => {
  test('probe od approve drive', async ({ loginPage, dashboardPage, page, db }) => {
    test.setTimeout(420_000);

    const status = async () => (await db.query<{ Status: number }>(
      `SELECT Status FROM dbo.RawCustomerMaster WHERE ReferenceNo = ${Number(REFERENCE)}`))[0]?.Status;

    await loginPage.navigate();
    await loginPage.login(FP_ADMIN.username, FP_ADMIN.password);
    await dashboardPage.assertDashboardLoaded();
    console.log(`  ${REFERENCE} status before: ${await status()}`);

    page.on('response', async r => {
      if (r.request().method() === 'POST' && /Customer\//i.test(r.url())) {
        console.log(`    <- ${r.status()} ${r.url().split('/').pop()?.split('?')[0]}: ` +
          `${(await r.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 200)}`);
      }
    });

    // Reached through the queue, not by URL.
    //
    // The same URL renders two different pages on this application: navigated to
    // directly, the checker screen comes back without its re-entry fields — so
    // #approverPanVerifyInput never becomes fillable and the probe times out on a
    // control the page simply is not offering. Clicking through from the queue renders
    // the full screen. Add Customer behaves the same way with its wizard footer.
    await page.goto('/Customer/ValidateNewCustomer', { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);
    const queueLink = page.locator(`a[href*="${REFERENCE}"]`).first();
    if (!(await queueLink.isVisible().catch(() => false))) {
      throw new Error(`${REFERENCE} is not in the checker queue, so there is nothing to approve.`);
    }
    await queueLink.click();
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);
    console.log(`  opened from the queue: ${page.url()}`);

    // Documents first, as on the reviewer screen — unless switched off, which is how
    // this probe tells "the previews are required" apart from "the previews are what
    // breaks the page". One of them, the address proof, opens nothing at all, and a
    // preview that opens nothing can still leave a Bootstrap backdrop behind — which
    // would make every control after it unclickable and look exactly like an inert
    // Approve.
    const previews = process.env.OD_SKIP_PREVIEWS ? [] :
      ['btnCheckerViewPanCardOd', 'btnCheckerViewMakerAddressProof', 'btnCheckerViewBankProof'];
    for (const id of previews) {
      const control = page.locator(`#${id}`);
      if (!(await control.isVisible().catch(() => false))) { console.log(`  ${id}: absent`); continue; }
      await page.locator('.modal.show').first().waitFor({ state: 'hidden', timeout: 8_000 }).catch(() => undefined);
      await control.click().catch(() => undefined);
      const shown = await page.locator('.modal.show').first()
        .waitFor({ state: 'visible', timeout: 8_000 }).then(() => true).catch(() => false);
      const close = page.locator('.modal.show [data-bs-dismiss="modal"], .modal.show .btn-close').first();
      if (await close.isVisible().catch(() => false)) await close.click().catch(() => undefined);
      await page.locator('.modal.show').first().waitFor({ state: 'hidden', timeout: 8_000 }).catch(() => undefined);
      console.log(`  ${id}: ${shown ? 'opened' : 'did NOT open'}`);
    }

    // The two re-entry checks.
    for (const [label, inputId, buttonId, value] of [
      ['PAN', 'approverPanVerifyInput', 'btnApproverVerifyPan', PAN],
      ['bank', 'approverBankAccountVerifyInput', 'btnApproverVerifyBankAccount', BANK],
    ] as const) {
      await page.locator(`#${inputId}`).fill(value);
      await page.locator(`#${buttonId}`).click().catch(() => undefined);
      await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => undefined);
      const button = page.locator(`#${buttonId}`);
      console.log(`  ${label}: button now "${(await button.textContent())?.trim()}" ` +
        `disabled=${await button.isDisabled().catch(() => null)}`);
    }

    // Is anything left covering the page?
    const stuck = await page.evaluate(() => ({
      backdrops: document.querySelectorAll('.modal-backdrop').length,
      openModals: document.querySelectorAll('.modal.show').length,
      bodyHasModalOpen: document.body.classList.contains('modal-open'),
    }));
    console.log(`  page state: ${JSON.stringify(stuck)}`);

    const remarks = page.locator('#Remarks').first();
    if (await remarks.isVisible().catch(() => false)) {
      await remarks.fill('Approved by QA automation — OD checker verification complete.');
      console.log(`  remarks filled`);
    } else {
      console.log(`  no visible #Remarks on this page`);
    }

    const approve = page.locator('#btnApprove');
    console.log(`  #btnApprove visible=${await approve.isVisible()} disabled=${await approve.isDisabled().catch(() => null)}`);
    await approve.click();
    await page.locator('.modal.show').first().waitFor({ state: 'visible', timeout: 10_000 }).catch(() => undefined);

    const dialog = await page.evaluate(() =>
      Array.from(document.querySelectorAll('.modal.show'))
        .map(e => (e.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 200)));
    console.log(`  dialog: ${dialog.join(' | ') || 'none'}`);

    const said = await page.evaluate(() =>
      Array.from(document.querySelectorAll('.text-danger, .field-validation-error, [id$="_error"]'))
        .filter(e => !!(e as HTMLElement).offsetParent)
        .map(e => (e.textContent || '').replace(/\s+/g, ' ').trim())
        .filter(t => t && !/^[*\s]+$/.test(t)));
    console.log(`  complaints: ${[...new Set(said)].join(' | ') || 'none'}`);

    const yes = page.locator('.modal.show button:visible, .modal.show .btn:visible')
      // "Yes, approve" — matched as a prefix, not as the whole word. An anchored
      // /^yes$/ misses it, which is how a dialog that was open and waiting got reported
      // as a decision that never submitted.
      .filter({ hasText: /^\s*yes[,\s]/i }).first();
    if (await yes.isVisible().catch(() => false)) {
      console.log(`  clicking "${(await yes.textContent())?.trim()}"`);
      await yes.click();
      await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);
      const after = await page.evaluate(() =>
        Array.from(document.querySelectorAll('.modal.show'))
          .map(e => (e.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 200)));
      console.log(`  then: ${after.join(' | ') || 'no dialog'}`);
    }

    console.log(`\n  ${REFERENCE} status after: ${await status()}`);
  });
});
