import { Page, Locator } from '@playwright/test';
import { BasePage } from '../base.page';

/**
 * The Vehicle Management screens the regression suite exercises.
 *
 * One page object rather than six, because they are the same screen six times:
 * a search box, a Search button, and a grid whose rows carry the action. Only
 * the control ids and the action differ, and splitting them would produce six
 * classes with one distinct line each.
 *
 *   Block/Unblock   /Vehicle/VehicleBlockUnblock    #txtVehicleNo
 *   Transfer        /Vehicle/TransferVehicle        #tvVehicleNo
 *   De-map          /Vehicle/DeMapVehicle           #dmVehicleNo
 *   Manage          /Vehicle/ManageVehicles         #vehicleNoVal
 *   Authentication  /Vehicle/VehicleAuthentication  #vaVehicleNo
 *   Purchase limit  /Vehicle/SetVehiclePrepaidLimit #VehicleNo
 *
 * ── The branch selector is a permission ───────────────────────────────────
 * #mvBranchLocation on Block/Unblock is present for a parent admin and absent
 * for a branch admin — that absence is what confines a branch admin to its own
 * branch, and role-scope.spec.ts asserts it. Nothing here should fill it
 * blindly: doing so would make a parent-admin run silently scope itself to one
 * branch and a branch-admin run fail on a missing field.
 */
export class ManageVehiclePage extends BasePage {
  static readonly ROUTES = {
    blockUnblock: '/Vehicle/VehicleBlockUnblock',
    transfer: '/Vehicle/TransferVehicle',
    demap: '/Vehicle/DeMapVehicle',
    manage: '/Vehicle/ManageVehicles',
    authentication: '/Vehicle/VehicleAuthentication',
    purchaseLimit: '/Vehicle/SetVehiclePrepaidLimit',
  } as const;

  // ── Block / Unblock ──────────────────────────────────────────────────────
  readonly blockVehicleNo = this.page.locator('#txtVehicleNo');
  readonly blockSearch = this.page.locator('#btnVehicleBlockSearch');
  readonly branchLocation = this.page.locator('#mvBranchLocation');

  // ── Transfer ─────────────────────────────────────────────────────────────
  readonly transferVehicleNo = this.page.locator('#tvVehicleNo');
  readonly transferCustomerId = this.page.locator('#tvSearchCustomerId');
  readonly transferBranch = this.page.locator('#tvSearchBranch');
  readonly transferSearch = this.page.locator('#btnTransferGridSearch');

  // ── De-map ───────────────────────────────────────────────────────────────
  readonly demapVehicleNo = this.page.locator('#dmVehicleNo');
  readonly demapSearch = this.page.locator('#btnDeMapSearch');

  // ── Manage ───────────────────────────────────────────────────────────────
  readonly manageCustomerId = this.page.locator('#GetCustomerIdValue');
  readonly manageVehicleNo = this.page.locator('#vehicleNoVal');
  readonly manageSearch = this.page.locator('#btnManageVehiclesSearch');
  readonly manageGrid = this.page.locator('#VehicleSearchTbl');

  // ── Authentication ───────────────────────────────────────────────────────
  readonly authVehicleNo = this.page.locator('#vaVehicleNo');
  readonly authCustomerId = this.page.locator('#vaCustomerId');
  readonly authSearch = this.page.locator('#btnVehicleAuthSearch');

  // ── Purchase limit ───────────────────────────────────────────────────────
  readonly limitCustomerId = this.page.locator('#CustomerId');
  readonly limitVehicleNo = this.page.locator('#VehicleNo');
  readonly limitSearch = this.page.locator('#btnSearch');

  constructor(page: Page) {
    super(page);
  }

  async open(screen: keyof typeof ManageVehiclePage.ROUTES): Promise<void> {
    await this.navigateTo(ManageVehiclePage.ROUTES[screen]);
    await this.page.waitForTimeout(2_500);
    await this.dismissDialog();
  }

