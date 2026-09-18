import { Page } from '@playwright/test';
import { BasePage } from '../base.page';

/**
 * /Vehicle/AddVehicles — manual entry.
 *
 * ── The form is a different shape per role ────────────────────────────────
 * A customer admin picks from #avBranchLocation, a dropdown of its OWN branches,
 * so it is scoped by construction and cannot name anyone else's customer. A
 * Nayara officer gets #CustomerId, free text, "Enter Branch UID" — and
 * /Customer/GetFormName resolves a customer in any geography without complaint.
 *
 * Both are modelled: `customer()` uses whichever the page offers.
 *
 * ── The flow ──────────────────────────────────────────────────────────────
 *   name the customer  ->  #CustomerName fills in from the server
 *   #NoOfCards         ->  how many vehicle rows to render
 *   #btnAdd            ->  renders #VehicleNo_1 … _N, and locks #CustomerId
 *   #btnVerify_n       ->  Vahan check for that row
 *   #btnsubmit         ->  submit all rows
 *
 * ── Vahan failure is the interesting path, not an error ───────────────────
 * A de-registered registration answers vahanStatus 405 "Verification Failed",
 * and AddVehicle still returns "Vehicle has been submitted for approval". That
 * is the whole point: a failed verification is what routes a vehicle to the
 * approval queue. Callers wanting a queued vehicle should pass a registration
 * that cannot verify — test-data holds a list of de-registered ones.
 *
 * #ddlVehicleType is disabled at "Registered" with no other option, so nothing
 * added here is ever generic.
 */
export interface AddVehicleResult {
  submitted: boolean;
  /** vahanStatus from /Vehicle/VerifyVehicleNumber, 405 = Verification Failed. */
  vahanStatus: number | null;
  message: string;
}

export class AddVehiclePage extends BasePage {
  readonly customerId = this.page.locator('#CustomerId');
  readonly branchLocation = this.page.locator('#avBranchLocation');
  readonly customerName = this.page.locator('#CustomerName');
  readonly numberOfVehicles = this.page.locator('#NoOfCards');
  readonly addButton = this.page.locator('#btnAdd');
  readonly submitButton = this.page.locator('#btnsubmit');

  constructor(page: Page) {
    super(page);
  }

  async open(): Promise<void> {
    await this.navigateTo('/Vehicle/AddVehicles');
    await this.page.waitForTimeout(2_500);
  }

  /**
   * Names the customer, whichever control this role is given, and returns the
   * customer name the server resolved. An empty string means it declined.
   */
  async chooseCustomer(uid: string): Promise<string> {
    if (await this.customerId.isVisible().catch(() => false)) {
      await this.fillInput(this.customerId, uid);
      await this.customerId.blur();
    } else if (await this.branchLocation.isVisible().catch(() => false)) {
      // The dropdown's options read "UID || BRANCH NAME".
      await this.branchLocation.selectOption({ label: new RegExp(uid, 'i') as unknown as string })
        .catch(async () => {
          const value = await this.branchLocation.evaluate((sel, wanted) => {
            const s = sel as HTMLSelectElement;
            const hit = Array.from(s.options).find(o => o.text.includes(wanted));
            return hit ? hit.value : '';
          }, uid);
          if (value) await this.branchLocation.selectOption(value);
        });
    } else {
      throw new Error(
        'Add Vehicles offered neither #CustomerId nor #avBranchLocation. ' +
          'This role may not be entitled to the screen at all.'
      );
    }

    await this.page.waitForTimeout(3_500);
    return ((await this.customerName.inputValue().catch(() => '')) ?? '').trim();
  }

  /**
   * Adds one vehicle and reports what Vahan and the server said.
   *
   * The Vahan verdict is captured from the response rather than the screen,
   * because a failed verification renders much like a successful one.
   */
  async addOne(registration: string, ownership = 'Owned'): Promise<AddVehicleResult> {
    await this.fillInput(this.numberOfVehicles, '1');
    await this.page.waitForTimeout(600);
    await this.clickElement(this.addButton);
    await this.page.waitForTimeout(3_000);

    await this.fillInput(this.page.locator('#VehicleNo_1'), registration);

    const verdict = this.page
      .waitForResponse(r => /VerifyVehicleNumber/i.test(r.url()), { timeout: 30_000 })
      .catch(() => null);
    await this.clickElement(this.page.locator('#btnVerify_1'));
    const response = await verdict;
    const body = response ? await response.json().catch(() => null) : null;
    const vahanStatus = body ? Number(body.vahanStatus) : null;
    this.logger.info(`Vahan for ${registration}: ${vahanStatus} ${body?.vahanStatusName ?? ''}`);

    await this.page.waitForTimeout(2_500);
    await this.dismissModals();

    // Only fill what Vahan left blank and the form still allows.
    for (const [selector, value] of [['#VehicleType_1', 'Diesel'], ['#TankSize_1', '50']] as const) {
      const field = this.page.locator(selector);
      if (!(await field.isEditable().catch(() => false))) continue;
      if (((await field.inputValue().catch(() => '')) ?? '').trim()) continue;
      await field.fill(value).catch(() => undefined);
    }
    await this.page.locator('#Ownership_1')
      .selectOption({ label: ownership })
      .catch(async () => { await this.page.locator('#Ownership_1').selectOption({ index: 1 }).catch(() => undefined); });

    const submitted = this.page
      .waitForResponse(r => /\/Vehicle\/AddVehicle\b/i.test(r.url()), { timeout: 30_000 })
      .catch(() => null);
    await this.clickElement(this.submitButton);
    const addResponse = await submitted;
    const addBody = addResponse ? await addResponse.json().catch(() => null) : null;

    await this.page.waitForTimeout(3_000);
    const shown = await this.dismissModals();

    return {
      submitted: Number(addBody?.statusCode) === 1,
      vahanStatus,
      message: (addBody?.message ?? shown ?? '').toString().trim(),
    };
  }

  /** Closes any modals and returns the first one's text. */
  private async dismissModals(): Promise<string> {
    let first = '';
    for (let i = 0; i < 4; i += 1) {
      const modal = this.page.locator('.modal.show').first();
      if (!(await modal.isVisible().catch(() => false))) break;
      const said = ((await modal.textContent()) ?? '').replace(/\s+/g, ' ').trim();
      if (!first) first = said;
      const ok = modal
        .locator('button:visible, a:visible')
        .filter({ hasText: /^\s*(ok|yes|confirm|proceed|continue)\s*$/i })
        .first();
      if (!(await ok.isVisible().catch(() => false))) break;
      await ok.click({ timeout: 8_000 }).catch(() => undefined);
      await this.page.waitForTimeout(2_000);
    }
    return first;
  }
}
