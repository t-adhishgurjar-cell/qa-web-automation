import { Page } from '@playwright/test';
import { BasePage } from '../base.page';

/**
 * Add Branch — /Customer/AddBranch — and its checker, Approve Customer Branch.
 *
 * A branch is not a table of its own: it is a CustomerMaster row carrying a
 * ParentId, a BranchLocation and an IsNfoBranch flag. 53,318 of them exist, so
 * this is a well-used flow rather than an edge feature.
 *
 * ParentId is the only reliable marker. The id prefix is not: NAYAFP2812121497
 * has no parent and is itself a parent customer, so reading NAYAFP1 as "parent"
 * and NAYAFP2 as "branch" is wrong even though the sample that suggested it
 * looked consistent.
 *
 * ── Who submits decides what happens ──────────────────────────────────────
 * Per usp_InsertCustomerBranchRequestByWeb, the maker-checker only applies to
 * some makers. A Customer Admin or Parent writes to RawCustomerMaster at status
 * 108, Branch Pending for Approval, and waits. An FP Admin auto-approves: the
 * branch goes straight into CustomerMaster as Active 101, the raw row is
 * updated to Active, and a branch user is created with it.
 *
 * So a test asserting "submission must not produce an Active branch" is correct
 * for a Customer Admin and wrong for an FP Admin, which is the account this
 * suite runs as.
 *
 * ── The form reveals itself in stages ─────────────────────────────────────
 * Entering a parent customer id and blurring resolves the customer: name and
 * mobile fill in, and only then do the branch-type radios appear. The pin code
 * fills state and city the same way. So a filled abCustomerName is an honest
 * signal that the lookup succeeded — unlike the bank screen, where three
 * plausible signals all turned out to be constants.
 *
 * ── Radios are not clickable ─────────────────────────────────────────────
 * abBranchTypeFleet and abBranchTypeNonFleet are visually-hidden inputs, as
 * everywhere in this application. Clicking the input does nothing; the label
 * has to be clicked instead.
 */
export class AddBranchPage extends BasePage {
  private readonly route = '/Customer/AddBranch';
  private readonly approvalRoute = '/Customer/ApproveCustomerBranch';

  // ── Parent lookup ────────────────────────────────────────────────────────
  readonly customerId = this.page.locator('#abCustomerId');
  readonly customerName = this.page.locator('#abCustomerName');
  readonly customerMobile = this.page.locator('#abCustomerMobile');

  // ── Branch type, revealed once a parent resolves ─────────────────────────
  readonly branchTypeFleet = this.page.locator('label[for="abBranchTypeFleet"]');
  readonly branchTypeNonFleet = this.page.locator('label[for="abBranchTypeNonFleet"]');

  // ── Branch details ───────────────────────────────────────────────────────
  readonly pinCode = this.page.locator('#abPinCode');
  readonly state = this.page.locator('#abState');
  readonly city = this.page.locator('#abCity');
  readonly branchLocationCode = this.page.locator('#abBranchLocationCode');
  readonly managerName = this.page.locator('#abManagerName');
  readonly branchEmail = this.page.locator('#abBranchEmail');
  readonly address = this.page.locator('#abAddress');
  readonly managerMobile = this.page.locator('#abManagerMobile');
  readonly managerMobileOtp = this.page.locator('#abManagerMobileOtp');
  readonly generateOtpButton = this.page.locator('#abBtnGenerateMobileOtp');
  /** Only exists once the OTP has been sent; sending also relabels Generate to "Reset". */
  readonly verifyOtpButton = this.page.locator('#abBtnMobileOtpVerify');
  readonly languageSelect = this.page.locator('#abLanguageId');

  readonly submitButton = this.page.locator('#abBtnSubmit');
  readonly resetButton = this.page.locator('#abBtnReset');

  // ── Checker ──────────────────────────────────────────────────────────────
  readonly approvalParentId = this.page.locator('#acbParentCustomerId');
  readonly approvalSearch = this.page.locator('#acbBtnSearch');
  readonly approvalTable = this.page.locator('#acbTable');
  readonly approvalFilter = this.page.locator('#acbGridQuickFilter');

