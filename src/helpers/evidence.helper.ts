import { Page } from '@playwright/test';
import { attachment } from 'allure-js-commons';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Step-by-step visual evidence for a test.
 *
 * Allure already records what a test asserted. What it does not record is what
 * the screen looked like at each step, and for a flow that spans two subsystems
 * — a UI wizard and the database behind it — that is the part a reader needs to
 * believe the result. A green tick proves the assertion ran; a screenshot of the
 * Add User form next to the row it produced proves the assertion was about the
 * right thing.
 *
 * So every step is captured twice: once into Allure (attachments, for the test
 * report) and once into a manifest on disk (for the standalone visual report,
 * which interleaves UI and database steps in the order they actually happened).
 * The manifest is the ordering — filenames alone would lose it, and interleaving
 * is the whole point: "form filled -> row appeared" reads as cause and effect,
 * two separate galleries do not.
 *
 * Screenshots never fail a test. A page that has closed or navigated mid-capture
 * is a worse reason to lose a run than any evidence is worth, so capture errors
 * are recorded as a step of their own and the test continues.
 */

export type StepKind = 'ui' | 'db' | 'note';

export interface EvidenceStep {
  index: number;
  kind: StepKind;
  title: string;
  /** One line saying why this step matters — becomes the caption. */
  caption: string;
  /** Screenshot filename relative to the run directory, for `ui` steps. */
  image?: string;
  /** Text body, for `db` and `note` steps. */
  body?: string;
  /** URL the screenshot was taken at, so a reader can tell which screen it is. */
  url?: string;
  at: string;
}

export interface EvidenceManifest {
  test: string;
  status: 'passed' | 'failed' | 'skipped' | 'unknown';
  startedAt: string;
  finishedAt?: string;
  /** Free-form facts shown as a header strip — mobile under test, run tag, etc. */
  facts: Record<string, string>;
  steps: EvidenceStep[];
}

/** Where every run writes. Read by scripts/build-visual-report.ts. */
export const EVIDENCE_ROOT = path.resolve(process.cwd(), 'visual-evidence');

export class Evidence {
  private readonly steps: EvidenceStep[] = [];
  private readonly facts: Record<string, string> = {};
  private readonly startedAt = new Date().toISOString();
  private readonly dir: string;
  private counter = 0;

  /**
   * @param testName  Shown as the report heading.
   * @param slug      Directory name. Kept stable per test so a re-run replaces
   *                  its own evidence rather than accumulating stale galleries
   *                  that no longer match the code that produced them.
   */
  constructor(private readonly testName: string, private readonly slug: string) {
    this.dir = path.join(EVIDENCE_ROOT, slug);
    fs.rmSync(this.dir, { recursive: true, force: true });
    fs.mkdirSync(this.dir, { recursive: true });
  }

  fact(name: string, value: string): void {
    this.facts[name] = value;
  }

  /**
   * Captures the current screen, whole and settled.
   *
   * "Whole" and "settled" both need work here, and neither is the default:
   * see settle() and capture() below.
   */
  async ui(page: Page, title: string, caption: string): Promise<void> {
    const index = ++this.counter;
    const file = `${String(index).padStart(2, '0')}-${slugify(title)}.png`;

    try {
      const url = page.url();
      await settle(page);
      const buffer = await capture(page);
      fs.writeFileSync(path.join(this.dir, file), buffer);
      await attachment(`${index} — ${title}`, buffer, 'image/png');
      this.steps.push({
        index, kind: 'ui', title, caption, image: file, url, at: new Date().toISOString(),
      });
    } catch (error) {
      // Recorded rather than swallowed: a missing screenshot with no explanation
      // reads as a step that never ran.
      const why = error instanceof Error ? error.message : String(error);
      this.steps.push({
        index, kind: 'note', title, at: new Date().toISOString(),
        caption: 'Screenshot could not be taken at this step.',
        body: why,
      });
    }
  }

