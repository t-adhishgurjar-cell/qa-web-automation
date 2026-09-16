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

  // ─── Footer controls ──────────────────────────────────────────────────────
  readonly saveAsDraftButton = this.page.locator('#firstSavebtn');
  readonly tab1NextButton = this.page.locator('#btnTab1Next');
  readonly addressNextButton = this.page.locator('#btnShowOfficialDetails');
  readonly branchNextButton = this.page.locator('#btnShowMeetingDetails');
  readonly saveBranchButton = this.page.locator('#btnAddBOLocation');
  readonly addAnotherBranchButton = this.page.locator('#btnRevealBoDraft');
  readonly submitButton = this.page.locator('#btnAdd');

  /**
   * The confirmation the app shows on a successful submit.
   *
   * The wizard does *not* navigate away or hide its Submit button — it stays put
   * and raises this dialog over the top. Asserting that the button disappears
   * therefore fails on a submission that in fact succeeded.
   */
  readonly submissionSuccess = this.page
    .locator('.modal.show')
    .filter({ hasText: /has been successfully submitted/i });

  // ─── Navigation ───────────────────────────────────────────────────────────
  /** Opens the Customer Onboarding list — where the menu's "Add Customer" lands. */
  async gotoList(): Promise<void> {
    await this.navigateTo(AddCustomerPage.LIST_URL);
  }

  /**
   * Opens the wizard.
   *
   * Deliberately goes through the list screen's Add action rather than navigating
   * to WIZARD_URL directly. The same URL renders two different pages: reached by a
   * direct goto, the server omits the entire footer (Save As Draft / Next /
   * Submit), leaving a form that cannot be saved or advanced. Reached by clicking
   * through, the full wizard renders. Nothing about the URL hints at this, and the
   * degraded page looks complete until you try to submit it.
   */
  async gotoWizard(): Promise<void> {
    await this.gotoList();
    await this.clickElement(this.addCustomerAction);
    await this.referenceNo.waitFor({ state: 'visible', timeout: 30_000 });
    await this.saveAsDraftButton.waitFor({ state: 'visible', timeout: 30_000 });
  }

  /** Alias kept for readability where the entry path is the point of the test. */
  async openWizardFromList(): Promise<void> {
    await this.gotoWizard();
  }

  // ─── Dropdowns ────────────────────────────────────────────────────────────
  /**
   * Chooses an option from a SumoSelect dropdown.
   *
   * The native <select> is hidden behind the widget, so it cannot be clicked and
   * `selectOption` fails its actionability checks. Setting the value and firing
   * jQuery's change event drives the app's own handlers, which is what the
   * cascading dropdowns (sub-type, division) listen for.
   *
   * Options arrive by AJAX, so this waits for real ones before choosing.
   */
  /**
   * @param choice.avoid Options whose text matches are excluded before the
   *   index fallback picks one. Needed because "Others" is the first option in
   *   several of these lists, and choosing it reveals a second required
   *   "Others (Describe)" field that nothing then fills — so the step is left
   *   quietly invalid while still allowing the wizard to advance.
   */
  async selectDropdown(
    selectId: string,
    choice: { label?: string | RegExp; value?: string; index?: number; avoid?: RegExp } = {}
  ): Promise<string> {
    // Poll the option count rather than waitForFunction: this reports the real
    // count on failure, so "never populated" is distinguishable from "populated
    // late", and it does not depend on evaluating a string in page context.
    const realOptions = this.page.locator(`#${selectId} option:not([value="0"]):not([value=""])`);
    await expect
      .poll(async () => realOptions.count(), {
        timeout: 30_000,
        message: `waiting for #${selectId} to load selectable options`,
      })
      .toBeGreaterThan(0);

    const wanted = JSON.stringify({
      label: choice.label instanceof RegExp ? choice.label.source : choice.label ?? null,
      isRegex: choice.label instanceof RegExp,
      value: choice.value ?? null,
      index: choice.index ?? 1,
      avoid: choice.avoid ? choice.avoid.source : null,
    });

    const selected = await this.page.evaluate(
      `(function(){
        var want = ${wanted};
        var sel = document.getElementById('${selectId}');
        var opts = Array.prototype.slice.call(sel.options)
          .filter(function(o){ return o.value && o.value !== '0'; });
        var chosen = null;
        if (want.value) chosen = opts.filter(function(o){ return o.value === want.value; })[0];
        else if (want.label) {
          var re = want.isRegex ? new RegExp(want.label, 'i') : null;
          chosen = opts.filter(function(o){
            return re ? re.test(o.text) : o.text.trim().toLowerCase() === String(want.label).toLowerCase();
          })[0];
        }
        if (!chosen && want.avoid) {
          var re2 = new RegExp(want.avoid, 'i');
          var allowed = opts.filter(function(o){ return !re2.test(o.text.trim()); });
          // Only honour the exclusion if something survives it; an empty list
          // means the caller's assumption was wrong, and picking nothing at all
          // fails in a much less obvious way than picking the avoided option.
          if (allowed.length) opts = allowed;
        }
        if (!chosen) chosen = opts[Math.min(want.index - 1, opts.length - 1)];
        if (!chosen) return '';
        jQuery(sel).val(chosen.value).trigger('change');
        if (sel.sumo && sel.sumo.reload) { try { sel.sumo.reload(); } catch (e) {} }
        return chosen.text.trim();
      })()`
    );

    if (!selected) throw new Error(`No option matched ${JSON.stringify(choice)} in #${selectId}.`);
    this.logger.info(`#${selectId} = ${selected}`);
    await this.page.waitForTimeout(600);
    return String(selected);
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

  // ─── Step 1: Basic Information ────────────────────────────────────────────
  /**
   * Fills the Basic Information step.
   *
   * Dropdowns default to the first real option where the test does not care which
   * — the point of most cases is the flow, not a particular customer segment.
   */
  async fillBasicInformation(data: BasicInformation): Promise<void> {
    this.logger.info('Filling Basic Information');

    await this.selectDropdown('CustomerTypeID', { label: data.customerType });
    await this.selectDropdown('CustomerSubTypeID', {});
    await this.selectDropdown('CustStateID', {});
    await this.selectDropdown('CustDivisionID', {});
    await this.setRelatedParty(false);

    await this.fillInput(this.businessName, data.businessName);
    await this.fillInput(this.businessEmail, data.businessEmail);
    // The PAN is only valid relative to this choice, so the two are made
    // together. Passing them independently is how "Invalid PAN Number" appears
    // for a PAN that was correct a moment earlier under a different entity.
    const businessTypeId = await this.selectBusinessType();
    const pan = AddCustomerPage.panForBusinessType(businessTypeId, data.panNumber);
    if (pan !== data.panNumber) {
      this.logger.info(`PAN ${data.panNumber} -> ${pan} for business type ${businessTypeId}`);
    }

    // PAN and the GST declaration are part of the draft the server validates on
    // every step, not just at submit — skipping them fails the branch-step save
    // with a bare "Could not save customer draft."
    await this.page.locator('#SaveCustomerModel_PanDOB').fill(data.panDob);

    // Read the PAN verdict instead of dismissing it.
    //
    // Blurring the PAN posts it to /Customer/ValidatePanNumber, and the app
    // keeps a "PAN validated" flag from the answer. If that flag is false the
    // wizard refuses to leave the Address step — two steps later — with:
    //
    //   "Please validate the PAN number before submission. Tab out of the PAN
    //    field after entering it, fix any errors shown, then try again."
    //
    // shown in a modal that covers #btnShowOfficialDetails. The symptom is
    // therefore a Next button that is visible, enabled and unclickable, on a
    // screen with nothing wrong with it, and the cause is two steps behind.
    // dismissValidationDialogs() used to clear the PAN popup without reading
    // it, which is what made that trail cold.
    //
    // Note where the truth is. The response is HTTP 200 with status 1 and
    // message "Success" even for a PAN the server rejects:
    //
    //   {"status":1,"isValid":0,"message":"Success","panCustomerName":""}
    //
    // Only isValid says so. Anything reading status or message concludes the
    // PAN was accepted.
    const panVerdict = this.page
      .waitForResponse(r => /ValidatePanNumber/i.test(r.url()), { timeout: 20_000 })
      .catch(() => null);

    await this.fillInput(this.panNumber, pan);
    await this.panNumber.blur();

    const panResponse = await panVerdict;
    if (panResponse) {
      const verdict = await panResponse.json().catch(() => null);
      if (verdict && Number(verdict.isValid) !== 1) {
        throw new Error(
          `The server rejected PAN ${pan} for business type ${businessTypeId}.\n\n` +
            `  /Customer/ValidatePanNumber replied ${JSON.stringify(verdict)}\n\n` +
            `isValid is 0, so the wizard's PAN flag stays false and it will ` +
            `refuse to advance past the Address step later — reporting it as a ` +
            `Next button that cannot be clicked. Failing here instead, where ` +
            `the cause is.\n\n` +
            `panCustomerName is empty, so this PAN was looked up and not found ` +
            `rather than malformed. It is test data that needs replacing, not a ` +
            `defect in the wizard.`
        );
      }
      this.logger.info(`PAN ${pan} accepted by the server.`);
    } else {
      this.logger.warn(
        `No /Customer/ValidatePanNumber call was seen after blurring the PAN. ` +
          `The wizard's PAN flag may be unset, which surfaces later as an ` +
          `unclickable Next on the Address step.`
      );
    }

    await this.page.waitForTimeout(1200);
    await this.dismissValidationDialogs();
    await this.uploadPanCard(data.uploadFile);

    // Declaring "not GST registered" needs the declaration document instead.
    await this.clickElement(this.gstRegisteredNo);
    await this.page.waitForTimeout(600);
    const gstDecl = this.page.locator('#GSTDeclUpload');
    if (await gstDecl.count()) await gstDecl.setInputFiles(data.uploadFile);

    await this.fillInput(this.customerName, data.customerName);
    await this.selectDropdown('CustomerLanguagePreference', {});
    await this.fillInput(this.customerEmail, data.customerEmail);

    await this.verifyCustomerMobile(data.customerMobile, data.otp);

    await this.selectDropdown('CustomerIdProofType', {});
    await this.fillInput(this.idProofNo, data.idProofNumber);
    await this.uploadCustomerIdProof(data.uploadFile);

    await this.selectDropdown('CustomerSegmentID', {});
    await this.selectDropdown('BuyingPatternID', {});

    await this.fillInput(this.bankName, data.bankName);
    await this.fillInput(this.bankAccountHolder, data.bankAccountHolder);
    await this.fillInput(this.bankAccountNumber, data.bankAccountNumber);
    await this.fillInput(this.ifscCode, data.ifscCode);
    await this.uploadBankProof(data.uploadFile);
  }

  /**
   * Dismisses the app's validation popups.
   *
   * The form validates several fields against the server on blur (mobile, PAN,
   * referral code) and reports problems in a modal. An open modal swallows the
   * next click, so it has to be cleared before carrying on.
   */
  async dismissValidationDialogs(): Promise<string[]> {
    const messages: string[] = [];
    for (const [textSel, okSel] of [
      ['#failer-mess-text', '#failer-mess-popup button.btn-danger'],
      ['#error-mess-text', '#error-mess-popup button.btn-danger'],
      ['#succ-mess-text', '#succ-mess-popup button.btn_primary'],
    ]) {
      const ok = this.page.locator(okSel).first();
      if (!(await ok.isVisible().catch(() => false))) continue;
      const text = ((await this.page.locator(textSel).first().textContent().catch(() => '')) ?? '').trim();
      if (text) messages.push(text);
      await ok.click().catch(() => undefined);
      await this.page.waitForTimeout(600);
    }

    // The ids above do not cover everything: the draft confirmation is
    // #success-mess-popup, one character away from the #succ-mess-popup listed
    // there, and it went unnoticed for as long as the draft save was failing
    // before it could appear. Rather than chase ids, anything still modal gets
    // acknowledged by its own button — a dialog left open swallows the next
    // click, and the failure surfaces as an unrelated button timing out.
    for (let attempt = 0; attempt < 3; attempt++) {
      const modal = this.page.locator('.modal.show').first();
      if (!(await modal.isVisible().catch(() => false))) break;

      const text = ((await modal.textContent().catch(() => '')) ?? '').replace(/\s+/g, ' ').trim();
      if (text && !messages.includes(text)) messages.push(text);

      const button = modal.locator('button:visible, .btn:visible').first();
      if (!(await button.isVisible().catch(() => false))) break;
      await button.click().catch(() => undefined);
      await this.page.waitForTimeout(800);
    }

    if (messages.length) this.logger.info(`Dismissed dialog(s): ${messages.join(' | ')}`);
    return messages;
  }

  /**
   * Sends the customer-mobile OTP and verifies it.
   *
   * The mobile is validated server-side first; an already-registered number is
   * rejected in a modal and Generate OTP then does nothing. That failure is
   * surfaced by name rather than as a timeout on the hidden OTP box.
   */
  async verifyCustomerMobile(mobile: string, otp: string): Promise<void> {
    await this.fillInput(this.customerMobile, mobile);
    await this.customerMobile.blur();
    await this.page.waitForTimeout(1500);

    const onEntry = await this.dismissValidationDialogs();
    if (onEntry.length) {
      throw new Error(`Customer mobile ${mobile} was rejected: ${onEntry.join(' | ')}`);
    }

    await this.clickElement(this.generateMobileOtp);
    await this.page.waitForTimeout(2000);

    const afterSend = await this.dismissValidationDialogs();
    const appeared = await this.mobileOtp
      .waitFor({ state: 'visible', timeout: 20_000 })
      .then(() => true)
      .catch(() => false);

    if (!appeared) {
      throw new Error(
        `OTP field never appeared for ${mobile}` +
          (afterSend.length ? ` — app said: ${afterSend.join(' | ')}` : ' and the app reported nothing.')
      );
    }

    await this.fillInput(this.mobileOtp, otp);
    await this.clickElement(this.verifyMobileOtp);
    await this.page.waitForTimeout(1500);
    await this.dismissValidationDialogs();
  }

  // ─── Uploads ──────────────────────────────────────────────────────────────
  // The visible control is a styled button; the real input is the hidden file
  // element, which setInputFiles drives directly.
  async uploadPanCard(file: string): Promise<void> {
    await this.page.locator('#PanCardUpload').setInputFiles(file);
  }

  async uploadCustomerIdProof(file: string): Promise<void> {
    await this.page.locator('#CustomerIdProofUpload').setInputFiles(file);
  }

  async uploadBankProof(file: string): Promise<void> {
    await this.page.locator('#BankProofUpload').setInputFiles(file);
  }

  async uploadAddressProof(file: string): Promise<void> {
    await this.page.locator('#AddressProofUpload').setInputFiles(file);
  }

  // ─── Step navigation ──────────────────────────────────────────────────────
  async saveAsDraft(): Promise<void> {
    this.logger.info('Save As Draft');
    await this.clickElement(this.saveAsDraftButton);
    await this.page.waitForTimeout(2500);
    // The confirmation is modal and blocks Next until it is acknowledged.
    await this.dismissValidationDialogs();
  }

  async goToAddressStep(): Promise<void> {
    this.logger.info('Basic Information -> Address');
    await this.clickElement(this.tab1NextButton);
    await this.addressPinCode.waitFor({ state: 'visible', timeout: 30_000 });
  }

  // ─── Step 2: Address ──────────────────────────────────────────────────────
  async fillAddress(data: AddressDetails): Promise<void> {
    this.logger.info('Filling Address');
    await this.enterAddressPinCode(data.pinCode);
    // State, city and district auto-fill from the pin code.
    await expect(this.addressState).not.toHaveValue('', { timeout: 20_000 });
    await this.fillInput(this.businessAddress, data.businessAddress);
    await this.selectDropdown('AddressProofType', { avoid: /^others$/i });
    await this.fillInput(this.page.locator('#AddressProofNo'), data.addressProofNumber);
    await this.uploadAddressProof(data.uploadFile);
  }

  async goToBranchStep(): Promise<void> {
    this.logger.info('Address -> Branch location');
    await this.clickElement(this.addressNextButton);
    await this.page.locator('#uiBOPinCode').waitFor({ state: 'visible', timeout: 30_000 });
  }

  // ─── Step 3: Branch location ──────────────────────────────────────────────
  async fillBranch(data: BranchDetails): Promise<void> {
    this.logger.info('Filling Branch location');
    await this.fillInput(this.page.locator('#uiBOPinCode'), data.pinCode);
    await this.page.locator('#uiBOPinCode').blur();
    await this.fillInput(this.page.locator('#uiBOManagerName'), data.managerName);

    // Reuse the customer's contact details rather than re-verifying a second OTP.
    await this.page.locator('#uiBOEmailSameAsParent').check();
    await this.page.locator('#uiBOAddressSameAsParent').check();
    await this.page.locator('#uiBOMobileSameAsParent').check();
    await this.selectDropdown('uiBOLanguage', {});

    // Location is required but is not filled by the pin-code lookup.
    const location = this.page.locator('#uiBOLocation');
    if (await location.isVisible().catch(() => false)) {
      if (!(await location.inputValue()).trim()) {
        await this.fillInput(location, data.location ?? 'Test Branch');
      }
    }

    this.logger.info(`Branch fields: ${JSON.stringify(await this.branchFieldValues())}`);
  }

  /** Current values of the branch block — used to explain a blocked Save. */
  async branchFieldValues(): Promise<Record<string, string>> {
    return this.page.evaluate(`(function(){
      var out = {};
      ['uiBOPinCode','uiBOState','uiBOCity','uiBOLocation','uiBOManagerName','uiBOEmail','uiBOMobile','uiBOAddress','uiBOLanguage']
        .forEach(function(id){
          var e = document.getElementById(id);
          out[id] = e ? (e.value || '').trim() : '(absent)';
        });
      return out;
    })()`);
  }

  async saveBranch(): Promise<void> {
    this.logger.info('Save Branch');
    await this.clickElement(this.saveBranchButton);
    await this.page.waitForTimeout(2500);
    const said = await this.dismissValidationDialogs();
    if (said.length) this.logger.info(`Save Branch said: ${said.join(' | ')}`);

    // Saving opens a fresh empty draft slot for the next branch. An open draft
    // blocks forward navigation without saying so, which is why the recorded flow
    // clicks Clear before Next.
    await this.clearBranchDraft();
  }

  /** Discards the empty branch draft slot if one is open. */
  async clearBranchDraft(): Promise<void> {
    const clear = this.page.locator('#btnRemoveCurrentBOSlot');
    if (await clear.isVisible().catch(() => false)) {
      this.logger.info('Clearing the open branch draft slot');
      await clear.click().catch(() => undefined);
      await this.page.waitForTimeout(1000);
      const confirm = this.page.locator('#confirmation-ok-btn');
      if (await confirm.isVisible().catch(() => false)) {
        await confirm.click();
        await this.page.waitForTimeout(1000);
      }
    }
  }

  /**
   * Field-level validation messages currently on screen.
   *
   * The wizard blocks forward navigation silently when a step is incomplete, so
   * the useful diagnostic is which fields it is complaining about.
   */
  async visibleFieldErrors(): Promise<string[]> {
    return this.page.evaluate(`(function(){
      var out = [];
      document.querySelectorAll('.field-validation-error, .text-danger, .invalid-feedback, span[id$="_error"]')
        .forEach(function(e){
          // The backslash is doubled on purpose. This whole block is a template
          // literal, so a single one is consumed before the browser sees it and
          // the regex arrives as /s+/g — stripping the letter "s" out of every
          // validation message instead of collapsing whitespace.
          var t = (e.textContent || '').replace(/\\s+/g, ' ').trim();
          var r = e.getBoundingClientRect();
          if (t && t !== '*' && r.width > 0 && r.height > 0) out.push(t.slice(0, 70));
        });
      return out.slice(0, 12);
    })()`);
  }

  async goToMeetingStep(): Promise<void> {
    this.logger.info('Branch location -> Meeting Details');
    await this.clearBranchDraft();

    const nextState = await this.page.evaluate(`(function(){
      var b = document.getElementById('btnShowMeetingDetails');
      if (!b) return 'ABSENT';
      var r = b.getBoundingClientRect();
      return 'visible=' + (r.width>0&&r.height>0) + ' disabled=' + !!b.disabled;
    })()`);
    this.logger.info(`#btnShowMeetingDetails ${nextState}`);

    await this.clickElement(this.branchNextButton);
    await this.page.waitForTimeout(2500);
    const said = await this.dismissValidationDialogs();

    const arrived = await this.page
      .locator('#SaveCustomerModel_MeetingDetails_MeetingDate')
      .waitFor({ state: 'visible', timeout: 25_000 })
      .then(() => true)
      .catch(() => false);

    if (!arrived) {
      const errors = await this.visibleFieldErrors();
      const branchSaved = await this.page.getByText(/Branch Location #\d/i).count();
      const tabs = await this.page.evaluate(`(function(){
        var out = [];
        document.querySelectorAll('#dvAddCustomerTabNav a.nav-link').forEach(function(a){
          out.push(a.id + (a.classList.contains('active') ? ' [ACTIVE]' : '') +
                   (a.classList.contains('disable') ? ' [disabled]' : ''));
        });
        var panes = [];
        ['basicInfo','address','dvBranchLocation','meetingDetails','nfoDetails'].forEach(function(id){
          var p = document.getElementById(id);
          if (p) panes.push(id + '=' + (p.classList.contains('active') || p.classList.contains('show') ? 'shown' : 'hidden'));
        });
        return 'tabs: ' + out.join(', ') + '\\npanes: ' + panes.join(', ');
      })()`);
      throw new Error(
        'Meeting Details step did not open after Branch location.\n' +
          `Saved branch summaries on page: ${branchSaved}\n${tabs}\n` +
          (said.length ? `App said: ${said.join(' | ')}\n` : 'App displayed no dialog.\n') +
          (errors.length ? `Validation on screen:\n  ${errors.join('\n  ')}` : 'No validation message was displayed.')
      );
    }
  }

  // ─── Step 4: Meeting details, then submit ─────────────────────────────────
  async fillMeetingDetails(meetingDate: string): Promise<void> {
    this.logger.info('Filling Meeting Details');
    await this.page.locator('#SaveCustomerModel_MeetingDetails_MeetingDate').fill(meetingDate);
    await this.page.locator('label[for="MeetingTypeInPerson"]').click();
  }

  async submit(): Promise<void> {
    this.logger.info('Submitting application');
    await this.clickElement(this.submitButton);
    // A confirmation dialog follows; the recorded flow clicks Submit twice.
    await this.page.waitForTimeout(1500);
    const confirm = this.page.locator('#confirmation-ok-btn');
    if (await confirm.isVisible().catch(() => false)) await confirm.click();
    await this.page.waitForTimeout(3000);
  }

  /**
   * The validation messages the wizard is currently showing.
   *
   * This exists because the wizard lets an invalid step through. It marks the
   * step red, shows the message, and still allows Save As Draft, Next and
   * Submit — so "the application was created" is not evidence the data was
   * accepted, and a suite that only checks for a reference number will file bad
   * records forever without noticing. Verified: an invalid PAN reached
   * RawCustomerMaster with the field flagged on screen the whole way.
   *
   * Required-field asterisks share the .text-danger class with real messages,
   * so they are filtered out by content — they are always exactly "*".
   */
  async validationErrors(): Promise<string[]> {
    const texts = await this.page
      .locator('.invalid-feedback:visible, .field-validation-error:visible, .text-danger:visible')
      .allTextContents();

    return [...new Set(
      texts
        .map(text => text.replace(/\s+/g, ' ').trim())
        .filter(text => text.length > 0 && !/^\*+$/.test(text))
    )];
  }

  /**
   * Which fourth PAN character each Type Of Business accepts.
   *
   * Copied from PAN_ENTITY_RULES in the application's own /js/add_customer.js,
   * because the rule is not discoverable from the form: the message it shows,
   * "Invalid PAN Number", names neither the position nor the business type it is
   * judging against. A PAN is valid or invalid only *relative to the selected
   * Type Of Business* — the same number passes as one entity and fails as
   * another — so the two fields can never be chosen independently.
   *
   * `null` means that entity imposes no restriction. An id absent from this map
   * has no acceptable PAN at all, which is why selectBusinessType() refuses to
   * pick one.
   */
  private static readonly PAN_ENTITY_RULES: Record<string, string[] | null> = {
    1: ['F'],                                              // Partnership
    2: ['P'],                                              // Sole Proprietorship
    3: ['C'],                                              // Public/Private Ltd
    4: ['P', 'C', 'F', 'T', 'L', 'J', 'G', 'B', 'A', 'H'], // Others
    8: ['T', 'L', 'J', 'G', 'B', 'A', 'H'],                // Trust/Foundation
    10: null,                                              // Govt Dept
  };

  /**
   * The base PAN, correct for an individual.
   *
   * `P` in the fourth position, so it passes as Sole Proprietorship and as
   * Others. panForBusinessType() rewrites that character when the selected
   * entity demands a different one.
   *
   * Not made unique per run: PANs are shared across applications throughout this
   * environment — one is on 21 of them — and CustomerMaster holds duplicates
   * too, so the application does not treat a PAN as identifying anything.
   *
   * ── Why not ABCPE1234F any more ──────────────────────────────────────────
   * The previous value is rejected by /Customer/ValidatePanNumber with
   * isValid 0, and has been since at least 14 September 2026. Measured by
   * driving candidates through the field, twice, in different orders:
   *
   *   ABCPE1234F   rejected      the old value
   *   ABCPA1234F   accepted      this one
   *   AAAPA1234A   accepted
   *   BNZPM2501F   accepted
   *
   * All four carry the same entity character, so the entity rule is not what
   * separates them; the old value is rejected on its own account. Whatever the
   * reason, the fourth-character rules below still hold and only the base
   * changed.
   *
   * Candidates with C, F or D in that position produced NO validation call at
   * all under business type 2 — the page blocks them client-side. Worth knowing,
   * because "no call fired" and "validated silently" look identical from the
   * outside, and only one of them means the wizard will advance.
   */
  static readonly TEST_PAN = 'ABCPA1234F';

  /** The base PAN adjusted to whatever the selected business type will accept. */
  static panForBusinessType(entityId: string, base: string = AddCustomerPage.TEST_PAN): string {
    const allowed = AddCustomerPage.PAN_ENTITY_RULES[entityId];
    if (allowed === null) return base;
    if (!allowed) {
      throw new Error(
        `Business type ${entityId} has no PAN entity rule, so no PAN would be accepted.`
      );
    }
    return allowed.includes(base.charAt(3))
      ? base
      : base.slice(0, 3) + allowed[0] + base.slice(4);
  }

  /**
   * Picks a Type Of Business whose PAN rule is known.
   *
   * The first option in this dropdown is "Others", and taking it reveals a
   * second required "Others (Describe)" field that then goes unfilled — so the
   * default fallback is wrong here twice over.
   */
  private async selectBusinessType(): Promise<string> {
    const available = await this.page
      .locator('#CustomerBusinessType option')
      .evaluateAll(options =>
        options.map(o => (o as HTMLOptionElement).value).filter(v => v && v !== '0')
      );

    const preferred = ['2', '1', '3', '8'].find(id => available.includes(id));
    if (!preferred) {
      throw new Error(
        `None of the business types offered (${available.join(', ')}) has a known PAN ` +
          `entity rule, so no PAN would be accepted. Re-read PAN_ENTITY_RULES in ` +
          `/js/add_customer.js — the application's list has changed.`
      );
    }

    await this.selectDropdown('CustomerBusinessType', { value: preferred });
    return preferred;
  }

  /** The reference id the success dialog reports back, or '' if it did not appear. */
  async submittedReference(timeout = 30_000): Promise<string> {
    const appeared = await this.submissionSuccess
      .waitFor({ state: 'visible', timeout })
      .then(() => true)
      .catch(() => false);
    if (!appeared) return '';

    const text = ((await this.submissionSuccess.textContent()) ?? '').replace(/\s+/g, ' ');
    return (text.match(/Reference ID\s*:?\s*([A-Za-z0-9-]+)/i)?.[1] ?? text.trim());
  }
}

export interface BasicInformation {
  customerType: string;
  panNumber: string;
  panDob: string;
  businessName: string;
  businessEmail: string;
  customerName: string;
  customerEmail: string;
  customerMobile: string;
  otp: string;
  idProofNumber: string;
  bankName: string;
  bankAccountHolder: string;
  bankAccountNumber: string;
  ifscCode: string;
  uploadFile: string;
}

export interface AddressDetails {
  pinCode: string;
  businessAddress: string;
  addressProofNumber: string;
  uploadFile: string;
}

export interface BranchDetails {
  pinCode: string;
  managerName: string;
  location?: string;
}