  constructor(page: Page) {
    super(page);
  }

  /**
   * Opens the screen, whichever of its two shapes this role gets.
   *
   * An FP Admin sees a customer selector and the branch-type choice. A Parent
   * Admin sees neither: the customer comes from the session, so the form starts
   * at the pin code. Waiting on abCustomerId alone times out for that role on a
   * page that has loaded perfectly well.
   */
  async open(): Promise<void> {
    await this.navigateTo(this.route);
    await this.page
      .locator('#abCustomerId:visible, #abPinCode:visible')
      .first()
      .waitFor({ state: 'visible', timeout: 30_000 });
  }

  /**
   * Whether this role may choose which customer the branch belongs to.
   *
   * False for a Parent Admin, and that absence is the entitlement: there is no
   * field in which to name another customer, so one cannot be reached. Worth
   * asserting directly — a permission enforced by the shape of the form is only
   * as good as the form staying that shape.
   */
  async offersCustomerSelector(): Promise<boolean> {
    return this.customerId.isVisible().catch(() => false);
  }

  async openApprovals(): Promise<void> {
    await this.navigateTo(this.approvalRoute);
    await this.approvalParentId.waitFor({ state: 'visible', timeout: 30_000 });
  }

  /**
   * Resolves a parent customer. Returns false when the id matches nobody.
   *
   * The lookup runs on blur and fills the name from the server, so a non-empty
   * name is the signal. Waiting on the branch-type radios instead would work
   * too, but the name also tells the caller *which* customer was resolved,
   * which matters when a mistyped id silently finds a different one.
   */
  async findParent(customerId: string): Promise<{ found: boolean; name: string; mobile: string }> {
    this.logger.info(`Looking up parent customer ${customerId || '(blank)'}`);
    await this.fillInput(this.customerId, customerId);
    await this.customerId.blur();
    await this.page.waitForTimeout(3_500);
    await this.dismissAnyDialog();

    const name = (await this.customerName.inputValue().catch(() => '')).trim();
    const mobile = (await this.customerMobile.inputValue().catch(() => '')).trim();
    this.logger.info(`Resolved to "${name}" / ${mobile || '(no mobile)'}`);
    return { found: name.length > 0, name, mobile };
  }

  /** True once the branch-type choice is on screen. */
  async branchTypeOffered(): Promise<boolean> {
    return this.branchTypeFleet.isVisible().catch(() => false);
  }

  async selectBranchType(type: 'Fleet' | 'NonFleet'): Promise<void> {
    const label = type === 'Fleet' ? this.branchTypeFleet : this.branchTypeNonFleet;
    await this.clickElement(label);
    await this.page.waitForTimeout(1_500);
  }

  /**
   * Fills the branch block, and returns the location code the app generated.
   *
   * State, city and the branch location code all come from the pin code —
   * abBranchLocationCode is readonly and carries a generated value in the shape
   * "01_Gautam Buddha Nagar", a sequence within the district. Trying to type
   * into it fails on "element is not editable" rather than on anything
   * meaningful, so it is read as evidence instead.
   */
  async fillBranch(details: BranchDetails): Promise<string> {
    await this.fillInput(this.pinCode, details.pinCode);
    await this.pinCode.blur();
    await this.page.waitForTimeout(3_000);

    const locationCode = (await this.branchLocationCode.inputValue().catch(() => '')).trim();
    this.logger.info(`Branch location code generated as "${locationCode}"`);

    await this.fillInput(this.managerName, details.managerName);
    await this.fillInput(this.branchEmail, details.email);
    await this.fillInput(this.address, details.address);
    await this.selectFirstRealOption('abLanguageId');
    return locationCode;
  }

  /** Picks the first option that is not the placeholder. */
  private async selectFirstRealOption(selectId: string): Promise<void> {
    const value = await this.page.evaluate((id: string) => {
      const select = document.getElementById(id) as HTMLSelectElement | null;
      if (!select) return '';
      const real = Array.from(select.options).find(o => o.value && o.value !== '0');
      if (real) select.value = real.value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
      return real?.value ?? '';
    }, selectId);
    this.logger.info(`#${selectId} set to "${value}"`);
  }

