import { Page, Locator } from '@playwright/test';
import { BasePage } from './base.page';
import { CustomerProfile } from '../types/user.types';

export class CustomerOnboardingPage extends BasePage {
  private readonly firstNameInput = this.page.getByLabel('First Name');
  private readonly lastNameInput = this.page.getByLabel('Last Name');
  private readonly emailInput = this.page.getByLabel('Email');
  private readonly companyInput = this.page.getByLabel('Company');
  private readonly phoneInput = this.page.getByLabel('Phone');
  private readonly countryInput = this.page.getByLabel('Country');
  private readonly submitButton = this.page.getByRole('button', { name: 'Submit' });
  private readonly successBanner = this.page.getByText('Customer created successfully');
  private readonly formHeading = this.page.getByRole('heading', { name: 'Customer Onboarding' });
  private readonly errorMessage = (label: string): Locator =>
    this.page.locator(`label:text-is("${label}") + .error-message, [aria-label="${label}"] + .error-message`);

  constructor(page: Page) {
    super(page);
  }

  async navigate(): Promise<void> {
    await this.navigateTo('/customers/onboarding');
  }

  async assertFormVisible(): Promise<void> {
    await this.assertElementVisible(this.formHeading);
    await this.assertElementVisible(this.firstNameInput);
    await this.assertElementVisible(this.lastNameInput);
    await this.assertElementVisible(this.emailInput);
    await this.assertElementVisible(this.companyInput);
  }

  async fillCustomerDetails(customer: Partial<CustomerProfile>): Promise<void> {
    if (customer.firstName !== undefined) {
      await this.fillInput(this.firstNameInput, customer.firstName);
    }
    if (customer.lastName !== undefined) {
      await this.fillInput(this.lastNameInput, customer.lastName);
    }
    if (customer.email !== undefined) {
      await this.fillInput(this.emailInput, customer.email);
    }
    if (customer.company !== undefined) {
      await this.fillInput(this.companyInput, customer.company);
    }
    if (customer.phone !== undefined) {
      await this.fillInput(this.phoneInput, customer.phone);
    }
    if (customer.country !== undefined) {
      await this.fillInput(this.countryInput, customer.country);
    }
  }

  async submit(): Promise<void> {
    await this.clickElement(this.submitButton);
  }

  async assertSuccessMessage(): Promise<void> {
    await this.assertElementVisible(this.successBanner);
  }

  async assertValidationError(fieldName: string, message: string): Promise<void> {
    const error = this.errorMessage(fieldName);
    await this.assertElementVisible(error);
    await this.assertElementText(error, message);
  }
}
