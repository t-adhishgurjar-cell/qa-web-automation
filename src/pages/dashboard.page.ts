import { Page, expect } from '@playwright/test';
import { BasePage } from './base.page';

/**
 * FleetPlus dashboard — /NayaraDashboard/Index.
 *
 * The header carries a single avatar button whose Bootstrap dropdown holds
 * "Change Password" and "Logout":
 *
 *   button.header-avatar-wrapper.dropdown-toggle   ← opens the menu
 *   .header-avatar-dropdown a[href="/Home/Logout"] ← the menu item
 *
 * The scoping in that second selector matters. Three elements on the page answer
 * to "a link named Logout": the menu item, the idle-session dialog's button, and
 * the profile-conflict dialog's link. The last two are permanently in the DOM and
 * hidden, so an unscoped getByRole('link', { name: /Logout/i }) matches three
 * elements and fails Playwright's strict mode — which surfaced as an unexplained
 * timeout rather than as "your locator is ambiguous".
 */
export class DashboardPage extends BasePage {
  // ─── Locators (verified against webqa) ────────────────────────────────────
  private readonly sidebarMenu = this.page.locator('#sidebarMenu');
  private readonly userAvatar = this.page.locator('button.header-avatar-wrapper.dropdown-toggle').first();
  /** Scoped to the header menu — see the class comment. */
  private readonly logoutLink = this.page
    .locator('.header-avatar-dropdown a[href="/Home/Logout"]')
    .first();

  private readonly changePasswordLink = this.page
    .locator('.header-avatar-dropdown a')
    .filter({ hasText: /change password/i })
    .first();

  constructor(page: Page) {
    super(page);
  }

  // ─── Actions ──────────────────────────────────────────────────────────────
  async navigate(): Promise<void> {
    await this.navigateTo('/');
  }

  /**
   * Opens the header user menu, retrying if the click does not take.
   *
   * Like the login modals, this is a Bootstrap dropdown whose behaviour is bound
   * by page script. Between the dashboard painting and that script running, the
   * button is visible and enabled and clicking it does nothing — a state
   * Playwright's actionability checks cannot distinguish from a working control.
   */
  async openUserMenu(attempts = 3): Promise<void> {
    this.logger.info('Opening user menu');

    await this.userAvatar.waitFor({ state: 'visible', timeout: 20_000 });
    await this.userAvatar.scrollIntoViewIfNeeded();

    for (let attempt = 1; attempt <= attempts; attempt++) {
      await this.userAvatar.click();

      const opened = await this.logoutLink
        .waitFor({ state: 'visible', timeout: 5_000 })
        .then(() => true)
        .catch(() => false);

      if (opened) return;

      this.logger.warn(
        `The header avatar did not open its menu (attempt ${attempt}/${attempts}).`
      );
    }

    throw new Error(
      `The header user menu never opened after ${attempts} clicks on the avatar. ` +
        `The button is rendered but its dropdown is not responding — check the ` +
        `dashboard page script for an error. Current URL: ${this.page.url()}`
    );
  }

  /**
   * Signs the user out through the UI.
   *
   * Deliberately clicks the menu item rather than navigating to /Home/Logout:
   * hitting the URL directly would end the session without proving the control
   * a user relies on actually works.
   */
  async logout(): Promise<void> {
    this.logger.info('Logging out');
    await this.openUserMenu();
    await this.clickElement(this.logoutLink);
    await this.waitForPageLoad();
  }

  /**
   * Ends the session without asserting anything about the UI.
   *
   * For cleanup only — when a test needs the account released but the logout
   * control is not what it is testing, a failure here must not mask the real
   * result. Never use this in place of logout() in a test that checks sign-out.
   */
  async endSession(): Promise<void> {
    this.logger.info('Ending session via /Home/Logout');
    await this.page.goto('/Home/Logout', { waitUntil: 'domcontentloaded' }).catch(() => undefined);
  }

  async openChangePassword(): Promise<void> {
    await this.openUserMenu();
    await this.clickElement(this.changePasswordLink);
  }

  /** The signed-in user's name and role, as printed in the header. */
  async signedInAs(): Promise<string> {
    return (await this.userAvatar.textContent().catch(() => ''))?.trim().replace(/\s+/g, ' ') ?? '';
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
  /**
   * Asserts the browser is on an authenticated dashboard.
   *
   * Hard assertions, not soft. These previously used expect.soft, which does not
   * stop the test — so a login that never reached the dashboard carried on into
   * whatever came next and failed there instead, reporting "the avatar was not
   * found" for what was actually "the sign-in did not complete". The first
   * assertion to fail should be the one that names the problem.
   */
  async assertDashboardLoaded(): Promise<void> {
    await expect(this.page, 'still on the login page — sign-in did not complete')
      .not.toHaveURL(/Login/i);
    await expect(this.sidebarMenu, 'the dashboard sidebar never rendered').toBeVisible();
    await expect(this.userAvatar, 'the header user menu never rendered').toBeVisible();
  }

  async assertSidebarSectionVisible(sectionName: string): Promise<void> {
    await expect(
      this.sidebarMenu.getByRole('button', { name: new RegExp(sectionName, 'i') })
    ).toBeVisible();
  }
}
