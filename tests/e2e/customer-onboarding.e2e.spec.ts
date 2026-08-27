import { test } from '../../src/fixtures/page.fixtures';
import { DataFactory } from '../../src/helpers/data-factory.helper';
import { epic, feature, story, severity, description, owner } from 'allure-js-commons';

test.describe('Customer Onboarding @regression @customer', () => {
  test.use({ storageState: 'config/.auth/user.json' });

  test.beforeEach(async ({ customerOnboardingPage }) => {
    await epic('Customer Management');
    await feature('Onboarding');//checking pr flow
    await owner('QA Team');
    await customerOnboardingPage.navigate();
    await customerOnboardingPage.assertFormVisible();
  });

  test('should create a new customer successfully', async ({ customerOnboardingPage }) => {
    await story('Create Customer');
    await severity('critical');
    await description('Verifies that a new customer can be onboarded using valid data');

    const customer = DataFactory.createCustomer({ company: 'Acme Corporation' });
    await customerOnboardingPage.fillCustomerDetails(customer);
    await customerOnboardingPage.submit();
    await customerOnboardingPage.assertSuccessMessage();
  });

  test('should show validation errors when required fields are missing', async ({ customerOnboardingPage }) => {
    await story('Customer Validation');
    await severity('normal');
    await description('Verifies validation errors are displayed for required onboarding fields');

    await customerOnboardingPage.fillCustomerDetails({
      firstName: '',
      lastName: '',
      email: '',
    });
    await customerOnboardingPage.submit();

    await customerOnboardingPage.assertValidationError('First Name', 'First Name is required');
    await customerOnboardingPage.assertValidationError('Last Name', 'Last Name is required');
    await customerOnboardingPage.assertValidationError('Email', 'Email is required');
  });
});
