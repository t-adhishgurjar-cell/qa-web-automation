import { test } from '../../src/fixtures/page.fixtures';
import { epic, feature, story, severity, description } from 'allure-js-commons';

test.describe('Dashboard - E2E Tests @regression @dashboard', () => {
  test.use({ storageState: 'config/.auth/user.json' });

  test.afterEach(async ({ page }) => {
    await page.context().clearCookies();
  });

  test('should display dashboard after login', async ({ dashboardPage }) => {
    await epic('Dashboard');
    await feature('Dashboard Load');
    await story('Dashboard Display');
    await severity('critical');
    await description('Verifies dashboard loads correctly with navigation and user avatar visible');
    await dashboardPage.navigate();
    await dashboardPage.assertDashboardLoaded();
  });

  test('should navigate to a section via sidebar', async ({ dashboardPage }) => {
    await epic('Dashboard');
    await feature('Sidebar Navigation');
    await story('Navigate to Manage Users');
    await severity('normal');
    await description('Verifies expanding Admin menu and navigating to Manage Users');
    await dashboardPage.navigate();
    await dashboardPage.assertDashboardLoaded();
    await dashboardPage.expandSidebarSection('Admin');
    await dashboardPage.navigateToSection('Manage Users');
    await dashboardPage.assertURL(/ManageUser|Manage Users|Admin/i);
  });

  test('should log out successfully', async ({ dashboardPage, loginPage }) => {
    await epic('Authentication');
    await feature('Logout');
    await story('Logout Flow');
    await severity('critical');
    await description('Verifies the user can log out and is redirected to the login page');
    await dashboardPage.navigate();
    await dashboardPage.assertDashboardLoaded();
    await dashboardPage.logout();
    await loginPage.assertLoginPageLoaded();
  });
});
