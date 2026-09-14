import { test } from '../src/fixtures/page.fixtures';
import { FP_ADMIN } from '../src/config/accounts';

/**
 * Lists every screen this account can actually reach.
 *
 * The coverage note names twenty Customer Management screens and leaves several
 * routes blank, and the workbook has no sheet for a customer bank account or a
 * branch at all. Rather than guess which of those exist, this reads the
 * navigation the application renders and prints it grouped by section.
 *
 *   TOOLS=true ENV=qa npx playwright test --project=tools --grep "probe nav"
 */

test.use({ storageState: { cookies: [], origins: [] } });

test.describe('Tools — probes @tools', () => {
  test('probe nav — what this account can reach', async ({ loginPage, dashboardPage, page }) => {
    test.setTimeout(180_000);

    await loginPage.navigate();
    await loginPage.login(FP_ADMIN.username, FP_ADMIN.password);
    await dashboardPage.assertDashboardLoaded();

    const menu = await page.evaluate(() => {
      const entries: { section: string; text: string; href: string }[] = [];

      for (const link of Array.from(document.querySelectorAll('a[href]'))) {
        const anchor = link as HTMLAnchorElement;
        const href = anchor.getAttribute('href') || '';
        if (!href || href === '#' || href.startsWith('javascript')) continue;

        // Walk up for the nearest collapsible group heading, which is how this
        // sidebar labels its sections.
        let section = '';
        let node: HTMLElement | null = anchor.parentElement;
        for (let depth = 0; node && depth < 8; depth += 1, node = node.parentElement) {
          const heading = node.previousElementSibling;
          if (heading && /nav-link|menu-title|accordion-button/.test(heading.className || '')) {
            section = (heading.textContent || '').trim().replace(/\s+/g, ' ');
            break;
          }
        }

        entries.push({
          section: section || '(ungrouped)',
          text: (anchor.textContent || '').trim().replace(/\s+/g, ' '),
          href,
        });
      }
      return entries.filter(e => e.text);
    });

    const bySection = new Map<string, { text: string; href: string }[]>();
    for (const entry of menu) {
      const list = bySection.get(entry.section) ?? [];
      if (!list.some(l => l.href === entry.href)) list.push({ text: entry.text, href: entry.href });
      bySection.set(entry.section, list);
    }

    console.log(`--- ${menu.length} links, ${bySection.size} sections ---`);
    for (const [section, links] of bySection) {
      console.log(`\n[${section}]`);
      for (const l of links) console.log(`  ${l.text.padEnd(42)} ${l.href}`);
    }

    console.log('\n--- anything mentioning bank or branch ---');
    for (const e of menu) {
      if (/bank|branch/i.test(e.text) || /bank|branch/i.test(e.href)) {
        console.log(`  [${e.section}] ${e.text} -> ${e.href}`);
      }
    }
  });
});
