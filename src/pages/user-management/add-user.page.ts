import { Page, expect } from '@playwright/test';
import { BasePage } from '../base.page';

/**
 * Add User — /User/AddUser, reached from Manage Users.
 *
 * Four things about this screen are not guessable from its markup, and each one
 * silently breaks a test that does not know about it:
 *
 * 1. Direct navigation to /User/AddUser renders the form *without its action
 *    footer* — #btnAdd is simply absent. The buttons only exist when the page is
 *    reached by clicking through from /User/UserDetails. Same behaviour as the
 *    Add Customer wizard, so it is a pattern in this application, not a one-off.
 *
 * 2. The user-type dropdown offers five of the thirteen codes in
 *    UserTypesMaster: FP_ADMIN, HO_ADMIN, HO, OTHER_NON, OTHER_NAYARA. The rest
 *    — including CUSTOMER_ADMIN and BRANCH_ADMIN, 83% of all users — are created
 *    by other means entirely.
 *
 * 3. Choosing FP_ADMIN or HO_ADMIN auto-fills SelectedRoleIds; HO, OTHER_NAYARA
 *    and OTHER_NON leave it empty. With it empty, clicking Add does *nothing*:
 *    no request, no message, no disabled state. The form is inert and the user
 *    is told nothing. selectUserType() picks a role when the app does not.
 *
 * 4. Submission is not one step for every type. FP_ADMIN, HO_ADMIN and HO are
 *    accepted or refused immediately; OTHER_NAYARA and OTHER_NON redirect to
 *    User Location Mapping with userId=0 and are only created once that second
 *    step is submitted — which is also where their conflict check surfaces.
 */

/** Every code the dropdown actually offers, confirmed against QA. */
export const SELECTABLE_USER_TYPES = [
  'FP_ADMIN',
  'HO_ADMIN',
  'HO',
  'OTHER_NON',
  'OTHER_NAYARA',
] as const;

export type SelectableUserType = (typeof SELECTABLE_USER_TYPES)[number];

/** The wording every conflict now returns, whichever of the three checks fired. */
export const MOBILE_ALREADY_REGISTERED = /this mobile number is already registered/i;

export interface NewUser {
  mobile: string;
  firstName: string;
  lastName: string;
  email: string;
  userType: SelectableUserType;
}

export interface CreateOutcome {
  created: boolean;
  /** Message the app showed, or '' when it showed none. */
  message: string;
  /** Where the flow ended, so a deferred second step is visible in the report. */
  finalUrl: string;
  /** True when step one handed off to User Location Mapping. */
  wentToLocationMapping: boolean;
}

export class AddUserPage extends BasePage {
  // ─── Manage Users list ────────────────────────────────────────────────────
  private readonly addUserLink = this.page.locator('a[href="/User/AddUser"]');

  // ─── Form ─────────────────────────────────────────────────────────────────
  readonly mobile = this.page.locator('#Mobile');
  readonly firstName = this.page.locator('#FirstName');
  readonly lastName = this.page.locator('#LastName');
  readonly email = this.page.locator('#Email');
  readonly userType = this.page.locator('#ddlUserType');
  readonly roleSelect = this.page.locator('#InlineRoleIds');
  readonly addButton = this.page.locator('#btnAdd');

  /** Hidden, and the field the form actually posts. See note 3 above. */
  readonly selectedRoleIds = this.page.locator('#SelectedRoleIds');
  readonly selectedUserTypeId = this.page.locator('#SelectedUserTypeId');

  // ─── Location mapping (step two, for some types) ──────────────────────────
  readonly locationTree = this.page.locator('div.ulm-location-tree');
  readonly regionNodes = this.page.locator('div.location-node[data-type="region"]');
  readonly saveLocationButton = this.page.locator('#saveChangesBtn');

  // ─── Outcome surfaces ─────────────────────────────────────────────────────
  private readonly activeModal = this.page.locator('.modal.show');

  constructor(page: Page) {
    super(page);
  }

  // ─── Navigation ───────────────────────────────────────────────────────────
  async gotoList(): Promise<void> {
    await this.navigateTo('/User/UserDetails');
    await this.addUserLink.waitFor({ state: 'visible', timeout: 30_000 });
  }

  /**
   * Opens the form through the list, which is the only way its footer renders.
   *
   * Deliberately does not accept a URL — going straight there is the mistake this
   * method exists to prevent.
   */
  async open(): Promise<void> {
    await this.gotoList();
    await this.clickElement(this.addUserLink);
    await this.addButton.waitFor({ state: 'visible', timeout: 30_000 });
  }

  // ─── Filling ──────────────────────────────────────────────────────────────
  /**
   * Types the mobile and waits for the app's lookup to settle.
   *
   * Entering a known mobile fires POST /User/GetUserbyMobileNo, which prefills
   * the name and email of whoever holds it. Those prefills must be left alone —
   * overwriting them changes what is being submitted.
   */
  async enterMobile(mobile: string): Promise<void> {
    await this.mobile.fill('');
    await this.mobile.pressSequentially(mobile, { delay: 20 });
    await this.mobile.blur();
    // The lookup is a network round trip; acting before it lands races the prefill.
    await this.page.waitForTimeout(2_500);
  }

