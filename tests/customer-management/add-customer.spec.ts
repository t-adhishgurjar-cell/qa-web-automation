import { expect } from '@playwright/test';
import { test } from '../../src/fixtures/session.fixtures';
import { FleetPlusTestData } from '../../src/helpers/fleetplus-test-data.helper';
import { epic, feature, story, severity, description, owner, tms } from 'allure-js-commons';

/**
 * Customer Management → Add Customer.
 *
 * Covers the parts of the onboarding wizard that can be verified without
 * submitting an application. Creating a customer has real downstream effects in
 * QA — it enters the reviewer queue and consumes a reference number — so the
 * happy-path submission is deliberately not automated here yet. These tests
 * assert the form's contract: what the app generates, what it locks, and what it
 * reveals conditionally.
 *
 * Auth comes from the worker's shared session rather than auth.setup's
 * storageState. FleetPlus ties a session to the browser context that created
 * it: replaying the saved cookies (.AspNetCore.Session and friends — there is
 * no separate auth cookie) into a fresh context returns "Session Expired,
 * Please login again!". Holding one context open for the worker is the form of
 * log-in-once that does work here.
 */

const PRIMARY = FleetPlusTestData.getPrimaryCredential();

test.use({
  sessionAccount: {
    username: PRIMARY.mobile,
    password: PRIMARY.password,
    role: 'primary credential',
  },
});

// FleetPlus permits one session per user; parallel logins as the same account
// trigger its "already signed in" prompt.
test.describe.configure({ mode: 'serial' });

test.describe('Add Customer @customer-management @smoke', () => {
  test.beforeEach(async ({ addCustomerPage }) => {
    await epic('Customer Management');
    await feature('Add Customer');
    await owner('QA Team');

    await addCustomerPage.gotoWizard();
  });

  test('wizard opens with the onboarding form @sanity', async ({ addCustomerPage }) => {
    await tms('TC002', 'Customer Onboarding');
    await story('Open Add Customer');
    await severity('critical');
    await description('The Add Customer wizard loads with its Basic Information sections present.');

    await addCustomerPage.assertWizardLoaded();
  });

  test('user information is auto-populated from the session', async ({ addCustomerPage }) => {
    await tms('TC002', 'Customer Onboarding');
    await story('Maker details');
    await severity('critical');
    await description('Maker name, mobile and role come from the logged-in user and are read-only.');

    await addCustomerPage.assertMakerDetails({});
    await addCustomerPage.assertMakerFieldsReadOnly();

    // The mobile shown must be a real 10-digit number, not a placeholder.
    await expect(addCustomerPage.makerMobile).toHaveValue(/^\d{10}$/);
  });

  test('reference number is generated and application date is locked', async ({ addCustomerPage }) => {
    await tms('TC003', 'Customer Onboarding');
    await story('Application details');
    await severity('normal');
    await description('Reference No is server-generated and read-only; Application Date is auto-filled and not editable.');

    await addCustomerPage.assertReferenceNoGenerated();
    await addCustomerPage.assertApplicationDateReadOnly();
  });

  test('related party YES reveals the RO code lookup, NO hides it', async ({ addCustomerPage }) => {
    await tms('TC004', 'Customer Onboarding');
    await story('Related party');
    await severity('normal');
    await description('Selecting YES exposes the RO/CMS code field and its hierarchy; NO hides them again.');

    await addCustomerPage.setRelatedParty(true);
    await expect(addCustomerPage.roCode).toBeVisible();

    await addCustomerPage.setRelatedParty(false);
    await expect(addCustomerPage.roCode).toBeHidden();
  });

  test('opening the wizard from the onboarding list works', async ({ addCustomerPage, page }) => {
    await tms('TC002', 'Customer Onboarding');
    await story('Navigation');
    await severity('normal');
    await description('The menu lands on the onboarding list; its Add Customer action opens the wizard.');

    await addCustomerPage.openWizardFromList();
    await expect(page).toHaveURL(/\/Customer\/AddCustomer/i);
    await addCustomerPage.assertWizardLoaded();
  });
});
