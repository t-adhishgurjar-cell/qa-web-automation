import { Page } from '@playwright/test';
import { BasePage } from './base.page';

/**
 * Role / user-type selection — /Home/UserTypeSelection.
 *
 * FleetPlus shows this between the login form and the 2FA OTP whenever an account
 * holds more than one role. Single-role accounts skip it entirely, so it is always
 * conditional. Nothing on the login page hints at it, and missing it leaves the
 * browser parked short of the dashboard — which surfaces as a missing #sidebarMenu
 * rather than as the extra step it actually is.
 *
 * The cards carry everything needed as data attributes, so no text matching:
 *   <div class="user-type-card" data-userid="228089" data-code="CUSTOMER_ADMIN"
 *        data-active="true" data-locked="false" data-loginable="true">
 *     <span class="user-type-title">Business | GT industries | Parent Admin</span>
 */

/**
 * Role codes seen in QA. Tests should name a role from here rather than repeating
 * a raw string.
 *
 * BRANCH_ADMIN is not unique on its own — an account can hold several branch roles
 * differing only by site (01_Dadri, 02_Dadri, 03_Dadri). Pass a `title` to
 * disambiguate; see RoleQuery.
 */
export const USER_TYPE_CODES = {
  PARENT_ADMIN: 'CUSTOMER_ADMIN',
  BRANCH_ADMIN: 'BRANCH_ADMIN',
} as const;

export interface RoleQuery {
  code?: string;
  title?: string | RegExp;
  userId?: string;
}

/** A bare string is a role code; an object narrows further. */
export type RoleSelector = string | RoleQuery;

export interface UserTypeRole {
  code: string;
  title: string;
  userId: string;
  active: boolean;
  locked: boolean;
  loginable: boolean;
}

export class UserTypeSelectionPage extends BasePage {
  private readonly cards = this.page.locator('.user-type-card');
  private readonly getStartedButton = this.page.locator('#btnGetStarted');

  constructor(page: Page) {
    super(page);
  }

  /**
   * True when the app has routed us to the selection step.
   *
   * Uses waitFor, not isVisible: isVisible() resolves immediately and ignores any
   * timeout it is given, so it reports "no role step" while the login POST is still
   * in flight — silently skipping the step even when it is about to appear.
   */
  async isPresent(timeout = 15_000): Promise<boolean> {
    return this.cards
      .first()
      .waitFor({ state: 'visible', timeout })
      .then(() => true)
      .catch(() => false);
  }

  /** Every role offered, including unusable ones — see selectRole(). */
  async availableRoles(): Promise<UserTypeRole[]> {
    return this.cards.evaluateAll(nodes =>
      nodes.map(node => {
        const el = node as HTMLElement;
        return {
          code: el.dataset.code ?? '',
          title: (el.querySelector('.user-type-title')?.textContent ?? '').trim(),
          userId: el.dataset.userid ?? '',
          active: el.dataset.active === 'true',
          locked: el.dataset.locked === 'true',
          loginable: el.dataset.loginable === 'true',
        };
      })
    );
  }

  /** Roles matching a query, in page order. Useful for asserting entitlements. */
  async findRoles(selector: RoleSelector): Promise<UserTypeRole[]> {
    const query: RoleQuery = typeof selector === 'string' ? { code: selector } : selector;
    const roles = await this.availableRoles();

    return roles.filter(role => {
      if (query.userId && role.userId !== query.userId) return false;
      if (query.code && role.code !== query.code) return false;
      if (query.title instanceof RegExp && !query.title.test(role.title)) return false;
      if (typeof query.title === 'string' && !role.title.toLowerCase().includes(query.title.toLowerCase())) {
        return false;
      }
      return true;
    });
  }

  /**
   * Selects a role and continues to the OTP step.
   *
   * Resolution order: the argument, then FLEETPLUS_USER_TYPE_CODE, then the first
   * usable card. A locked or non-loginable role throws by name — the app publishes
   * account state on these attributes, so reporting it here is the difference
   * between "this account is locked" and a 30-second timeout on the next page.
   */
  async selectRole(selector?: RoleSelector): Promise<UserTypeRole> {
    const roles = await this.availableRoles();
    if (roles.length === 0) {
      throw new Error('User-type selection page has no role cards to choose from.');
    }

    const wanted = selector ?? process.env.FLEETPLUS_USER_TYPE_CODE;
    let chosen: UserTypeRole | undefined;

    if (wanted) {
      const matches = await this.findRoles(wanted);
      if (matches.length === 0) {
        throw new Error(
          `No role card matched ${JSON.stringify(wanted)}. Available: ${this.describe(roles)}`
        );
      }
      // Branch roles share a code, so prefer a usable match — but keep the first
      // match otherwise, so an explicitly requested locked role still reports as
      // locked instead of silently resolving to a different branch.
      chosen = matches.find(role => role.loginable && !role.locked) ?? matches[0];
    } else {
      chosen = roles.find(role => role.loginable && !role.locked);
      if (!chosen) {
        throw new Error(
          `No usable role card — every option is locked or not loginable: ${this.describe(roles)}`
        );
      }
    }

    if (chosen.locked || !chosen.loginable) {
      throw new Error(
        `Role "${chosen.title}" (${chosen.code}) cannot be used: ` +
          `locked=${chosen.locked}, loginable=${chosen.loginable}. ` +
          `Unlock it in FleetPlus, or choose another via FLEETPLUS_USER_TYPE_CODE. ` +
          `Available: ${this.describe(roles)}`
      );
    }

    this.logger.info(`Selecting role: ${chosen.title} (${chosen.code})`);
    await this.clickElement(this.page.locator(`.user-type-card[data-userid="${chosen.userId}"]`).first());
    await this.clickElement(this.getStartedButton);
    await this.waitForPageLoad();
    return chosen;
  }

  /** Compact, log-friendly rendering used in the failure messages above. */
  describe(roles: UserTypeRole[]): string {
    return roles
      .map(r => `${r.code}${r.locked ? ' [LOCKED]' : ''}${r.loginable ? '' : ' [NOT LOGINABLE]'} "${r.title}"`)
      .join(', ');
  }
}