  /** Fills the identity fields, leaving anything the lookup prefilled intact. */
  async fillIdentity(user: NewUser): Promise<void> {
    if (!(await this.firstName.inputValue())) await this.firstName.fill(user.firstName);
    if (!(await this.lastName.inputValue())) await this.lastName.fill(user.lastName);
    if (!(await this.email.inputValue())) await this.email.fill(user.email);
  }

  /**
   * Selects the user type, and a role if the app did not choose one.
   *
   * See note 3: without a role the Add button is inert and reports nothing, so a
   * test that skipped this would read as "the app did not respond".
   */
  async selectUserType(type: SelectableUserType): Promise<void> {
    await this.userType.selectOption(type);
    await this.page.waitForTimeout(1_500);

    if (await this.selectedRoleIds.inputValue()) return;

    const role = await this.roleSelect.evaluate((select: HTMLSelectElement) => {
      const option = Array.from(select.options).find(o => o.value && o.value !== '0');
      return option ? option.value : null;
    });

    if (!role) {
      throw new Error(
        `No role could be selected for ${type}, and the app did not default one. ` +
          `The Add button will do nothing in this state.`
      );
    }

    this.logger.info(`App left SelectedRoleIds empty for ${type}; choosing role ${role}`);
    await this.roleSelect.selectOption(role);
    await expect(this.selectedRoleIds, 'selecting a role did not populate SelectedRoleIds')
      .not.toHaveValue('');
  }

  // ─── Submitting ───────────────────────────────────────────────────────────
  /**
   * Submits the form and reports the outcome, following the second step when the
   * app defers creation to location mapping.
   *
   * Returns rather than asserts: both "created" and "refused" are legitimate
   * results depending on the matrix cell under test, and the caller decides which
   * one it expected.
   */
  async submit(): Promise<CreateOutcome> {
    const responses: string[] = [];
    const collect = async (response: { url(): string; request(): { method(): string } }): Promise<void> => {
      if (response.request().method() !== 'POST') return;
      if (!/\/User\/(AddUser|InsertUserLocationMapping)/i.test(response.url())) return;
      try {
        responses.push(await (response as unknown as { text(): Promise<string> }).text());
      } catch {
        // The page navigated before the body could be read — a redirect, which
        // for this form means the flow moved on rather than answered.
        responses.push('');
      }
    };
    this.page.on('response', collect);

    try {
      await this.clickElement(this.addButton);
      await this.page.waitForTimeout(5_000);

      let wentToLocationMapping = /UserLocationMapping/i.test(this.page.url());
      if (wentToLocationMapping) {
        this.logger.info('Step one handed off to User Location Mapping; completing step two');
        await this.completeLocationMapping();
      }

      const message = await this.outcomeMessage(responses);
      const created = responses.some(body => /"status"\s*:\s*1|"success"\s*:\s*true/i.test(body));

      return { created, message, finalUrl: this.page.url(), wentToLocationMapping };
    } finally {
      this.page.off('response', collect);
    }
  }

  /** Assigns a regional scope and submits the second step. */
  private async completeLocationMapping(): Promise<void> {
    await this.dismissSessionPrompts();
    await this.regionNodes.first().waitFor({ state: 'visible', timeout: 20_000 });
    await this.regionNodes.first().locator('div.d-flex').first().click();
    await this.page.waitForTimeout(1_200);
    await this.clickElement(this.saveLocationButton);
    await this.page.waitForTimeout(5_000);
  }

  /**
   * Clears "already open in another tab" prompts.
   *
   * They cover the location page and make everything on it unreachable, and they
   * appear readily because each test run leaves a session behind.
   */
  private async dismissSessionPrompts(): Promise<void> {
    for (const selector of [
      '#nayara-single-tab-takeover',
      '#nayara-profile-tab-continue-btn',
      '#profile-active-session-ok-btn',
    ]) {
      const button = this.page.locator(selector);
      if (await button.isVisible().catch(() => false)) {
        this.logger.info(`Dismissing ${selector}`);
        await button.click().catch(() => undefined);
        await this.page.waitForTimeout(2_500);
      }
    }
  }

  /** The message the app showed, preferring the server's own wording. */
  private async outcomeMessage(responses: string[]): Promise<string> {
    for (const body of responses) {
      const match = body.match(/"message"\s*:\s*"([^"]+)"/);
      if (match) return match[1];
    }
    if (await this.activeModal.first().isVisible().catch(() => false)) {
      return ((await this.activeModal.first().textContent()) ?? '').replace(/\s+/g, ' ').trim();
    }
    return '';
  }

  /** The codes the dropdown offers, read from the page rather than assumed. */
  async offeredUserTypes(): Promise<string[]> {
    return this.userType.evaluate((select: HTMLSelectElement) =>
      Array.from(select.options).map(o => o.value).filter(Boolean)
    );
  }
}
