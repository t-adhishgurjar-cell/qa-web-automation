import { defineConfig, devices } from '@playwright/test';
import * as dotenv from 'dotenv';

dotenv.config({ path: `.env.${process.env.ENV || 'dev'}` });

/**
 * Specs that drive authentication themselves. They get their own project so they
 * run unauthenticated; every other browser project skips them.
 */
const AUTH_TESTS = /auth\/login\.spec\.ts/;

/**
 * Browser projects must not pick up the auth setup, the API specs, or the auth
 * specs — those belong to the `setup`, `api` and `auth` projects. Without this the
 * API suite runs once per browser and auth.setup.ts executes as an ordinary test.
 */
const BROWSER_TEST_IGNORE = [/.*\.setup\.ts/, /.*\.api\.spec\.ts/, AUTH_TESTS];

export default defineConfig({
  // Test directory
  testDir: './tests',

  // Run all tests in parallel
  fullyParallel: true,

  // Fail the build on CI if you accidentally left test.only
  forbidOnly: !!process.env.CI,

  // Retry on CI only
  retries: process.env.CI ? 2 : 0,

  // Limit parallel workers on CI
  workers: process.env.CI ? 4 : 1,

  // Global timeout per test
  timeout: 60_000,

  // Expect timeout
  expect: {
    timeout: 10_000,
  },

  // Reporter configuration
  reporter: [
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
    ['junit', { outputFile: 'test-results/junit.xml' }],
    ['allure-playwright', { outputFolder: 'allure-results', detail: true, suiteTitle: false }],
    ['./reporters/custom-reporter.ts'],
    ...(process.env.CI ? [['github'] as ['github']] : [['list'] as ['list']]),
  ],

  // Shared settings for all projects
  use: {
    // Base URL from environment
    baseURL: process.env.BASE_URL || 'https://example.com',

    // Collect trace on first retry
    trace: 'on-first-retry',

    // Screenshot on failure
    screenshot: 'only-on-failure',

    // Video on first retry
    video: 'on-first-retry',

    // Action timeout
    actionTimeout: 15_000,

    // Navigation timeout
    navigationTimeout: 60_000,

    // Run headed locally, headless on CI
    headless: !!process.env.CI,

    // Viewport
    viewport: { width: 1280, height: 720 },

    // Locale
    locale: 'en-US',

    // Extra HTTP headers
    extraHTTPHeaders: {
      'x-test-framework': 'playwright-org-framework',
    },
  },

  // Output folder for test artifacts
  outputDir: 'test-results',

  // Browser projects
  projects: [
    // Setup project (auth state)
    {
      name: 'setup',
      testMatch: /.*\.setup\.ts/,
    },

    // Authentication specs — these drive login themselves, so they must NOT inherit
    // a pre-authenticated storageState or depend on the setup project. Binding them
    // to `setup` would gate the login suite on the very login it exists to verify.
    {
      name: 'auth',
      use: { ...devices['Desktop Chrome'] },
      testMatch: AUTH_TESTS,
    },

    // Chromium
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        storageState: 'config/.auth/user.json',
      },
      testIgnore: BROWSER_TEST_IGNORE,
      dependencies: ['setup'],
    },

    // Firefox
    {
      name: 'firefox',
      use: {
        ...devices['Desktop Firefox'],
        storageState: 'config/.auth/user.json',
      },
      testIgnore: BROWSER_TEST_IGNORE,
      dependencies: ['setup'],
    },

    // WebKit (Safari)
    {
      name: 'webkit',
      use: {
        ...devices['Desktop Safari'],
        storageState: 'config/.auth/user.json',
      },
      testIgnore: BROWSER_TEST_IGNORE,
      dependencies: ['setup'],
    },

    // Mobile Chrome
    {
      name: 'mobile-chrome',
      use: { ...devices['Pixel 5'] },
      testIgnore: BROWSER_TEST_IGNORE,
    },

    // Mobile Safari
    {
      name: 'mobile-safari',
      use: { ...devices['iPhone 13'] },
      testIgnore: BROWSER_TEST_IGNORE,
    },

    // API tests — no browser, no setup dependency
    {
      name: 'api',
      testMatch: /.*\.api\.spec\.ts/,
    },
  ],
});
