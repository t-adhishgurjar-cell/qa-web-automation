import { test } from '../src/fixtures/page.fixtures';
import { DSA } from '../src/config/accounts';

/**
 * Do the dropdowns that depend on the customer type reload when it changes?
 *
 * Two symptoms point at one cause. The division list keeps the previous state's
 * divisions when the business state changes (OD-05), and an application built by
 * choosing Fleet first and switching to OD is refused at submit with "Select
 * Customer Sub Type" while the sub-type visibly holds a value. Both look like a
 * child list that is populated once and never refreshed.
 *
 * This reads the sub-type list under Fleet, under OD chosen fresh, and under OD
 * reached by switching — three readings that distinguish "OD has these sub-types"
 * from "the form is still showing Fleet's".
 *
 *   TOOLS=true ENV=qa npx playwright test --project=tools --grep "probe od subtype"
 */

test.use({ storageState: { cookies: [], origins: [] } });

test.describe('Tools — probes @tools', () => {
  test('probe od subtype cascade', async ({ loginPage, dashboardPage, addCustomerPage, page }) => {
    test.setTimeout(300_000);

    await loginPage.navigate();
    await loginPage.login(DSA.username, DSA.password);
    await dashboardPage.assertDashboardLoaded();

    const subTypes = async (when: string) => {
      const state = await page.evaluate(() => {
        const select = document.querySelector('#CustomerSubTypeID') as HTMLSelectElement | null;
        return {
          value: select?.value,
          label: select?.options[select.selectedIndex]?.textContent?.trim(),
          options: Array.from(select?.options ?? []).map(o => `${o.value}:${(o.textContent || '').trim()}`),
        };
      });
      console.log(`\n  ${when}`);
      console.log(`    selected: ${state.value} "${state.label}"`);
      console.log(`    options:  ${state.options.join(' | ')}`);
      return state;
    };

    // Fresh form, Fleet.
    await addCustomerPage.gotoWizard();
    await addCustomerPage.selectDropdown('CustomerTypeID', { label: 'Fleet' });
    await addCustomerPage.settle();
    const fleet = await subTypes('Fleet, on a fresh form');

    // Fresh form, OD.
    await addCustomerPage.gotoWizard();
    await addCustomerPage.selectDropdown('CustomerTypeID', { label: 'OD' });
    await addCustomerPage.settle();
    const odFresh = await subTypes('OD, on a fresh form');

    // Fleet first, then switched to OD — the path that fails at submit.
    await addCustomerPage.gotoWizard();
    await addCustomerPage.selectDropdown('CustomerTypeID', { label: 'Fleet' });
    await addCustomerPage.selectDropdown('CustomerSubTypeID', {});
    await addCustomerPage.settle();
    const chosen = await subTypes('Fleet, with a sub-type chosen');

    await addCustomerPage.selectDropdown('CustomerTypeID', { label: 'OD' });
    await addCustomerPage.settle();
    const switched = await subTypes('after switching that form to OD');

    console.log('\n--- verdict ---');
    console.log(`  OD's own sub-types differ from Fleet's: ` +
      `${JSON.stringify(odFresh.options) !== JSON.stringify(fleet.options)}`);
    console.log(`  after switching, the list matches OD's:  ` +
      `${JSON.stringify(switched.options) === JSON.stringify(odFresh.options)}`);
    console.log(`  after switching, the list matches Fleet's: ` +
      `${JSON.stringify(switched.options) === JSON.stringify(fleet.options)}`);
    console.log(`  the Fleet sub-type "${chosen.label}" is still selected: ` +
      `${switched.value === chosen.value}`);
  });
});
