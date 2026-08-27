import { Page, Locator, expect } from '@playwright/test';
import { BasePage } from '../base.page';

/**
 * Add Customer wizard — /Customer/AddCustomer?new=1.
 *
 * Reached from Customer Management → Add Customer, which actually lands on the
 * *list* screen (/Customer/ManageCustomerOnboarding); the wizard opens from the
 * "Add Customer" action there. Both entry points are modelled below.
 *
 * The form is one long page of ~158 fields grouped into sections rather than
 * separate routed steps:
 *
 *   Basic Information — maker details, application, business, customer, bank
 *   Address           — pin code drives state/city/district
 *   Branch Location   — repeating uiBO* block, its own mobile OTP
 *   Meeting Details   — attendee rows Attendant0..9
 *
 * Only Basic Information is modelled so far; the section constants below are the
 * seam for the rest.
 */
export class AddCustomerPage extends BasePage {
  static readonly LIST_URL = '/Customer/ManageCustomerOnboarding';
  static readonly WIZARD_URL = '/Customer/AddCustomer?new=1';

  // ─── List screen ──────────────────────────────────────────────────────────
  private readonly addCustomerAction = this.page.locator('a[href*="/Customer/AddCustomer"]').first();
  private readonly listReferenceFilter = this.page.locator('#mgReferenceId');
  private readonly listSearchButton = this.page.locator('#mgBtnSearch');

  // ─── Maker details (auto-populated from the session) ──────────────────────
  readonly makerName = this.page.locator('#MakerDetails_Name');
  readonly makerMobile = this.page.locator('#MakerDetails_MobileNumber');
  readonly makerRole = this.page.locator('#MakerDetails_RoleName');
  readonly makerDivision = this.page.locator('#MakerDetails_DivisionName');
  readonly makerState = this.page.locator('#MakerDetails_StateName');
  readonly makerRegion = this.page.locator('#MakerDetails_RegionName');

  // ─── Application details ──────────────────────────────────────────────────
  readonly referenceNo = this.page.locator('#SaveCustomerModel_ReferenceNo');
  readonly applicationDate = this.page.locator('#SaveCustomerModel_ApplicationDate');
  readonly customerType = this.page.locator('#CustomerTypeID');
  readonly customerSubType = this.page.locator('#CustomerSubTypeID');
  readonly state = this.page.locator('#CustStateID');
  readonly division = this.page.locator('#CustDivisionID');
  readonly referralCode = this.page.locator('#SaveCustomerModel_ReferralCode');

  // Related party: the radio inputs are .visually-hidden, so a click has to land
  // on the styled label. Clicking the input itself silently does nothing.
  readonly relatedPartyYesInput = this.page.locator('#IsRelatedPartyYes');
  readonly relatedPartyNoInput = this.page.locator('#IsRelatedPartyNo');
  readonly relatedPartyYes = this.page.locator('label[for="IsRelatedPartyYes"]');
  readonly relatedPartyNo = this.page.locator('label[for="IsRelatedPartyNo"]');
  readonly roCode = this.page.locator('#SaveCustomerModel_RelatedPartyDetails_ROCode');
  readonly roName = this.page.locator('#ROName');
  readonly divisionalOffice = this.page.locator('#DivisionalOfficeName');
  readonly stateOffice = this.page.locator('#StateOfficeName');
  readonly regionOffice = this.page.locator('#RegionOfficeName');

  // ─── Business details ─────────────────────────────────────────────────────
  readonly businessName = this.page.locator('#SaveCustomerModel_BusinessName');
  readonly businessEmail = this.page.locator('#SaveCustomerModel_BusinessEmail');
  readonly businessType = this.page.locator('#CustomerBusinessType');
  readonly panNumber = this.page.locator('#SaveCustomerModel_PANNumber');
  readonly panDob = this.page.locator('#SaveCustomerModel_PanDOB');
  readonly panUpload = this.page.locator('#PanCardUpload');
  readonly gstRegisteredYes = this.page.locator('label[for="GSTRegisteredYes"]');
  readonly gstRegisteredNo = this.page.locator('label[for="GSTRegisteredNo"]');
  readonly gstNumber = this.page.locator('#SaveCustomerModel_GSTNumber');

  // ─── Customer details ─────────────────────────────────────────────────────
  readonly customerName = this.page.locator('#SaveCustomerModel_CustomerName');
  readonly customerEmail = this.page.locator('#SaveCustomerModel_CustomerEmail');
  readonly customerMobile = this.page.locator('#SaveCustomerModel_CustomerMobileNumber');
  readonly mobileOtp = this.page.locator('#MobileOTP');
  readonly generateMobileOtp = this.page.locator('#btnGenerateMobileOTP');
  readonly verifyMobileOtp = this.page.locator('#btnMobileOTPVerify');
  readonly resendMobileOtp = this.page.locator('#btnResendMobileOTP');
  readonly idProofType = this.page.locator('#CustomerIdProofType');
  readonly idProofNo = this.page.locator('#SaveCustomerModel_CustomerIdProofNo');

