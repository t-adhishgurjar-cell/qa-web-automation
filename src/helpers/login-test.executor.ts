import { expect, Page } from '@playwright/test';
import { FleetPlusCredential, LoginTestCase } from '../types/fleetplus.types';
import { LoginPage } from '../pages/login.page';
import { DashboardPage } from '../pages/dashboard.page';
import { TermsPage } from '../pages/terms.page';

export interface LoginTestContext {
  page: Page;
  loginPage: LoginPage;
  dashboardPage: DashboardPage;
  primary: FleetPlusCredential;
  credentials: FleetPlusCredential[];
  invalidPassword: string;
  invalidUsername: string;
  unregisteredMobile: string;
}

const WRONG_PASSWORD = 'WrongPass123!';
const INVALID_USER = 'INVALID_USER_999';
const UNREGISTERED_MOBILE = '9999999999';
const INVALID_MOBILE = '987654321';
const WRONG_OTP = '000000';

export function buildLoginTestContext(
  page: Page,
  loginPage: LoginPage,
  dashboardPage: DashboardPage,
  credentials: FleetPlusCredential[],
  primary: FleetPlusCredential
): LoginTestContext {
  return {
    page,
    loginPage,
    dashboardPage,
    primary,
    credentials,
    invalidPassword: WRONG_PASSWORD,
    invalidUsername: INVALID_USER,
    unregisteredMobile: UNREGISTERED_MOBILE,
  };
}

