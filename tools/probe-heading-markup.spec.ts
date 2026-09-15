import { test } from '../src/fixtures/page.fixtures';
import { PARENT_ADMIN } from '../src/config/accounts';

/**
 * What this application uses for a page heading.
 *
 * The module walk reported "(no heading)" on 37 of 39 screens against
 * `h1, h2, h3, .page-title, .card-title, .content-header`, while the
 * screenshots plainly show titles like "Customer Dashboard". Rather than widen
 * the selector by guessing a fourth time, this prints every plausible candidate
 * with its tag, classes and position so the right one can be read off.
 *
 *   TOOLS=true ENV=qa npx playwright test --project=tools --grep "heading markup"
 */

const PAGES = [
  '/Dashboard/Index',
  '/Customer/ViewCustomerUser',
  '/Customer/AddBranch',
  '/Vehicle/ManageVehicles',
];

test.use({ storageState: { cookies: [], origins: [] } });

test.describe('Tools — probes @tools', () => {
  test('probe heading markup', async ({ loginPage, dashboardPage, page }) => {
    test.setTimeout(10 * 60_000);
    test.skip(!PARENT_ADMIN.password, 'Set PARENT_ADMIN_PASS');

    await loginPage.navigate();
    await loginPage.login(PARENT_ADMIN.username, PARENT_ADMIN.password, PARENT_ADMIN.roleCode);
    await dashboardPage.assertDashboardLoaded();

    for (const route of PAGES) {
      await page.goto(route, { waitUntil: 'domcontentloaded', timeout: 45_000 }).catch(() => undefined);
      await page.waitForTimeout(2_500);

      const candidates = await page.evaluate(() => {
        const out: { tag: string; cls: string; id: string; top: number; text: string }[] = [];
        for (const el of Array.from(document.querySelectorAll('*'))) {
          const node = el as HTMLElement;
          // Leaf-ish elements only: a wrapper's textContent is the whole page.
          if (node.children.length > 1) continue;
          const text = (node.textContent || '').replace(/\s+/g, ' ').trim();
          if (!text || text.length > 60) continue;
          const r = node.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) continue;
          // Headings live in the top band of the content area.
          if (r.top > 260) continue;
          const size = parseFloat(getComputedStyle(node).fontSize) || 0;
          if (size < 15) continue;
          out.push({
            tag: node.tagName.toLowerCase(),
            cls: (node.className || '').toString().slice(0, 60),
            id: node.id || '',
            top: Math.round(r.top),
            text,
          });
        }
        return out.sort((a, b) => a.top - b.top).slice(0, 12);
      });

      console.log(`\n=== ${route} ===`);
      for (const c of candidates) {
        console.log(
          `  top=${String(c.top).padStart(4)}  <${c.tag}>` +
            `${c.id ? `#${c.id}` : ''}${c.cls ? `.${c.cls.split(/\s+/).join('.')}` : ''}` +
            `\n        "${c.text}"`
        );
      }
    }
  });
});
