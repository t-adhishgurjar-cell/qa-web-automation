import { test } from '@playwright/test';
import { LoginPage } from '../src/pages/login.page';
import { DashboardPage } from '../src/pages/dashboard.page';
import { AddVehiclePage } from '../src/pages/vehicle/add-vehicle.page';

/**
 * Why Add Vehicles no longer resolves NAYAFP2023400255.
 *
 * Seeding the approval queue failed on all four attempts with "could not resolve customer" —
 * chooseCustomer() fills #CustomerId, blurs, and reads #CustomerName, which came back empty. The
 * customer exists and is Active, so either the lookup now answers differently, the field moved, or
 * the officer is refused the customer.
 *
 * This watches the lookup request and dumps the fields around it.
 *
 *   TOOLS=true ENV=qa npx playwright test --project=tools --grep "probe addvehicle resolve"
 */

const UID = process.env.PROBE_UID ?? 'NAYAFP2023400255';
const OFFICER = { username: process.env.PROBE_USER ?? '9073139002', password: process.env.OFFICER_PASSWORD ?? 'Nayara@1' };

test.describe('Tools — probes @tools', () => {
  test('probe addvehicle resolve', async ({ page }) => {
    test.setTimeout(300_000);

    await new LoginPage(page).navigate();
    await new LoginPage(page).login(OFFICER.username, OFFICER.password);
    await new DashboardPage(page).assertDashboardLoaded();

    page.on('response', async r => {
      if (r.request().method() === 'POST' && /customer|branch|vehicle/i.test(r.url())) {
        console.log(`    <- ${r.status()} ${r.url().split('/').pop()?.split('?')[0]}: ` +
          `${(await r.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 260)}`);
      }
    });

    const add = new AddVehiclePage(page);
    await add.open();

    const before = await page.evaluate(() => {
      const ids = ['CustomerId', 'avBranchLocation', 'CustomerName', 'NoOfCards', 'ddlVehicleType'];
      return ids.map(id => {
        const el = document.getElementById(id) as HTMLInputElement | null;
        if (!el) return `${id}: (absent)`;
        return `${id}: <${el.tagName.toLowerCase()}> visible=${!!el.offsetParent} ` +
          `disabled=${el.disabled} value="${(el.value || '').slice(0, 30)}"` +
          (el.tagName === 'SELECT'
            ? ` options=${Array.from((el as unknown as HTMLSelectElement).options).length}`
            : '');
      });
    });
    console.log('\n  fields on arrival:');
    for (const f of before) console.log(`    ${f}`);

    console.log(`\n  entering ${UID}`);
    const resolved = await add.chooseCustomer(UID).catch(e => `(threw: ${String(e).split('\n')[0]})`);
    console.log(`  chooseCustomer returned: "${resolved}"`);

    const after = await page.evaluate(() => {
      const ids = ['CustomerId', 'CustomerName', 'avBranchLocation'];
      const out = ids.map(id => {
        const el = document.getElementById(id) as HTMLInputElement | null;
        return el ? `${id}="${(el.value || '').slice(0, 40)}"` : `${id}: (absent)`;
      });
      const messages = Array.from(document.querySelectorAll('.modal.show, .text-danger, .invalid-feedback, [id$="_error"]'))
        .filter(e => !!(e as HTMLElement).offsetParent)
        .map(e => (e.textContent || '').replace(/\s+/g, ' ').trim())
        .filter(t => t && !/^[*\s]+$/.test(t));
      return { out, messages: [...new Set(messages)] };
    });
    console.log(`\n  after: ${after.out.join('  |  ')}`);
    console.log(`  messages: ${after.messages.join('  ||  ') || 'none'}`);
  });
});