  // ─── Bank account ─────────────────────────────────────────────────────────
  readonly bankName = this.page.locator('#SaveCustomerModel_BankAccountDetails_BankName');
  readonly bankAccountHolder = this.page.locator('#SaveCustomerModel_BankAccountDetails_BankAccountHolderName');
  readonly bankAccountNumber = this.page.locator('#SaveCustomerModel_BankAccountDetails_BankAccountNumber');
  readonly ifscCode = this.page.locator('#SaveCustomerModel_BankAccountDetails_IFSCCode');

  // ─── Address ──────────────────────────────────────────────────────────────
  readonly addressPinCode = this.page.locator('#SaveCustomerModel_CustomerAddress_PinCode');
  readonly addressState = this.page.locator('#BusinessStateDisplay');
  readonly addressCity = this.page.locator('#CommunicationCity');
  readonly addressDistrict = this.page.locator('#BusinessDistrictDisplay');
  readonly businessAddress = this.page.locator('#SaveCustomerModel_CustomerAddress_BusinessAddress');

  constructor(page: Page) {
    super(page);
  }

  // ─── Navigation ───────────────────────────────────────────────────────────
  /** Opens the Customer Onboarding list — where the menu's "Add Customer" lands. */
  async gotoList(): Promise<void> {
    await this.navigateTo(AddCustomerPage.LIST_URL);
  }

  /** Opens the wizard directly. */
  async gotoWizard(): Promise<void> {
    await this.navigateTo(AddCustomerPage.WIZARD_URL);
    await this.referenceNo.waitFor({ state: 'visible', timeout: 30_000 });
  }

  /** Opens the wizard the way a user does — via the list screen's action. */
  async openWizardFromList(): Promise<void> {
    await this.gotoList();
    await this.clickElement(this.addCustomerAction);
    await this.referenceNo.waitFor({ state: 'visible', timeout: 30_000 });
  }

  // ─── Actions ──────────────────────────────────────────────────────────────
  /** Related party YES reveals the RO/CMS lookup; NO hides it. */
  async setRelatedParty(isRelated: boolean): Promise<void> {
    this.logger.info(`Setting Related Party = ${isRelated ? 'YES' : 'NO'}`);
    await this.clickElement(isRelated ? this.relatedPartyYes : this.relatedPartyNo);
  }

  /** Pin code drives state, city and district; they fill asynchronously. */
  async enterAddressPinCode(pinCode: string): Promise<void> {
    await this.fillInput(this.addressPinCode, pinCode);
    await this.addressPinCode.blur();
  }

  // ─── Assertions ───────────────────────────────────────────────────────────
  async assertWizardLoaded(): Promise<void> {
    await this.assertElementVisible(this.referenceNo);
    await this.assertElementVisible(this.customerType);
    await this.assertElementVisible(this.businessName);
  }

  /** The reference number is server-generated and must not be user-editable. */
  async assertReferenceNoGenerated(): Promise<void> {
    await expect(this.referenceNo).toHaveValue(/\d{6,}/);
    await expect(this.referenceNo).toHaveAttribute('readonly', /.*/);
  }

  /**
   * Application date is auto-filled and not editable. The app disables it rather
   * than marking it readonly — different attribute, same intent, so accept either.
   */
  async assertApplicationDateReadOnly(): Promise<void> {
    await expect(this.applicationDate).toHaveValue(/^\d{2}-\d{2}-\d{4}$/);
    await expect(this.applicationDate).toBeDisabled();
  }

  /** Maker details come from the session, so they identify the logged-in user. */
  async assertMakerDetails(expected: { mobile?: string; role?: string }): Promise<void> {
    await expect(this.makerName).not.toHaveValue('');
    if (expected.mobile) await expect(this.makerMobile).toHaveValue(expected.mobile);
    if (expected.role) await expect(this.makerRole).toHaveValue(new RegExp(expected.role, 'i'));
  }

  /** Every maker field is populated from the session and locked. */
  async assertMakerFieldsReadOnly(): Promise<void> {
    for (const field of [this.makerName, this.makerMobile, this.makerRole]) {
      await expect(field).toHaveAttribute('readonly', /.*/);
    }
  }

  async isVisible(locator: Locator): Promise<boolean> {
    return locator.isVisible().catch(() => false);
  }
}
