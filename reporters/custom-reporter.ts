import {
  Reporter,
  TestCase,
  TestResult,
  FullResult,
  Suite,
  FullConfig,
} from '@playwright/test/reporter';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const ALLURE_RESULTS = 'allure-results';

/**
 * Defect buckets for the Allure report.
 *
 * Without these every failure lands in one undifferentiated pile. The distinction
 * that matters on this project is *whose problem it is*: a product defect needs a
 * ticket, a missing test account needs provisioning, and a blocked environment
 * needs a network — and only the first is a reason to stop a release.
 *
 * Matched against the failure message, so the messages the page objects throw are
 * written to be matchable.
 */
const ALLURE_CATEGORIES = [
  {
    name: 'Product defect',
    matchedStatuses: ['failed'],
    messageRegex: '.*Known defect.*',
  },
  {
    name: 'Missing test data',
    matchedStatuses: ['skipped', 'broken'],
    messageRegex: '.*(Set [A-Z_]+ to|not in the credentials workbook|No credentials could be read).*',
  },
  {
    name: 'Blocked by the environment',
    matchedStatuses: ['skipped', 'broken', 'failed'],
    messageRegex: '.*(never reached FleetPlus|answered by an intermediary|ECONNREFUSED|ENOTFOUND).*',
  },
  {
    name: 'Account state — password change required',
    matchedStatuses: ['failed'],
    messageRegex: '.*forced password-change screen.*',
  },
  {
    name: 'Account state — locked out',
    matchedStatuses: ['failed', 'broken'],
    messageRegex: '.*(is locked out|account has been locked).*',
  },
  {
    name: 'Page script not ready',
    matchedStatuses: ['failed', 'broken'],
    messageRegex: '.*(click handler is not working|never opened after|dropdown is not responding).*',
  },
  {
    name: 'Timeout',
    matchedStatuses: ['failed', 'broken'],
    messageRegex: '.*(Timeout|timed out|exceeded).*',
  },
  {
    name: 'Test defect',
    matchedStatuses: ['broken'],
  },
];

interface TestSummary {
  total:   number;
  passed:  number;
  failed:  number;
  skipped: number;
  flaky:   number;
  duration: number;
  failures: Array<{ title: string; error: string }>;
}

export default class CustomReporter implements Reporter {
  private summary: TestSummary = {
    total:    0,
    passed:   0,
    failed:   0,
    skipped:  0,
    flaky:    0,
    duration: 0,
    failures: [],
  };

  private startTime = Date.now();

  // Captured in onBegin, used in onEnd. The Allure reporter clears allure-results
  // when it starts, so metadata written at the beginning of the run is deleted
  // before the report is ever generated — it has to be written at the end.
  private config?: FullConfig;
  private collected = 0;

  onBegin(config: FullConfig, suite: Suite): void {
    this.startTime = Date.now();
    this.config = config;
    this.collected = suite.allTests().length;
    console.log(`\n🚀 Starting test run — ${this.collected} tests found\n`);
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    this.summary.total++;
    this.summary.duration += result.duration;

    const icon = {
      passed:  '✅',
      failed:  '❌',
      skipped: '⏭️',
      timedOut: '⏰',
      interrupted: '🛑',
    }[result.status] ?? '❓';

    console.log(`  ${icon} ${test.title} (${result.duration}ms)`);

    // Counted by outcome, not raw status. A test marked test.fail() reports
    // status 'failed' while being an *expected* failure — counting the status
    // made the summary disagree with Playwright's own tally, and made a
    // documented known defect look like a broken build.
    switch (test.outcome()) {
      case 'expected':
        this.summary.passed++;
        break;
      case 'flaky':
        this.summary.flaky++;
        break;
      case 'skipped':
        this.summary.skipped++;
        break;
      case 'unexpected':
        this.summary.failed++;
        this.summary.failures.push({
          title: test.title,
          error: result.errors[0]?.message ?? 'Unknown error',
        });
        break;
    }
  }

  onEnd(result: FullResult): void {
    const totalDuration = ((Date.now() - this.startTime) / 1000).toFixed(2);
    const statusIcon = result.status === 'passed' ? '🎉' : '💥';

    console.log(`\n${'─'.repeat(60)}`);
    console.log(`${statusIcon} Test Run Complete — ${result.status.toUpperCase()}`);
    console.log(`${'─'.repeat(60)}`);
    console.log(`  Total:    ${this.summary.total}`);
    console.log(`  ✅ Passed:  ${this.summary.passed}`);
    console.log(`  ❌ Failed:  ${this.summary.failed}`);
    console.log(`  ⏭️  Skipped: ${this.summary.skipped}`);
    console.log(`  🔄 Flaky:   ${this.summary.flaky}`);
    console.log(`  ⏱️  Duration: ${totalDuration}s`);

    if (this.summary.failures.length > 0) {
      console.log(`\n❌ Failed Tests:`);
      this.summary.failures.forEach(f => {
        console.log(`   • ${f.title}`);
        console.log(`     ${f.error.substring(0, 120)}...`);
      });
    }

    console.log(`${'─'.repeat(60)}\n`);

    // Write JSON summary to disk
    this.writeSummaryToDisk();

    // Allure's own metadata files, written now that the reporter has finished
    // clearing and populating allure-results.
    if (this.config) this.writeAllureMetadata(this.config, this.collected);
  }

