import { test } from '../src/fixtures/page.fixtures';
import { DSA } from '../src/config/accounts';

/**
 * Which fields the Basic Information step renders for OD, against Fleet.
 *
 * fillBasicInformation() was written for Fleet and fails on OD at Business Name,
 * which is present in the DOM but hidden — so OD is not "Fleet without the
 * division", it is a different form. This lists both, so the difference is
 * evidence rather than a sequence of timeouts discovered one field at a time.
 *
 *   TOOLS=true ENV=qa npx playwright test --project=tools --grep "probe od form fields"
 */

test.use({ storageState: { cookies: [], origins: [] } });

test.describe('Tools — probes @tools', () => {
  test('probe od form fields', async ({ loginPage, dashboardPage, addCustomerPage, page }) => {
    test.setTimeout(300_000);

    await loginPage.navigate();
    await loginPage.login(DSA.username, DSA.password);
    await dashboardPage.assertDashboardLoaded();
    await addCustomerPage.gotoWizard();

    const fields = async () =>
      page.evaluate(() =>
        Array.from(document.querySelectorAll('input,select,textarea'))
          .filter(e => (e as HTMLInputElement).type !== 'hidden' && e.id)
          .map(e => {
            const element = e as HTMLInputElement;
            return {
              id: element.id,
              visible: !!element.offsetParent,
              required: element.required || element.getAttribute('data-val-required') !== null,
            };
          })
      );

    const snapshots: Record<string, Awaited<ReturnType<typeof fields>>> = {};
    for (const type of ['Fleet', 'OD']) {
      await addCustomerPage.gotoWizard();
      await addCustomerPage.selectDropdown('CustomerTypeID', { label: type });
      await addCustomerPage.settle();
      snapshots[type] = await fields();
      console.log(`  ${type}: ${snapshots[type].filter(f => f.visible).length} visible of ${snapshots[type].length}`);
    }

    const visible = (type: string) =>
      new Set(snapshots[type].filter(f => f.visible).map(f => f.id));
    const fleet = visible('Fleet');
    const od = visible('OD');

    console.log('\n--- hidden for OD, shown for Fleet ---');
    for (const id of [...fleet].filter(id => !od.has(id)).sort()) {
      const required = snapshots['OD'].find(f => f.id === id)?.required;
      console.log(`  ${id}${required ? '   (still marked required)' : ''}`);
    }

    console.log('\n--- shown for OD, hidden for Fleet ---');
    for (const id of [...od].filter(id => !fleet.has(id)).sort()) console.log(`  ${id}`);

    console.log('\n--- visible and required for OD ---');
    for (const field of snapshots['OD'].filter(f => f.visible && f.required)) {
      console.log(`  ${field.id}`);
    }
  });
});
