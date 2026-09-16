import { test } from '../src/fixtures/page.fixtures';
import { CUSTOMER_ADMIN, TEST_OTP } from '../src/config/accounts';
import { AddCustomerPage } from '../src/pages/customer-management/add-customer.page';
import { runTag, freshMobile } from '../src/helpers/test-identity';
import * as path from 'path';

/**
 * Why #btnShowOfficialDetails never becomes clickable.
 *
 * The onboarding spec has failed on it three runs running. Playwright reports
 * the element as resolved but retries "visible, enabled and stable" 32 times,
 * which narrows it: the button is in the DOM, so this is not a missing control
 * or a wrong selector. One of those three conditions never holds.
 *
 * Rather than guess which — the mistake that cost an afternoon on the
 * ViewCustomerUser stall — this reads all three directly, plus what is at the
 * button's own coordinates. The last one matters because this application is
 * known to render hidden controls that shadow visible ones, and an element
 * covered by an overlay reports itself perfectly visible while being unhittable.
 *
 * The markup also carries auto-btn-skip="true", which is not a Bootstrap or
 * HTML attribute. It is the application's own, and worth resolving: if the app
 * marks controls for automation to skip, that is a deliberate signal and this
 * test is ignoring it.
 *
 *   TOOLS=true ENV=qa npx playwright test --project=tools --grep "official details"
 */

test.use({ storageState: { cookies: [], origins: [] } });

test.describe('Tools — probes @tools', () => {
  test('probe official details button', async ({ loginPage, dashboardPage, page }) => {
    test.setTimeout(10 * 60_000);

    await loginPage.navigate();
    await loginPage.login(CUSTOMER_ADMIN.username, CUSTOMER_ADMIN.password);
    await dashboardPage.assertDashboardLoaded();

    const wizard = new AddCustomerPage(page);
    const tag = runTag();
    const upload = path.join(process.cwd(), 'test-data', 'files', 'sample-doc.pdf');

    // Watch what the PAN blur actually asks the server, and what comes back.
    // dismissValidationDialogs() clears the popup without reading it, so a
    // rejected PAN leaves no trace until the wizard refuses to advance two
    // steps later.
    page.on('response', async r => {
      if (!/pan|validate/i.test(r.url())) return;
      const body = await r.text().catch(() => '<unreadable>');
      console.log(`  PAN CALL ${r.status()} ${r.url().slice(0, 110)}`);
      console.log(`           ${body.replace(/\s+/g, ' ').slice(0, 300)}`);
    });

    page.on('dialog', d => {
      console.log(`  NATIVE DIALOG: ${d.message()}`);
      void d.dismiss().catch(() => undefined);
    });

    await wizard.gotoWizard();
    await wizard.fillBasicInformation({
      customerType: 'Fleet',
      panNumber: AddCustomerPage.TEST_PAN,
      panDob: '1990-01-01',
      businessName: `${tag} Probe Co`,
      businessEmail: `${tag.toLowerCase()}@example.com`,
      customerName: `${tag} Customer`,
      customerEmail: `${tag.toLowerCase()}.cust@example.com`,
      customerMobile: freshMobile(),
      otp: TEST_OTP,
      idProofNumber: AddCustomerPage.TEST_PAN,
      bankName: 'HDFC',
      bankAccountHolder: `${tag} Customer`,
      bankAccountNumber: '1234567890',
      ifscCode: 'HDFC0002048',
      uploadFile: upload,
    });
    await wizard.saveAsDraft();
    await wizard.goToAddressStep();
    await wizard.fillAddress({
      pinCode: '201304',
      businessAddress: `${tag} Probe Address`,
      addressProofNumber: '1234567890',
      uploadFile: upload,
    });

    console.log('\nReached the Address step. Inspecting #btnShowOfficialDetails.\n');

    for (const wait of [0, 2_000, 5_000, 10_000]) {
      if (wait) await page.waitForTimeout(wait);

      const state = await page.evaluate(() => {
        const el = document.getElementById('btnShowOfficialDetails') as HTMLButtonElement | null;
        if (!el) return { missing: true };

        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);

        // What is actually at the button's centre? An element covered by an
        // overlay reports itself visible while never being clickable.
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height / 2;
        const atPoint = document.elementFromPoint(cx, cy);
        const describe = (n: Element | null) =>
          n ? `<${n.tagName.toLowerCase()}>${n.id ? '#' + n.id : ''}.${(n.className || '').toString().split(/\s+/).slice(0, 3).join('.')}` : 'nothing';

        return {
          missing: false,
          rect: { w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top), left: Math.round(r.left) },
          display: cs.display,
          visibility: cs.visibility,
          opacity: cs.opacity,
          pointerEvents: cs.pointerEvents,
          disabled: el.disabled,
          ariaDisabled: el.getAttribute('aria-disabled'),
          classes: el.className,
          autoBtnSkip: el.getAttribute('auto-btn-skip'),
          inViewport: r.top >= 0 && r.bottom <= window.innerHeight,
          atCentre: describe(atPoint),
          coveredBySomethingElse: atPoint !== el && !el.contains(atPoint),
          text: (el.textContent || '').replace(/\s+/g, ' ').trim(),
          parentHidden: !el.offsetParent && cs.position !== 'fixed',
        };
      });

      console.log(`+${wait}ms  ${JSON.stringify(state, null, 2)}`);
    }

    // Is anything else answering to this id, or to the same label? The known
    // pattern in this application is a hidden control shadowing a visible one.
    const twins = await page.evaluate(() => ({
      byId: document.querySelectorAll('#btnShowOfficialDetails').length,
      withSkipAttr: Array.from(document.querySelectorAll('[auto-btn-skip]')).map(e => ({
        tag: e.tagName.toLowerCase(),
        id: (e as HTMLElement).id,
        text: (e.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40),
        visible: (e as HTMLElement).getBoundingClientRect().width > 0,
      })),
    }));
    console.log(`\nElements with this id: ${twins.byId}`);
    console.log(`Elements carrying auto-btn-skip:`);
    for (const t of twins.withSkipAttr) console.log(`  ${JSON.stringify(t)}`);

    // Anything the form is complaining about would explain a disabled Next.
    const complaints = await page.evaluate(() =>
      Array.from(document.querySelectorAll('.invalid-feedback, .text-danger, .is-invalid, .modal.show'))
        .filter(e => (e as HTMLElement).getBoundingClientRect().width > 0)
        .map(e => `${e.tagName.toLowerCase()}${(e as HTMLElement).id ? '#' + (e as HTMLElement).id : ''}: ${(e.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 120)}`)
    );
    console.log(`\nVisible validation complaints (${complaints.length}):`);
    for (const c of complaints) console.log(`  ${c}`);

    const cdp = await page.context().newCDPSession(page);
    const { data: shot } = await cdp.send('Page.captureScreenshot', { format: 'png' });
    require('fs').writeFileSync('test-results/official-details-button.png', Buffer.from(shot, 'base64'));
    await cdp.detach().catch(() => undefined);
    console.log('\nScreenshot: test-results/official-details-button.png');
  });
});