  /**
   * Writes the three files that turn a bare Allure result set into a report you
   * can act on:
   *
   *   environment.properties — what was tested, where, and with which build. A
   *                            result without this is unattributable a week later.
   *   categories.json        — how failures are bucketed (see ALLURE_CATEGORIES).
   *   executor.json          — who ran it, and a link back to the CI job.
   *
   * Failures here are logged and swallowed: reporting metadata must never take
   * down a test run.
   */
  private writeAllureMetadata(config: FullConfig, collected: number): void {
    try {
      fs.mkdirSync(ALLURE_RESULTS, { recursive: true });

      const env = process.env.ENV ?? 'dev';
      const projects = config.projects.map(p => p.name).filter(Boolean);

      const environment: Record<string, string> = {
        Environment: env,
        'Base.URL': process.env.BASE_URL ?? '(unset)',
        'Test.suite': 'FleetPlus Login',
        'Test.cases.source': 'test-data/Nayara_FleetPlus_Login_TestCases.xlsx',
        'Credentials.source': 'test-data/FleetPlusUsercredentials.xlsx',
        'Tests.collected': String(collected),
        'Playwright.projects': projects.join(', ') || '(none)',
        Workers: String(config.workers),
        Retries: String(config.projects[0]?.retries ?? 0),
        'Playwright.version': config.version,
        'Node.version': process.version,
        Platform: `${process.platform} ${process.arch}`,
        'Run.started': new Date(this.startTime).toISOString(),
        'Run.duration.seconds': ((Date.now() - this.startTime) / 1000).toFixed(1),
        'Result.passed': String(this.summary.passed),
        'Result.failed': String(this.summary.failed),
        'Result.skipped': String(this.summary.skipped),
        'Result.flaky': String(this.summary.flaky),
        'Captcha.bypass': 'enabled on QA — captcha correctness is not enforced',
      };

      // Which gated accounts were supplied. A reader's first question about a
      // skipped test is "what would it take to run this?", and this answers it.
      environment['Account.primary'] = process.env.PRIMARY_CREDENTIAL_MOBILE ?? '(workbook default)';
      environment['Account.locked'] = process.env.LOCKED_TEST_USER ? 'provided' : 'NOT PROVIDED — unlock tests skip';
      environment['Account.forgot.password'] = process.env.FORGOT_PASSWORD_TEST_USER
        ? 'provided'
        : 'NOT PROVIDED — OTP tests skip';

      const git = (command: string): string => {
        try {
          return execSync(command, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
        } catch {
          return '';
        }
      };
      const branch = git('git rev-parse --abbrev-ref HEAD');
      const commit = git('git log -1 --pretty=format:%h %s');
      if (branch) environment['Git.branch'] = branch;
      if (commit) environment['Git.commit'] = commit;

      fs.writeFileSync(
        path.join(ALLURE_RESULTS, 'environment.properties'),
        Object.entries(environment)
          // Properties files treat these as syntax, so they are escaped.
          .map(([k, v]) => `${k}=${String(v).replace(/[\\:=]/g, m => `\\${m}`)}`)
          .join('\n')
      );

      fs.writeFileSync(
        path.join(ALLURE_RESULTS, 'categories.json'),
        JSON.stringify(ALLURE_CATEGORIES, null, 2)
      );

      fs.writeFileSync(
        path.join(ALLURE_RESULTS, 'executor.json'),
        JSON.stringify(
          {
            name: process.env.CI ? 'GitHub Actions' : 'Local run',
            type: process.env.CI ? 'github' : 'local',
            buildName: `FleetPlus Login — ${env}`,
            buildOrder: Number(process.env.GITHUB_RUN_NUMBER ?? 0),
            buildUrl: process.env.GITHUB_SERVER_URL && process.env.GITHUB_REPOSITORY
              ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
              : undefined,
            reportName: 'FleetPlus Login regression',
          },
          null,
          2
        )
      );
    } catch (error) {
      console.warn(`Could not write Allure metadata: ${(error as Error).message}`);
    }
  }

  private writeSummaryToDisk(): void {
    const outDir = 'test-results';
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(
      path.join(outDir, 'summary.json'),
      JSON.stringify(this.summary, null, 2)
    );
  }
}
