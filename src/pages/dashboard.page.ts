import { Page, expect } from '@playwright/test';
import { BasePage } from './base.page';

export class DashboardPage extends BasePage {
  // ─── Locators (recorded — webqa.fleetforc.com) ────────────────────────────
  private readonly sidebarMenu    = this.page.locator('#sidebarMenu');
  private readonly userAvatar     = this.page.locator('.header-avatar-wrapper.dropdown-toggle').first();
  private readonly logoutLink     = this.page.getByRole('link', { name: /Logout/i });

  constructor(page: Page) {
    super(page);
  }

  // ─── Actions ──────────────────────────────────────────────────────────────
  async navigate(): Promise<void> {
    await this.navigateTo('/');
  }

  async openUserMenu(): Promise<void> {
    this.logger.info('Opening user menu');
    try {
      await this.userAvatar.waitFor({ state: 'visible', timeout: 15_000 });
      await this.userAvatar.scrollIntoViewIfNeeded();
      await this.clickElement(this.userAvatar, { force: true });
      return;
    } catch (error) {
      this.logger.warn('User avatar menu not available, falling back to sidebar user menu');
    }

    const userMenu = this.sidebarMenu.getByRole('button').filter({ hasText: /Admin/i }).last();
    await this.clickElement(userMenu);
  }

  async logout(): Promise<void> {
    this.logger.info('Logging out');
    await this.openUserMenu();
    await this.clickElement(this.logoutLink);
    await this.waitForPageLoad();
  }

  async expandSidebarSection(sectionName: string): Promise<void> {
    this.logger.info(`Expanding sidebar section: ${sectionName}`);
    await this.sidebarMenu.getByRole('button', { name: new RegExp(sectionName, 'i') }).click();
  }

  async navigateToSection(linkName: string): Promise<void> {
    this.logger.info(`Navigating to: ${linkName}`);
    await this.sidebarMenu.getByRole('link', { name: linkName }).click();
  }

  // ─── Assertions ───────────────────────────────────────────────────────────
  async assertDashboardLoaded(): Promise<void> {
    await expect.soft(this.page).not.toHaveURL(/Login/i);
    await expect.soft(this.sidebarMenu).toBeVisible();
  }

  async assertSidebarSectionVisible(sectionName: string): Promise<void> {
    await expect(this.sidebarMenu.getByRole('button', { name: new RegExp(sectionName, 'i') })).toBeVisible();
  }
}