  /** Records a database snapshot or diff, verbatim. */
  async db(title: string, caption: string, body: string): Promise<void> {
    const index = ++this.counter;
    await attachment(`${index} — ${title}`, body, 'text/plain');
    this.steps.push({ index, kind: 'db', title, caption, body, at: new Date().toISOString() });
  }

  /** Records a non-visual, non-database fact — an outcome, a decision, a skip. */
  async note(title: string, caption: string, body: string): Promise<void> {
    const index = ++this.counter;
    await attachment(`${index} — ${title}`, body, 'text/plain');
    this.steps.push({ index, kind: 'note', title, caption, body, at: new Date().toISOString() });
  }

  /** Writes the manifest. Safe to call more than once; the last call wins. */
  finish(status: EvidenceManifest['status']): void {
    const manifest: EvidenceManifest = {
      test: this.testName,
      status,
      startedAt: this.startedAt,
      finishedAt: new Date().toISOString(),
      facts: this.facts,
      steps: this.steps,
    };
    fs.writeFileSync(
      path.join(this.dir, 'manifest.json'),
      JSON.stringify(manifest, null, 2)
    );
  }
}

/** Beyond this the image stops being readable and starts being a burden. */
const MAX_SHOT_HEIGHT = 4_000;

/**
 * Waits for the screen to stop being mid-change before photographing it.
 *
 * FleetPlus draws a full-screen spinner over a half-populated form while it
 * fetches the logged-in maker's division, state and region. A screenshot taken
 * the instant a navigation resolves catches that overlay, and the resulting
 * picture shows a greyed-out page with empty fields — which looks like a broken
 * screen and is really just a photograph taken too early.
 *
 * Everything here is best-effort. A screen that never settles is still worth
 * photographing, and a timeout waiting for a spinner must not fail a test whose
 * subject is something else entirely.
 */
async function settle(page: Page): Promise<void> {
  await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);
  await page
    .locator('.spinner-border:visible, .spinner:visible, .loader:visible, .loading-overlay:visible')
    .first()
    .waitFor({ state: 'hidden', timeout: 10_000 })
    .catch(() => undefined);
}

/**
 * Photographs the entire page, including the part below the fold.
 *
 * `fullPage: true` is not enough on its own here. It grows the shot to the
 * *document* height, and this application does not scroll the document — it
 * scrolls an inner container inside a fixed-height layout. The document is
 * therefore exactly one viewport tall no matter how long the form is, so
 * `fullPage` returns a viewport crop and the evidence stops at the fold. That
 * is how a wizard step whose Submit button sits below the fold gets
 * photographed without its Submit button.
 *
 * So the viewport is grown to the tallest scrolling container, the shot taken,
 * and the viewport restored. The width never changes, so no responsive
 * breakpoint moves and the page the test goes on to interact with is the same
 * one it was using before.
 */
async function capture(page: Page): Promise<Buffer> {
  const viewport = page.viewportSize();
  if (!viewport) return page.screenshot({ fullPage: true, timeout: 30_000 });

  const contentHeight = await page.evaluate(() => {
    const scrollers = Array.from(document.querySelectorAll('*'))
      .filter(element => {
        const overflowY = getComputedStyle(element).overflowY;
        return (
          (overflowY === 'auto' || overflowY === 'scroll') &&
          element.scrollHeight > element.clientHeight + 4
        );
      })
      .map(element => element.scrollHeight);

    return Math.max(
      document.documentElement.scrollHeight,
      document.body.scrollHeight,
      ...scrollers,
      0
    );
  });

  // A little slack so the last row is not flush against the bottom edge.
  const target = Math.min(Math.max(contentHeight + 48, viewport.height), MAX_SHOT_HEIGHT);
  if (target <= viewport.height) return page.screenshot({ fullPage: true, timeout: 30_000 });

  await page.setViewportSize({ width: viewport.width, height: target });
  // The resize reflows the layout and pulls in anything lazily rendered.
  await page.waitForTimeout(700);
  try {
    return await page.screenshot({ fullPage: true, timeout: 30_000 });
  } finally {
    await page.setViewportSize(viewport);
    await page.waitForTimeout(300);
  }
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
}
