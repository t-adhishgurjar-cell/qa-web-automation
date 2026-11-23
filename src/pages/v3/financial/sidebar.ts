import { Page } from '@playwright/test';

/**
 * Opens a screen the way the sheet's navigation steps describe: from the dashboard,
 * expand the sidebar group, click the item. The groups are Bootstrap collapses
 * (`.nav-item-parent[data-bs-target]`) and the items plain links, so the click on the
 * link is the real navigation, not a goto in disguise.
 */
export async function openFromSidebar(page: Page, group: string, href: string): Promise<void> {
  await page.goto('/Dashboard/Index', { waitUntil: 'domcontentloaded' });
  const parent = page.locator('#sidebarMenu .nav-item-parent', { hasText: group }).first();
  await parent.waitFor({ state: 'visible', timeout: 30_000 });
  const link = page.locator(`#sidebarMenu a[href="${href}"]`).first();
  if (!(await link.isVisible())) await parent.click();
  await link.waitFor({ state: 'visible', timeout: 10_000 });
  await Promise.all([page.waitForURL(u => u.pathname.toLowerCase() === href.toLowerCase(), { timeout: 45_000 }), link.click()]);
}
