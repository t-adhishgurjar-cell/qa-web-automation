import { test } from '../src/fixtures/page.fixtures';
import { DSA } from '../src/config/accounts';

/**
 * What validates the PAN on an OD enrolment, and what it wants.
 *
 * The form refuses to submit with "Please validate the PAN number before
 * submission. Tab out of the PAN field after entering it" — and it still says so
 * after the field has been filled and blurred. So either the handler is bound to
 * some other event, or it ran and rejected this PAN, and the message is the same
 * either way. This watches the network and the DOM around the field instead of
 * guessing which.
 *
 *   TOOLS=true ENV=qa npx playwright test --project=tools --grep "probe od pan"
 */

test.use({ storageState: { cookies: [], origins: [] } });

const PANS = ['ABCPA1234F', 'AAAPA1234A', 'AAACA1234A'];

test.describe('Tools — probes @tools', () => {
  test('probe od pan', async ({ loginPage, dashboardPage, addCustomerPage, page }) => {
    test.setTimeout(300_000);

    await loginPage.navigate();
    await loginPage.login(DSA.username, DSA.password);
    await dashboardPage.assertDashboardLoaded();
    await addCustomerPage.gotoWizard();

    await addCustomerPage.selectDropdown('CustomerTypeID', { label: 'OD' });
    await addCustomerPage.settle();

    page.on('request', r => {
      if (/pan/i.test(r.url())) console.log(`    -> ${r.method()} ${r.url()} ${r.postData() ?? ''}`.slice(0, 250));
    });
    page.on('response', async r => {
      if (/pan/i.test(r.url())) {
        console.log(`    <- ${r.status()} ${(await r.text().catch(() => '')).slice(0, 250)}`);
      }
    });

    // Anything the page keeps to remember that the PAN passed.
    const flags = async () =>
      page.evaluate(() =>
        Array.from(document.querySelectorAll('input[type="hidden"]'))
          .filter(e => /pan|verif|valid/i.test(e.id))
          .map(e => `${e.id}="${(e as HTMLInputElement).value}"`)
      );

    console.log(`  flags before: ${(await flags()).join(', ') || 'none'}`);

    for (const pan of PANS) {
      console.log(`\n--- ${pan} ---`);
      await addCustomerPage.fillInput(addCustomerPage.panDob, '1990-01-01');
      await addCustomerPage.fillInput(addCustomerPage.panNumber, pan);
      await addCustomerPage.panNumber.blur();
      await addCustomerPage.settle();
      // A tab-out is what the message literally asks for; blur() may not be it.
      await addCustomerPage.panNumber.focus();
      await page.keyboard.press('Tab');
      await addCustomerPage.settle();
      await addCustomerPage.waitForDialog(4_000);
      const said = await addCustomerPage.dismissValidationDialogs();
      console.log(`  dialogs: ${said.join(' | ') || 'none'}`);
      console.log(`  flags:   ${(await flags()).join(', ') || 'none'}`);
      console.log(`  errors:  ${(await addCustomerPage.visibleFieldErrors()).join(' | ') || 'none'}`);
    }
  });
});