  /**
   * Verifies the branch manager's mobile.
   *
   * The OTP box is hidden until the number is sent, so its appearance is the
   * signal that the send worked. A number the application refuses leaves it
   * hidden and says so in a dialog.
   */
  async verifyManagerMobile(
    mobile: string,
    otp: string
  ): Promise<{ sent: boolean; verified: boolean; message: string }> {
    await this.fillInput(this.managerMobile, mobile);
    await this.managerMobile.blur();
    await this.page.waitForTimeout(1_500);

    const onEntry = await this.dismissAnyDialog();
    await this.clickElement(this.generateOtpButton);
    await this.page.waitForTimeout(3_000);
    const afterSend = await this.dismissAnyDialog();

    const sent = await this.managerMobileOtp
      .waitFor({ state: 'visible', timeout: 15_000 })
      .then(() => true)
      .catch(() => false);

    if (!sent) {
      return { sent: false, verified: false, message: [onEntry, afterSend].filter(Boolean).join(' | ') };
    }

    await this.fillInput(this.managerMobileOtp, otp);
    await this.page.waitForTimeout(1_000);

    // Entering the OTP is not verifying it. usp_InsertCustomerBranchRequestByWeb
    // persists IsMobileVerified, and the form refuses to submit without it:
    // "Please verify manager mobile OTP before submitting the branch request."
    // The control does not exist until the OTP has been sent.
    await this.clickElement(this.verifyOtpButton);
    await this.page.waitForTimeout(2_500);
    const afterOtp = await this.dismissAnyDialog();

    const stillOffering = await this.verifyOtpButton.isVisible().catch(() => false);
    const disabled = await this.verifyOtpButton.isDisabled().catch(() => false);
    const verified = disabled || !stillOffering;
    this.logger.info(`Manager mobile OTP ${verified ? 'verified' : 'not reported as verified'}`);

    return { sent: true, verified, message: afterOtp };
  }

  async submit(): Promise<string> {
    await this.clickElement(this.submitButton);
    await this.page.waitForTimeout(4_000);
    const message = (await this.messages()).join(' | ');
    await this.dismissAnyDialog();
    return message;
  }

  /** Whatever the screen is telling the user, including the native bubble. */
  async messages(): Promise<string[]> {
    const texts = await this.page
      .locator('.modal.show, .toast:visible, .alert:visible, .invalid-feedback:visible, .text-danger:visible')
      .allTextContents();
    const native = await this.customerId
      .evaluate((el: HTMLInputElement) => el.validationMessage || '')
      .catch(() => '');
    return [...texts, native]
      .map(t => t.replace(/\s+/g, ' ').trim())
      // Bare asterisks mark required fields and are present regardless.
      .filter(t => t.length > 3 && /[a-z]/i.test(t));
  }

  /** Closes any open modal and returns what it said. */
  async dismissAnyDialog(): Promise<string> {
    const modal = this.page.locator('.modal.show').first();
    if (!(await modal.isVisible().catch(() => false))) return '';

    const said = ((await modal.textContent()) ?? '').replace(/\s+/g, ' ').trim();
    const close = modal.locator('button.btn-close, .btn-primary, .btn-secondary').first();
    await close.click({ timeout: 5_000 }).catch(() => undefined);
    await this.page.waitForTimeout(800);
    return said;
  }

  /** Rows currently awaiting approval for a parent customer. */
  async pendingApprovals(parentCustomerId: string): Promise<string[]> {
    await this.openApprovals();
    await this.fillInput(this.approvalParentId, parentCustomerId);
    await this.clickElement(this.approvalSearch);
    await this.page.waitForTimeout(3_500);

    const rows = await this.approvalTable.locator('tbody tr').allTextContents();
    return rows.map(r => r.replace(/\s+/g, ' ').trim()).filter(Boolean);
  }
}

export interface BranchDetails {
  pinCode: string;
  managerName: string;
  email: string;
  address: string;
}
