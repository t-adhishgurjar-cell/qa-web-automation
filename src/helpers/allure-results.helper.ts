import * as fs from 'fs';
import * as path from 'path';

/**
 * Reads allure-playwright result files, so a sheet case can be judged from the tests
 * that already cover it rather than by running them a second time.
 */
export interface AllureOutcome {
  name: string;
  titlePath: string;
  status: 'passed' | 'failed' | 'broken' | 'skipped' | 'unknown';
  message: string;
  start: number;
}

export function loadAllureResults(dirs: string[]): AllureOutcome[] {
  const out: AllureOutcome[] = [];
  for (const dir of dirs) {
    if (!dir || !fs.existsSync(dir)) continue;
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith('-result.json')) continue;
      try {
        const d = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
        const titlePath = (d.labels ?? []).find((l: { name: string }) => l.name === 'titlePath')?.value ?? d.fullName ?? '';
        out.push({
          name: d.name ?? '',
          titlePath,
          status: d.status ?? 'unknown',
          message: (d.statusDetails?.message ?? '').split('\n')[0].slice(0, 300),
          start: d.start ?? 0,
        });
      } catch {
        // A half-written or foreign file is not evidence either way.
      }
    }
  }
  return out;
}

/** The newest outcome whose file and title match. A test run twice is judged by its latest run. */
export function findOutcome(
  results: AllureOutcome[],
  file: string,
  title: RegExp
): AllureOutcome | undefined {
  const base = path.basename(file);
  return results
    .filter(r => r.titlePath.includes(base) && title.test(`${r.titlePath} > ${r.name}`))
    // --list inventory runs leave skipped rows with start === 0; a real run always beats them.
    .sort((a, b) => b.start - a.start)[0];
}