  /**
   * Searches one screen for a registration and returns the rows it found.
   *
   * Returns rows rather than a boolean: "not found" and "found but showing the
   * wrong vehicle" are different failures, and only the row text distinguishes
   * them. The grid's empty state is a row too — "No data" — so it is filtered
   * out here rather than counted as a result.
   */
  async search(field: Locator, button: Locator, registration: string): Promise<string[]> {
    await this.fillInput(field, registration);
    await this.clickElement(button);
    await this.page.waitForTimeout(3_500);
    await this.dismissDialog();

    const rows = await this.page.locator('tbody tr:visible').allTextContents();
    return rows
      .map(r => r.replace(/\s+/g, ' ').trim())
      .filter(r => r.length > 0 && !/^no (data|record|matching)/i.test(r));
  }

  /**
   * Flips a vehicle's status toggle on the Block/Unblock grid.
   *
   * The action is not a link or a button, which is what made it invisible to a
   * search for either. It is a Bootstrap switch in the row's last column:
   *
   *   <input class="form-check-input toggle-status" type="checkbox" checked
   *          data-id="190272" data-vno="UP15FB0662" data-cid="NAYAFP2023400247">
   *
   * checked means Active, so blocking is unchecking it. The switch carries the
   * registration in data-vno, which is a better handle than the row position —
   * a grid showing a whole fleet reorders on sort, and acting on the wrong row
   * blocks somebody else's vehicle.
   *
   * Returns what the confirmation said. The toggle posts and the grid redraws,
   * so the caller should verify the status in the database rather than trusting
   * the switch's new position: the control flips optimistically whether or not
   * the server agreed.
   */
  async toggleVehicleStatus(registration: string): Promise<{ wasActive: boolean; message: string }> {
    const toggle = this.page.locator(`input.toggle-status[data-vno="${registration}"]`).first();
    await toggle.waitFor({ state: 'visible', timeout: 15_000 });

    const wasActive = await toggle.isChecked();
    this.logger.info(
      `${registration} toggle is ${wasActive ? 'on (Active)' : 'off (Blocked)'}; flipping it.`
    );

    // click() rather than check()/uncheck(): those assert the resulting state,
    // and this control's state is decided by the server's answer, not by the
    // click. A refused change would fail as "checkbox did not become checked"
    // rather than as the status assertion the test actually cares about.
    await toggle.click({ timeout: 10_000 });
    await this.page.waitForTimeout(2_000);

    return { wasActive, message: await this.completeStatusChange(registration, wasActive) };
  }

  /**
   * Completes the Block / Unblock modal the toggle raises.
   *
   *   Block Vehicle
   *   Vehicle: UP15FB0662
   *   Reason *            <- required, and the dialog will not submit without it
   *   [Cancel] [Block]
   *
   * Two things here are easy to get wrong. The confirming button is labelled
   * for the action — "Block", "Unblock" — not "OK" or "Confirm", so a generic
   * affirmative match finds nothing and the modal simply sits there while the
   * test concludes the feature is broken. And the Reason is mandatory: leaving
   * it empty makes the button inert with no message, which reads the same way.
   */
  private async completeStatusChange(registration: string, wasActive: boolean): Promise<string> {
    const modal = this.page.locator('.modal.show').first();
    if (!(await modal.isVisible().catch(() => false))) return '';

    const said = ((await modal.textContent()) ?? '').replace(/\s+/g, ' ').trim();

    // Run-tagged so the reason names what wrote it. This text lands in the
    // vehicle's Remarks and is visible to whoever works this fleet.
    const reason = modal.locator('textarea:visible, input[type="text"]:visible').first();
    if (await reason.isVisible().catch(() => false)) {
      await reason.fill(
        `Automated regression ${wasActive ? 'block' : 'unblock'} of ${registration} — W-VEH-00${wasActive ? '1' : '2'}`
      );
      await this.page.waitForTimeout(500);
    }

    const confirm = modal
      .locator('button:visible')
      .filter({ hasText: /^(block|unblock|activate|deactivate|confirm|ok|yes|submit)$/i })
      .filter({ hasNotText: /cancel|close/i })
      .first();

    if (!(await confirm.isVisible().catch(() => false))) {
      const offered = await modal.locator('button:visible').allTextContents();
      throw new Error(
        `The ${wasActive ? 'block' : 'unblock'} dialog for ${registration} offers ` +
          `no confirming button. It said: "${said}" and offers: ` +
          `${offered.map(o => o.trim()).filter(Boolean).join(', ')}.`
      );
    }

    await confirm.click({ timeout: 10_000 });
    await this.page.waitForTimeout(3_000);

    const outcome = await this.dismissDialog();
    return outcome || said;
  }

