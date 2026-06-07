import { test as setup } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';
import { FleetPlusTestData } from '../src/helpers/fleetplus-test-data.helper';
import { LoginPage } from '../src/pages/login.page';

const authFile = path.join(__dirname, '../config/.auth/user.json');

setup('authenticate', async ({ page }) => {
  const { mobile, password } = FleetPlusTestData.getPrimaryCredential();
  const loginPage = new LoginPage(page);

  await loginPage.navigate();
  await loginPage.login(mobile, password);

  fs.mkdirSync(path.dirname(authFile), { recursive: true });
  await page.context().storageState({ path: authFile });
});