export async function runLoginTestCase(
  tc: LoginTestCase,
  ctx: LoginTestContext
): Promise<void> {
  switch (tc.tcId) {
    case 'LOG-001':
      await ctx.loginPage.login(ctx.primary.mobile, ctx.primary.password);
      await expect(ctx.page).not.toHaveURL(/Home\/Login|Login/i);
      await ctx.dashboardPage.assertDashboardLoaded();
      await ctx.dashboardPage.logout();
      break;

    case 'LOG-002':
      await ctx.loginPage.login(ctx.primary.mobile, ctx.invalidPassword);
      await ctx.loginPage.assertErrorContains(/invalid credentials|login fails/i);
      expect(await ctx.loginPage.isOtpLoginStepVisible()).toBe(false);
      break;

    case 'LOG-003':
      await ctx.loginPage.login(ctx.invalidUsername, ctx.primary.password);
      await ctx.loginPage.assertErrorContains(/invalid credentials|user not found|invalid/i);
      break;

    case 'LOG-004':
      await ctx.loginPage.login('', ctx.primary.password);
      await ctx.loginPage.assertUsernameError('Username is required');
      break;

    case 'LOG-005':
      await ctx.loginPage.login(ctx.primary.mobile, '');
      await ctx.loginPage.assertPasswordError('Password is required');
      break;

    case 'LOG-006': {
      const otpPage = await ctx.loginPage.requestOtpForMobile(ctx.primary.mobile);
      expect(await otpPage.isLoaded()).toBe(true);
      await otpPage.verify();
      await expect(ctx.page).not.toHaveURL(/Home\/Login|Login/i);
      await ctx.dashboardPage.logout();
      break;
    }

    case 'LOG-007':
      await ctx.loginPage.requestOtpForMobile(ctx.unregisteredMobile);
      await ctx.loginPage.assertErrorContains(/user not found|not registered|invalid/i);
      break;

    case 'LOG-008':
      await ctx.loginPage.requestOtpForMobile('');
      await ctx.loginPage.assertMobileError(/required|mobile/i);
      break;

    case 'LOG-009':
      await ctx.loginPage.requestOtpForMobile(INVALID_MOBILE);
      await ctx.loginPage.assertErrorContains(/10.?digit|invalid mobile|validation/i);
      break;

    case 'LOG-010': {
      const otpPage = await ctx.loginPage.submitCredentials(ctx.primary.mobile, ctx.primary.password);
      expect(await otpPage.isLoaded()).toBe(true);
      expect(await otpPage.isVerifyButtonEnabled()).toBe(true);
      break;
    }

    case 'LOG-011': {
      const otpPage = await ctx.loginPage.submitCredentials(ctx.primary.mobile, ctx.primary.password);
      expect(await otpPage.isLoaded()).toBe(true);
      break;
    }

    case 'LOG-012': {
      const otpPage = await ctx.loginPage.submitCredentials(ctx.primary.mobile, ctx.primary.password);
      expect(await otpPage.isLoaded()).toBe(true);
      await otpPage.verify(WRONG_OTP);
      expect(await otpPage.isLoaded()).toBe(true);
      expect(await otpPage.isErrorVisible()).toBe(true);
      break;
    }

    case 'LOG-013': {
      const termsPage = new TermsPage(ctx.page);
      await ctx.loginPage.login(ctx.primary.mobile, ctx.primary.password);
      if (!(await termsPage.isLoaded())) {
        await ctx.dashboardPage.assertDashboardLoaded();
        break;
      }
      await termsPage.accept();
      await ctx.dashboardPage.assertDashboardLoaded();
      break;
    }

    case 'LOG-014': {
      const termsPage = new TermsPage(ctx.page);
      await ctx.loginPage.login(ctx.primary.mobile, ctx.primary.password);
      if (await termsPage.isLoaded()) await termsPage.accept();
      await ctx.dashboardPage.assertDashboardLoaded();
      break;
    }

    case 'LOG-015': {
      const termsPage = new TermsPage(ctx.page);
      await ctx.loginPage.login(ctx.primary.mobile, ctx.primary.password);
      if (!(await termsPage.isLoaded())) break;
      await expect(ctx.page).toHaveURL(/terms|consent|LoginOtpVerification|NayaraDashboard/i);
      break;
    }

    case 'LOG-055':
      expect(await ctx.loginPage.isPasswordMasked()).toBe(true);
      break;

    case 'LOG-057':
      await ctx.loginPage.login(` ${ctx.primary.mobile} `, ctx.primary.password);
      await ctx.loginPage.assertErrorContains(/invalid credentials|validation|required/i);
      break;

    case 'LOG-058': {
      const lower = ctx.primary.password.toLowerCase();
      await ctx.loginPage.login(ctx.primary.mobile, lower);
      await ctx.loginPage.assertErrorContains(/invalid credentials/i);
      break;
    }

    case 'LOG-059':
      await ctx.loginPage.login(ctx.primary.mobile, ctx.primary.password);
      await expect(ctx.page).not.toHaveURL(/Home\/Login|Login/i);
      await ctx.dashboardPage.logout();
      break;

    case 'LOG-060':
      await ctx.loginPage.login(`' OR '1'='1`, ctx.primary.password);
      await ctx.loginPage.assertErrorContains(/invalid credentials|validation/i);
      break;

    case 'LOG-061':
    case 'LOG-062':
    case 'LOG-065':
    case 'LOG-066': {
      const otpPage = await ctx.loginPage.submitCredentials(ctx.primary.mobile, ctx.primary.password);
      expect(await otpPage.isLoaded()).toBe(true);
      const badOtp = tc.tcId === 'LOG-061' ? '123456'
        : tc.tcId === 'LOG-062' ? 'ABCDEF'
          : tc.tcId === 'LOG-065' ? '12345'
            : '1234567';
      await otpPage.verify(badOtp.slice(0, 6));
      expect(await otpPage.isErrorVisible()).toBe(true);
      break;
    }

    case 'LOG-071':
      await ctx.loginPage.submitCredentials(ctx.primary.mobile, ctx.primary.password);
      break;

    case 'LOG-073':
      await ctx.loginPage.login(ctx.invalidUsername, ctx.invalidPassword);
      await ctx.loginPage.assertErrorContains(/invalid credentials|user not found/i);
      await expect(ctx.page.locator('text=/stack trace|exception|undefined/i')).toHaveCount(0);
      break;

    case 'LOG-075':
      await ctx.loginPage.login(`<script>alert('xss')</script>`, ctx.primary.password);
      await ctx.loginPage.assertErrorContains(/invalid credentials|validation/i);
      await expect(ctx.page.locator('text=alert')).toHaveCount(0);
      break;

    case 'LOG-086':
      await ctx.loginPage.tabThroughLoginForm();
      expect(await ctx.loginPage.isPasswordFieldFocused()).toBe(true);
      break;

    case 'LOG-087':
      await ctx.loginPage.fillCredentials(ctx.primary.mobile, ctx.primary.password);
      await ctx.loginPage.pressEnterOnLoginForm();
      await expect(ctx.page).not.toHaveURL(/Home\/Login|Login/i);
      await ctx.dashboardPage.logout();
      break;

    case 'LOG-089':
      await ctx.loginPage.login(ctx.invalidUsername, ctx.invalidPassword);
      await ctx.loginPage.assertErrorContains(/invalid credentials|user not found/i);
      await expect(ctx.page.locator('text=/stack trace|System\\.Exception/i')).toHaveCount(0);
      break;

    default:
      throw new Error(`No web executor implemented for ${tc.tcId}`);
  }
}

export async function runMultiUserLogin(
  cred: FleetPlusCredential,
  loginPage: LoginPage,
  dashboardPage: DashboardPage,
  page: Page
): Promise<void> {
  await loginPage.login(cred.mobile, cred.password);
  await expect(page).not.toHaveURL(/Home\/Login|Login/i);
  await dashboardPage.assertDashboardLoaded();
  await dashboardPage.logout();
}
