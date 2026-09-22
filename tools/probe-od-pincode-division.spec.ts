import { expect } from '@playwright/test';
import { test } from '../src/fixtures/page.fixtures';
import { DSA } from '../src/config/accounts';

/**
 * Finds the pin-code-basis-division restriction the change request wants removed.
 *
 * The first probe established what OD renders: #CustDivisionID is present,
 * required and pre-set to the maker's own division, but *disabled* — so for OD the
 * division is already not a choice. It also showed the pin-code lookup
 * (POST /Common/GetLocationByPincode) is told nothing but the pin code, so no
 * restriction is applied at lookup time.
 *
 * That leaves the restriction somewhere else, and "somewhere else" has three
 * candidates worth separating, because each one fails differently and a test has
 * to assert against the right one:
 *
 *   a. the data — a pin code table that maps each pin code to one division, so
 *      only in-division pin codes resolve at all;
 *   b. the client — a handler that compares the resolved state against the
 *      division and complains;
 *   c. the server — accepted in the form, refused on save.
 *
 * So this enters three pin codes against the same OD form: one inside the maker's
 * division, one in a different state entirely, and one in a neighbouring state,
 * and records what each resolves to and what the form then says. It stops at Next
 * — nothing is saved or submitted.
 *
 *   TOOLS=true ENV=qa npx playwright test --project=tools --grep "probe od pincode"
 */

test.use({ storageState: { cookies: [], origins: [] } });

/**
 * The maker is a DSA in Gurgaon division, HR_HP_PB state, North region (measured).
 * These are chosen relative to that, so "in" and "out" of division are real.
 */
const PIN_CODES = [
  { pin: '122001', where: 'Gurgaon, HR — the maker\'s own division' },
  { pin: '201304', where: 'Noida, UP — different state, different division' },
  { pin: '560001', where: 'Bengaluru, KA — different region entirely' },
];

test.describe('Tools — probes @tools', () => {
  test('probe od pincode — is the address restricted to the division', async ({
    loginPage, dashboardPage, addCustomerPage, page,
  }) => {
    test.setTimeout(300_000);

    await loginPage.navigate();
    await loginPage.login(DSA.username, DSA.password);
    await dashboardPage.assertDashboardLoaded();
    await addCustomerPage.gotoWizard();

    await addCustomerPage.selectDropdown('CustomerTypeID', { label: 'OD' });
    await addCustomerPage.settle();

    const divisionOptions = await page.$$eval('#CustDivisionID option', options =>
      options.map(o => (o.textContent || '').trim())
    );
    console.log(`\n  division control offers: ${divisionOptions.join(' | ')}`);
    console.log(`  division is disabled:    ${await addCustomerPage.division.isDisabled()}`);

    // ── (b) and (c). What the app does with each pin code.
    for (const { pin, where } of PIN_CODES) {
      console.log(`\n--- ${pin} (${where}) ---`);

      // Capture the lookup's own answer, not just the fields it fills: a pin code
      // the server declines to resolve is a different finding from one it resolves
      // to a state the division does not cover.
      const responsePromise = page
        .waitForResponse(r => /GetLocationByPincode/i.test(r.url()), { timeout: 20_000 })
        .catch(() => null);

      await addCustomerPage.enterAddressPinCode(pin);
      const response = await responsePromise;
      if (response) {
        const body = await response.text().catch(() => '(unreadable)');
        console.log(`  lookup ${response.status()}: ${body.slice(0, 300)}`);
      } else {
        console.log('  lookup: no request was made');
      }
      await addCustomerPage.settle();

      for (const [name, locator] of [
        ['state', addCustomerPage.addressState],
        ['city', addCustomerPage.addressCity],
        ['district', addCustomerPage.addressDistrict],
      ] as const) {
        const value = await locator.inputValue().catch(async () =>
          (await locator.textContent().catch(() => null))?.trim() ?? '(absent)'
        );
        console.log(`  ${name.padEnd(9)} = ${value}`);
      }

      // Anything the app chose to say — inline, in a dialog, or in a toast.
      const complaints = await page.evaluate(() => {
        const out: string[] = [];
        const selectors = [
          '.field-validation-error', '.text-danger', '.invalid-feedback',
          '.modal.show', '.toast.show', '#error-mess-text', '#failer-mess-text',
        ];
        for (const selector of selectors) {
          for (const element of Array.from(document.querySelectorAll(selector))) {
            const text = (element.textContent || '').trim().replace(/\s+/g, ' ');
            const shown = !!(element as HTMLElement).offsetParent;
            if (text && shown) out.push(`${selector}: ${text.slice(0, 200)}`);
          }
        }
        return [...new Set(out)];
      });
      if (!complaints.length) console.log('  the app said nothing');
      for (const complaint of complaints) console.log(`  ${complaint}`);
    }

    expect(divisionOptions.length).toBeGreaterThan(0);
  });
});
