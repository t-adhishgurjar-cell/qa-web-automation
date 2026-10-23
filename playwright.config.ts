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
const VEHICLE_TESTS = /vehicle[\\/].*\.spec\.ts/;

/**
 * The suites that carry a browser dimension, and the browsers they run on.
 *
 * Kept as data so adding a browser is one line here rather than a copy of every project.
 * Chrome has no suffix so that the original project names keep working.
 */
const MODULE_SUITES: Array<{ name: string; testMatch: RegExp; testIgnore?: RegExp }> = [
  { name: 'auth', testMatch: AUTH_TESTS },
  // Excludes the API matrices, which would otherwise be dragged down to this
  // project's single worker.
  { name: 'user-management', testMatch: USER_MANAGEMENT_TESTS, testIgnore: API_MATRIX_TESTS },
  { name: 'customer-management', testMatch: CUSTOMER_MANAGEMENT_TESTS },
  // tests/vehicle also holds coverage.api.spec.ts, which belongs to the `api`
  // project and opens no browser. Vehicle specs CHANGE VEHICLE STATE — blocking a
  // vehicle stops it transacting — which is why this is selectable on its own.
  { name: 'vehicle', testMatch: VEHICLE_TESTS, testIgnore: /.*\.api\.spec\.ts/ },
];

const MODULE_BROWSERS: Array<{ suffix: string; device: 'Desktop Chrome' | 'Desktop Firefox' }> = [
  { suffix: '', device: 'Desktop Chrome' },
  { suffix: '-firefox', device: 'Desktop Firefox' },
];

const BROWSER_TEST_IGNORE = [
  /.*\.setup\.ts/,
  /.*\.api\.spec\.ts/,
  AUTH_TESTS,
  DB_TESTS,
  USER_MANAGEMENT_TESTS,
  CUSTOMER_MANAGEMENT_TESTS,
  VEHICLE_TESTS,
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
    // resultsDir, not outputFolder.
    //
    // allure-playwright is on 3.7.1, where the option is `resultsDir`; `outputFolder` was the Allure 2
    // name. Passing the old options object did not warn and did not fail the run — it simply wrote no
    // results at all, so `npm run allure:report` generated an empty report from an empty directory and
    // every run looked like it had produced nothing to report. Measured: the same project writes 5
    // result files with the reporter's defaults and 0 through the old options.
    ['allure-playwright', { resultsDir: process.env.ALLURE_RESULTS_DIR ?? 'allure-results', detail: true }],
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

    // ── The module suites, once per browser ─────────────────────────────────
    //
    // These four drive their own login and need the database alongside the browser, so
    // they inherit neither storageState nor the setup project.
    //
    // They are generated rather than written out because each one now exists per browser.
    // Written by hand that was four literals; across two browsers it would be eight, and
    // the pairs would drift — the vehicle project's testIgnore for .api.spec.ts is
    // exactly the kind of detail that gets added to one copy and not the other.
    //
    // Naming is deliberate: the Chrome variant keeps the bare name it has always had, so
    // every command, script and document that says --project=customer-management still
    // means what it meant. Firefox is the suffixed sibling.
    //
    // ── On running them at the same time ────────────────────────────────────
    // Chrome and Firefox in parallel is two concurrent sessions per account, and this
    // application enforces a single session — hence #profile-active-session-ok-btn and
    // the tab-takeover controls the login page carries. Two browsers signed in as the
    // same FP Admin will evict each other, and the resulting failures look like
    // application defects rather than a provisioning problem. So simultaneous
    // cross-browser running needs a second set of accounts: set FP_ADMIN_USER, DSA_USER
    // and TSM_USER for one and FIREFOX_FP_ADMIN_USER and friends for the other. Until
    // those exist, run the two browsers one after the other, which costs time and
    // nothing else.
    ...MODULE_SUITES.flatMap(suite =>
      MODULE_BROWSERS.map(browser => ({
        name: `${suite.name}${browser.suffix}`,
        use: { ...devices[browser.device] },
        testMatch: suite.testMatch,
        ...(suite.testIgnore ? { testIgnore: suite.testIgnore } : {}),
      }))
    ),

    // Office and RO onboarding matrices. No browser, no session, safe to run
    // many at once:  WORKERS=8 npx playwright test --project=api-matrix
    {
      name: 'api-matrix',
      testMatch: API_MATRIX_TESTS,
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
