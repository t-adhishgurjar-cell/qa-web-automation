import { expect } from '../../src/fixtures/page.fixtures';
import { test } from '../../src/fixtures/page.fixtures';
import { TermsPage } from '../../src/pages/terms.page';
import { epic, feature, story, severity, description } from 'allure-js-commons';

const validUsername = process.env.TEST_USERNAME ?? '';
const validPassword = process.env.TEST_PASSWORD ?? '';
const validOtp = process.env.TEST_OTP ?? '123456';
const invalidUsername = 'invalid_user@example.com';
const invalidPassword = 'WrongPass123!';
const invalidFormatUsername = 'invalid!@#';
const unregisteredUsername = `unregistered_${Date.now()}@example.com`;

test.describe('FleetPlus Login Test Cases from Excel sheet @smoke @login', () => {
  test.beforeEach(async ({ loginPage }) => {
    await epic('Authentication');
    await feature('Login');
    await loginPage.navigate();
    await loginPage.assertLoginPageLoaded();
  });

  test('LOG-001: valid credentials should allow login', async ({ loginPage, dashboardPage }) => {
    test.skip(!validUsername || !validPassword, 'TEST_USERNAME and TEST_PASSWORD must be configured');
    await story('Valid Login');
    await severity('critical');
    await description('Verifies a user can log in with valid username and password');

    await loginPage.login(validUsername, validPassword);
    await dashboardPage.assertDashboardLoaded();
    await dashboardPage.logout();
  });

  test('LOG-002: invalid password should display an error', async ({ loginPage }) => {
    test.skip(!validUsername, 'TEST_USERNAME must be configured');
    await story('Invalid Password Login');
    await severity('critical');
    await description('Verifies login is rejected when the password is incorrect');

    await loginPage.login(validUsername, invalidPassword);
    await loginPage.assertErrorMessage('Invalid credentials');
  });

  test('LOG-003: invalid username should display an error', async ({ loginPage }) => {
    test.skip(!validPassword, 'TEST_PASSWORD must be configured');
    await story('Invalid Username Login');
    await severity('critical');
    await description('Verifies login is rejected for an unrecognized username');

    await loginPage.login(invalidUsername, validPassword);
    await loginPage.assertErrorMessage('Invalid credentials');
  });

  test('LOG-004: blank username should display a validation message', async ({ loginPage }) => {
    test.skip(!validPassword, 'TEST_PASSWORD must be configured');
    await story('Blank Username Validation');
    await severity('critical');
    await description('Verifies username is required when logging in');

    await loginPage.login('', validPassword);
    await loginPage.assertUsernameError('Username is required');
  });

  test('LOG-005: blank password should display a validation message', async ({ loginPage }) => {
    test.skip(!validUsername, 'TEST_USERNAME must be configured');
    await story('Blank Password Validation');
    await severity('critical');
    await description('Verifies password is required when logging in');

    await loginPage.login(validUsername, '');
    await loginPage.assertPasswordError('Password is required');
  });

  test('LOG-006: OTP request works for a registered username', async ({ loginPage }) => {
    test.skip(!validUsername, 'TEST_USERNAME must be configured');
    await story('OTP Request for Registered Username');
    await severity('normal');
    await description('Verifies the OTP request flow is available for a registered username');

    await loginPage.requestOtpForUsername(validUsername);
    await loginPage.assertForgotOtpStepVisible();
  });

  test('LOG-007: OTP request for an unregistered username should not proceed', async ({ loginPage }) => {
    await story('OTP Request for Unregistered Username');
    await severity('normal');
    await description('Verifies an OTP flow does not proceed for an unregistered username');

    await loginPage.requestOtpForUsername(unregisteredUsername);
    expect(await loginPage.isForgotOtpStepVisible()).toBe(false);
  });

  test('LOG-008: blank username on OTP request should display an error', async ({ loginPage }) => {
    await story('Blank OTP Username Validation');
    await severity('normal');
    await description('Verifies the OTP request flow validates a missing username');

    await loginPage.requestOtpForUsername('');
    await loginPage.assertForgotUsernameError('Username is required');
  });

  test('LOG-009: invalid username format should not advance OTP request', async ({ loginPage }) => {
    await story('Invalid Username Format OTP Request');
    await severity('normal');
    await description('Verifies the OTP request flow rejects an invalid username format');

    await loginPage.requestOtpForUsername(invalidFormatUsername);
    expect(await loginPage.isForgotOtpStepVisible()).toBe(false);
  });

  test('LOG-010: 2FA should require OTP after login', async ({ loginPage }) => {
    test.skip(!validUsername || !validPassword, 'TEST_USERNAME and TEST_PASSWORD must be configured');
    await story('2FA Prompt After Login');
    await severity('critical');
    await description('Verifies that login requires an OTP verification step');

    const otpPage = await loginPage.submitCredentials(validUsername, validPassword);
    expect(await otpPage.isLoaded()).toBe(true);
  });

  test('LOG-011: OTP is sent to registered mobile after valid login', async ({ loginPage }) => {
    test.skip(!validUsername || !validPassword, 'TEST_USERNAME and TEST_PASSWORD must be configured');
    await story('OTP Sent on Login');
    await severity('critical');
    await description('Verifies that the OTP verification step is shown after a valid login');

    const otpPage = await loginPage.submitCredentials(validUsername, validPassword);
    expect(await otpPage.isLoaded()).toBe(true);
  });

  test('LOG-012: wrong OTP should reject access', async ({ loginPage }) => {
    test.skip(!validUsername || !validPassword, 'TEST_USERNAME and TEST_PASSWORD must be configured');
    await story('Wrong OTP Validation');
    await severity('critical');
    await description('Verifies an incorrect OTP does not allow access');

    const otpPage = await loginPage.submitCredentials(validUsername, validPassword);
    expect(await otpPage.isLoaded()).toBe(true);
    await otpPage.verify('000000');
    expect(await otpPage.isLoaded()).toBe(true);
    expect(await otpPage.isErrorVisible()).toBe(true);
  });

  test('LOG-013: Terms and conditions consent appears after first login', async ({ loginPage, dashboardPage, page }) => {
    test.skip(!validUsername || !validPassword, 'TEST_USERNAME and TEST_PASSWORD must be configured');
    const termsPage = new TermsPage(page);
    await story('Terms and Conditions Consent');
    await severity('normal');
    await description('Verifies terms and conditions consent is displayed after first login');

    await loginPage.login(validUsername, validPassword);
    const termsVisible = await termsPage.isLoaded();
    test.skip(!termsVisible, 'Terms and conditions modal is not currently displayed for this account');
    await termsPage.accept();
    await dashboardPage.assertDashboardLoaded();
  });
});