  /**
   * Clicks a row action by its label.
   *
   * These are links styled as buttons in some grids and real buttons in others,
   * so both are matched. Scoped to the row containing the registration: an
   * unscoped match would act on whichever row happened to be first, which on a
   * grid showing a whole customer's fleet is somebody else's vehicle.
   */
  async rowAction(registration: string, action: RegExp): Promise<string> {
    const row = this.page.locator('tbody tr', { hasText: registration }).first();
    await row.waitFor({ state: 'visible', timeout: 15_000 });

    const control = row.locator('a:visible, button:visible').filter({ hasText: action }).first();
    if (!(await control.isVisible().catch(() => false))) {
      const offered = await row.locator('a:visible, button:visible').allTextContents();
      throw new Error(
        `No "${action.source}" action on the row for ${registration}. ` +
          `That row offers: ${offered.map(o => o.trim()).filter(Boolean).join(', ') || '(nothing)'}. ` +
          `The action a row offers depends on the vehicle's current status, so ` +
          `check the vehicle is in the state this test assumes.`
      );
    }

    await control.click({ timeout: 10_000 });
    await this.page.waitForTimeout(2_500);
    return this.confirmAndRead();
  }

  /**
   * Confirms a modal if one appears, and returns whatever it said.
   *
   * These actions ask "are you sure?" before acting, and an unanswered dialog
   * leaves the vehicle untouched while the test carries on believing it acted —
   * the failure then surfaces as a status that never changed.
   */
  async confirmAndRead(): Promise<string> {
    const modal = this.page.locator('.modal.show').first();
    if (!(await modal.isVisible().catch(() => false))) return '';

    const said = ((await modal.textContent()) ?? '').replace(/\s+/g, ' ').trim();

    const confirm = modal
      .locator('button:visible')
      .filter({ hasText: /^(ok|yes|confirm|proceed|submit)$/i })
      .first();

    if (await confirm.isVisible().catch(() => false)) {
      await confirm.click({ timeout: 10_000 }).catch(() => undefined);
      await this.page.waitForTimeout(3_000);
      // Acting often raises a second modal reporting the outcome.
      const outcome = await this.dismissDialog();
      return outcome || said;
    }

    await this.dismissDialog();
    return said;
  }

