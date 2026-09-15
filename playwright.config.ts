import { defineConfig, devices } from '@playwright/test';
import * as dotenv from 'dotenv';

dotenv.config({ path: `.env.${process.env.ENV || 'dev'}` });

/**
 * Specs that drive authentication themselves. They get their own project so they
 * run unauthenticated; every other browser project skips them.
 */
const AUTH_TESTS = /auth[\\/]login[\w-]*\.spec\.ts/;

/**
 * Browser projects must not pick up the auth setup, the API specs, or the auth
 * specs — those belong to the `setup`, `api` and `auth` projects. Without this the
 * API suite runs once per browser and auth.setup.ts executes as an ordinary test.
 */
/** Database specs need no browser and belong to the `database` project. */
const DB_TESTS = /database[\\/].*\.spec\.ts/;

/**
 * User Management specs create real records and drive their own login, so they
 * get one project rather than running once per browser — five browsers would
 * mean five customer applications in the reviewer queue per run.
 */
/**
 * The two matrix suites that talk to the SAP APIs directly.
 *
 * They open no browser and hold no session, so nothing stops them running many
 * at once — unlike every other suite here, which is bounded by how many
 * entitled accounts exist rather than by how many browsers can be launched.
 * 45 of the 134 tests are in here.
 */
const API_MATRIX_TESTS = /user-management[\\/]matrix-(office|ro)-api\.spec\.ts/;

const USER_MANAGEMENT_TESTS = /user-management[\\/].*\.spec\.ts/;

/**
 * Customer Management specs, for the same reasons: they drive their own login
 * and several of them change real records, so running them once per browser
 * would multiply the side effects by five. They also must not inherit the
 * chromium project's storageState — replaying a saved FleetPlus session returns
 * "Session Expired, Please login again!", so a spec that looks authenticated
 * would in fact be sitting on the login page.
 */
const CUSTOMER_MANAGEMENT_TESTS = /customer-management[\\/].*\.spec\.ts/;

const BROWSER_TEST_IGNORE = [
  /.*\.setup\.ts/,
  /.*\.api\.spec\.ts/,
  AUTH_TESTS,
  DB_TESTS,
  USER_MANAGEMENT_TESTS,
  CUSTOMER_MANAGEMENT_TESTS,
];

export default defineConfig({
  // Test directory
  testDir: './tests',

  // Run all tests in parallel
  fullyParallel: true,

  // Fail the build on CI if you accidentally left test.only
  forbidOnly: !!process.env.CI,

  // Retry on CI only
  retries: process.env.CI ? 2 : 0,

  /**
   * One worker locally by default, because FleetPlus evicts other sessions for
   * the same account: two browser workers logged in as the same user knock each
   * other out mid-test. Parallelism here is bounded by accounts, not CPUs.
   *
   * WORKERS overrides it, which is how the API matrix runs wide — those tests
   * hold no session and cannot collide.
   */
  workers: Number(process.env.WORKERS ?? (process.env.CI ? 4 : 1)),

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

    // Keep a trace for every failure, not only for retried ones. Retries are 0
    // locally, so 'on-first-retry' meant a local failure produced no trace at all
    // — exactly when one is most useful. Allure attaches these to the result.
    trace: 'retain-on-failure',

    // Screenshot on failure
    screenshot: 'only-on-failure',

    // Video on failure, for the same reason as the trace above.
    video: 'retain-on-failure',

    // Action timeout
    actionTimeout: 15_000,

    // Navigation timeout
    navigationTimeout: 60_000,

    // Headless everywhere. A full matrix run is half an hour of browser windows
    // taking focus, and the evidence the suite is judged on is the screenshots
    // and database reads it captures, not the live window. Set HEADED=true to
    // watch a run while debugging.
    headless: process.env.HEADED !== 'true',

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

    // Database tests — no browser, no setup dependency. Read-only queries against
    // the QA SQL Server, used to resolve test-data preconditions the UI masks.
    {
      name: 'database',
      testMatch: DB_TESTS,
    },

    // User Management — drives login itself and needs the database alongside the
    // browser, so it inherits neither storageState nor the setup project.
    // Browser-driven user management. Excludes the API matrices below, which
    // would otherwise be dragged down to this project's single worker.
    {
      name: 'user-management',
      use: { ...devices['Desktop Chrome'] },
      testMatch: USER_MANAGEMENT_TESTS,
      testIgnore: API_MATRIX_TESTS,
    },

    // Office and RO onboarding matrices. No browser, no session, safe to run
    // many at once:  WORKERS=8 npx playwright test --project=api-matrix
    {
      name: 'api-matrix',
      testMatch: API_MATRIX_TESTS,
    },

    // Customer Management — same shape as user-management: drives its own
    // login, needs the database, and inherits neither storageState nor setup.
    {
      name: 'customer-management',
      use: { ...devices['Desktop Chrome'] },
      testMatch: CUSTOMER_MANAGEMENT_TESTS,
    },

    // Data-building tools. These CREATE REAL RECORDS — a customer onboarded to
    // Active, users that persist — so they are opt-in: the project only exists
    // when TOOLS=true, and a normal run cannot reach them however broad its
    // --grep. Run one with:
    //   TOOLS=true ENV=qa npx playwright test --project=tools
    ...(process.env.TOOLS === 'true'
      ? [{
          name: 'tools',
          testDir: './tools',
          use: { ...devices['Desktop Chrome'] },
        }]
      : []),
  ],
});
