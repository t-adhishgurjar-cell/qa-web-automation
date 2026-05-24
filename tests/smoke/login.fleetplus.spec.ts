import { test, expect } from '../../src/fixtures/page.fixtures';
import { DataReader } from '../../src/helpers/data-reader.helper';
import { epic, feature, story, severity, description, owner } from 'allure-js-commons';

type FleetPlusLoginRow = {
  '#': string | number;
  Role?: string;
  'username/phone'?: string | number;
  'Test Password'?: string;
  'Test Email'?: string;
  'Created? ✅'?: string;
  'Login Tested? ✅'?: string;
};

const fleetplusUsers = DataReader.fromExcel<FleetPlusLoginRow>(
  'test-data/fleetplus-login-data.xlsx',
  'User Creation Checklist',
  2
).filter(
  row => row['username/phone'] && row['Test Password'] && String(row['Created? ✅'] || '').toLowerCase().startsWith('y')
);

test.describe('FleetPlus Login Tests @smoke @login', () => {
  test.beforeEach(async ({ loginPage }) => {
    await epic('Authentication');
    await feature('Login');
    await owner('QA Team');
    await loginPage.navigate();
    await loginPage.assertLoginPageLoaded();
  });

  for (const row of fleetplusUsers) {
    const username = String(row['username/phone']).trim();
    const password = String(row['Test Password'] ?? '').trim();
    const role = row.Role ? String(row.Role).trim() : 'User';
    const rowId = String(row['#'] ?? '').trim();

    if (!username || !password) continue;

    const testName = rowId
      ? `Login as ${role} [${username}] (row ${rowId})`
      : `Login as ${role} [${username}]`;

    test(testName, async ({ loginPage, dashboardPage, page }) => {
      await story(role);
      await severity('critical');
      await description(`Verifies login works for ${role} using ${username}`);

      await loginPage.login(username, password);
      await expect(page).not.toHaveURL(/Home\/Login|Login/i);
      await expect(page.locator('#btnLogin')).toBeHidden();

      await dashboardPage.logout();
      await expect(page.locator('#btnLogin')).toBeVisible();
    });
  }
});