  /**
   * Searches Prepaid Authentication and reads the panel it returns.
   *
   * Not a grid. This screen answers with a detail panel — authentication type,
   * OTP SPOC and that SPOC's mobile — so looking for table rows finds nothing
   * and reports a screen that worked perfectly as having found no vehicle. The
   * populated SPOC is the honest signal that the lookup resolved.
   */
  async searchAuthentication(
    registration: string,
    customerId: string
  ): Promise<{ resolved: boolean; authType: string; spoc: string; spocMobile: string }> {
    // The customer id is filled by the application for a role that owns exactly
    // one customer, and rendered readonly — so a blind fill fails on
    // "locator.clear: Timeout exceeded", which names the call rather than the
    // reason. Only filled when the field is actually editable, which is the
    // case for roles that serve more than one customer.
    const editable = await this.authCustomerId
      .isEditable()
      .catch(() => false);

    if (editable) {
      await this.fillInput(this.authCustomerId, customerId);
    } else {
      const already = await this.authCustomerId.inputValue().catch(() => '');
      this.logger.info(`Customer id is readonly here and already holds "${already}".`);
    }

    await this.fillInput(this.authVehicleNo, registration);
    // The vehicle field is an autocomplete and its suggestion list overlays the
    // Search button, swallowing the click.
    await this.page.keyboard.press('Escape');
    await this.clickElement(this.authSearch);
    await this.page.waitForTimeout(3_500);
    await this.dismissDialog();

    return this.page.evaluate(() => {
      const value = (selector: string) => {
        const el = document.querySelector(selector) as HTMLInputElement | null;
        return (el?.value || el?.textContent || '').trim();
      };
      const labelled = (label: RegExp) => {
        const node = Array.from(document.querySelectorAll('label, .form-label')).find(l =>
          label.test((l.textContent || '').trim())
        );
        if (!node) return '';
        const holder = node.parentElement;
        const input = holder?.querySelector('input, select, textarea') as HTMLInputElement | null;
        return (input?.value || '').trim();
      };

      const spoc = labelled(/^OTP SPOC$/i);
      const spocMobile = labelled(/OTP SPOC Mobile/i);
      const checked = document.querySelector(
        'input[type=radio]:checked'
      ) as HTMLInputElement | null;

      return {
        resolved: !!(spoc || spocMobile),
        authType: checked ? (checked.closest('div')?.textContent || '').replace(/\s+/g, ' ').trim() : '',
        spoc,
        spocMobile,
        _unused: value('#vaVehicleNo'),
      };
    });
  }

  /**
   * Chooses the customer on Set Vehicle Purchase Limits.
   *
   * #CustomerId is a <select> here, not the text input it is on every other
   * vehicle screen — the module walk records inputs and selects together, so
   * both look alike in that data. Filling it fails on "Element is not an
   * <input>, <textarea> or [contenteditable]", which is accurate and says
   * nothing about what to do instead.
   *
   * Matched on the option text containing the customer code, because these
   * lists label options "NAYAFP2023400247 || 01_GAUTAMBUDDHANAGAR" rather than
   * by code alone — an exact-value match finds nothing.
   */
  async chooseLimitCustomer(customerId: string): Promise<string> {
    const chosen = await this.page.evaluate((code: string) => {
      const sel = document.getElementById('CustomerId') as HTMLSelectElement | null;
      if (!sel) return '';
      const option = Array.from(sel.options).find(o => o.text.includes(code) || o.value === code);
      if (!option) {
        return `__MISSING__${Array.from(sel.options).map(o => o.text.trim()).slice(0, 12).join(' | ')}`;
      }
      sel.value = option.value;
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      return option.text.trim();
    }, customerId);

    if (chosen.startsWith('__MISSING__')) {
      throw new Error(
        `Set Vehicle Purchase Limits offers no customer matching ${customerId}. ` +
          `It offers: ${chosen.replace('__MISSING__', '')}. This role may be ` +
          `scoped to different branches than the vehicle belongs to.`
      );
    }

    this.logger.info(`Purchase-limit customer set to "${chosen}"`);
    await this.page.waitForTimeout(1_500);
    return chosen;
  }

  /** Closes any open modal and returns its text. */
  async dismissDialog(): Promise<string> {
    const modal = this.page.locator('.modal.show').first();
    if (!(await modal.isVisible().catch(() => false))) return '';

    const said = ((await modal.textContent()) ?? '').replace(/\s+/g, ' ').trim();
    await modal
      .locator('button.btn-close, button:has-text("OK"), .btn-primary')
      .first()
      .click({ timeout: 5_000 })
      .catch(() => undefined);
    await this.page.waitForTimeout(1_000);
    return said;
  }
}
