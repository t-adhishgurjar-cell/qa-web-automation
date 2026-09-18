import { test } from '@playwright/test';
import { LoginPage } from '../src/pages/login.page';
import { DashboardPage } from '../src/pages/dashboard.page';
import { FP_ADMIN } from '../src/config/accounts';

/**
 * Where bulk mapping / de-mapping lives.
 *
 * The change request names it as one of two in-scope activities, but no officer
 * menu offers a bulk screen — only single de-map. Rather than guess a route,
 * this prints the FP Admin's whole menu (109 entries, the largest in the app)
 * so the real one can be read off.
 *
 *   TOOLS=true ENV=qa npx playwright test --project=tools --grep "bulk menu"
 */
test.use({ storageState: { cookies: [], origins: [] } });

test.describe('Tools — probes @tools', () => {
  test('probe bulk menu', async ({ page }) => {
    test.setTimeout(6 * 60_000);

    const loginPage = new LoginPage(page);
    const dashboardPage = new DashboardPage(page);
    await loginPage.navigate();
    await loginPage.login(FP_ADMIN.username, FP_ADMIN.password);
    await dashboardPage.assertDashboardLoaded();

    const menu = await page.evaluate(() =>
      Array.from(document.querySelectorAll('a[href]'))
        .map(a => {
          const e = a as HTMLAnchorElement;
          return `${e.getAttribute('href') || ''}  "${(e.textContent || '').replace(/\s+/g, ' ').trim()}"`;
        })
        .filter(h => h.startsWith('/') && h.length > 3)
        .filter((h, i, all) => all.indexOf(h) === i)
        .sort()
    );

    console.log(`\nFP Admin menu (${menu.length} entries)`);
    const bulk = menu.filter(m => /bulk|mapping|demap|de-map|approval/i.test(m));
    console.log(`\n--- bulk / mapping / approval entries (${bulk.length}) ---`);
    for (const m of bulk) console.log(`  ${m}`);
    console.log(`\n--- all Vehicle entries ---`);
    for (const m of menu.filter(m => m.startsWith('/Vehicle/'))) console.log(`  ${m}`);

    // Vehicle RO Mapping is the only candidate left for "bulk mapping /
    // de-mapping" — no menu entry anywhere says "bulk" for vehicles. Look
    // inside it for a file upload and a de-map action.
    for (const route of ['/Vehicle/VehicleROMapping', '/Vehicle/DeMapVehicle']) {
      await page.goto(route, { waitUntil: 'domcontentloaded', timeout: 45_000 }).catch(() => undefined);
      await page.waitForTimeout(3_000);
      const seen = await page.evaluate(() => {
        const onScreen = (el: Element) => {
          const r = (el as HTMLElement).getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        };
        const txt = (el: Element) => (el.textContent || '').replace(/\s+/g, ' ').trim();
        return {
          title: txt(document.querySelector('p.box-head-title') || document.createElement('i')),
          fileInputs: Array.from(document.querySelectorAll('input[type=file]')).map(f => (f as HTMLInputElement).id || '(no id)'),
          radios: Array.from(document.querySelectorAll('input[type=radio]')).map(r => `${(r as HTMLInputElement).id}="${(r as HTMLInputElement).value}"`),
          buttons: Array.from(document.querySelectorAll('button, a.btn')).filter(onScreen).map(b => `#${(b as HTMLElement).id || '-'}:"${txt(b)}"`),
          fields: Array.from(document.querySelectorAll('select, input:not([type=hidden])')).filter(onScreen).map(f => (f as HTMLInputElement).id).filter(Boolean),
          bulkWords: /bulk|upload|template|multiple/i.test(document.body.innerText || ''),
        };
      });
      console.log(`\n=== ${route} — "${seen.title}"`);
      console.log(`  mentions bulk/upload/template: ${seen.bulkWords}`);
      console.log(`  file inputs : ${seen.fileInputs.join(', ') || '(none)'}`);
      console.log(`  radios      : ${seen.radios.join(', ') || '(none)'}`);
      console.log(`  fields      : ${seen.fields.join(', ')}`);
      console.log(`  buttons     : ${seen.buttons.join(' | ')}`);
    }
  });
});
