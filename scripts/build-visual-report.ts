/**
 * Builds the standalone visual evidence report from visual-evidence/.
 *
 * Allure answers "did it pass". This answers "show me". Every screenshot and
 * every database read is embedded in the page itself, in the order it happened,
 * so the file can be opened or sent anywhere with nothing else alongside it —
 * no server, no allure-results directory, no database access.
 *
 * Self-contained means the images are base64 data URIs, and full-page
 * screenshots of long forms are large, so there is a size budget: images are
 * downscaled and, if that is not enough, re-encoded, until the page fits. The
 * budget is enforced rather than hoped for, because a report that silently
 * exceeds it fails to publish with no clue as to why.
 *
 *   npx tsx scripts/build-visual-report.ts [outfile]
 */

import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { EvidenceManifest, EvidenceStep } from '../src/helpers/evidence.helper';

const EVIDENCE_ROOT = path.resolve(process.cwd(), 'visual-evidence');
const OUT = path.resolve(process.cwd(), process.argv[2] ?? 'visual-report.html');

/**
 * Artifact publishing caps the rendered page at 16MB.
 *
 * The figure measured against this is the finished HTML, markup included, so
 * the only headroom needed is a margin for error rather than a second budget.
 */
const BUDGET_BYTES = 15 * 1024 * 1024;

/**
 * Encodings tried in order until the whole page fits the budget.
 *
 * PNG first because these are screenshots of small text and it stays sharp.
 * A full matrix run is ninety-odd full-page captures though, which is well past
 * what PNG can fit, so JPEG follows — lossy, but a readable screenshot beats a
 * report too large to publish.
 */
const ENCODING_LADDER: { width: number; jpegQuality?: number }[] = [
  { width: 1400 },
  { width: 1200 },
  { width: 1200, jpegQuality: 82 },
  { width: 1000, jpegQuality: 75 },
  { width: 900, jpegQuality: 65 },
  { width: 800, jpegQuality: 55 },
  { width: 700, jpegQuality: 45 },
];

// ── Evidence loading ────────────────────────────────────────────────────────

interface LoadedTest {
  manifest: EvidenceManifest;
  dir: string;
}

function loadTests(): LoadedTest[] {
  if (!fs.existsSync(EVIDENCE_ROOT)) {
    throw new Error(
      `No evidence at ${EVIDENCE_ROOT}. Run the suite first — the tests write it as they go.`
    );
  }

  const tests = fs
    .readdirSync(EVIDENCE_ROOT, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => path.join(EVIDENCE_ROOT, entry.name))
    .filter(dir => fs.existsSync(path.join(dir, 'manifest.json')))
    .map(dir => ({
      dir,
      manifest: JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')) as EvidenceManifest,
    }));

  if (!tests.length) throw new Error(`No manifest.json under ${EVIDENCE_ROOT}.`);

  // Oldest first: the report reads as a run, and a run has an order.
  return tests.sort((a, b) => a.manifest.startedAt.localeCompare(b.manifest.startedAt));
}

// ── Images ──────────────────────────────────────────────────────────────────

/**
 * Resizes with sips, which ships with macOS and needs no dependency.
 *
 * Falls back to the original bytes rather than failing: an oversized report is
 * recoverable, a missing one is not.
 */
function encode(source: string, width: number, jpegQuality?: number): { buffer: Buffer; mime: string } {
  const original = fs.readFileSync(source);
  const suffix = jpegQuality ? `q${jpegQuality}.jpg` : 'png';
  const temp = path.join(os.tmpdir(), `evidence-${width}-${suffix}-${path.basename(source)}`);

  try {
    fs.copyFileSync(source, temp);
    const args = ['--resampleWidth', String(width)];
    if (jpegQuality) {
      args.push('-s', 'format', 'jpeg', '--setProperty', 'formatOptions', String(jpegQuality));
    }
    execFileSync('sips', [...args, temp], { stdio: 'ignore' });

    const encoded = fs.readFileSync(temp);
    return encoded.length < original.length
      ? { buffer: encoded, mime: jpegQuality ? 'image/jpeg' : 'image/png' }
      : { buffer: original, mime: 'image/png' };
  } catch {
    return { buffer: original, mime: 'image/png' };
  } finally {
    fs.rmSync(temp, { force: true });
  }
}

function dataUri(encoded: { buffer: Buffer; mime: string }): string {
  return `data:${encoded.mime};base64,${encoded.buffer.toString('base64')}`;
}

// ── Rendering ───────────────────────────────────────────────────────────────

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Curly quotes in captions are intentional; only the markup needs escaping. */
function caption(text: string): string {
  return escapeHtml(text);
}

function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

const KIND_LABEL: Record<EvidenceStep['kind'], string> = {
  ui: 'Screen',
  db: 'Database',
  note: 'Record',
};

function renderStep(step: EvidenceStep, images: Map<string, string>, testSlug: string): string {
  const kind = step.kind;
  const number = String(step.index).padStart(2, '0');

  let body = '';
  if (kind === 'ui' && step.image && images.has(`${testSlug}/${step.image}`)) {
    const src = images.get(`${testSlug}/${step.image}`)!;
    const id = `${testSlug}-${step.index}`;
    body = `
        <figure class="shot">
          <button class="shot-open" type="button" data-full="${id}" aria-label="Open full screenshot">
            <img src="${src}" alt="${caption(step.title)}" loading="lazy">
            <span class="shot-more">Click for the full screen</span>
          </button>
          ${step.url ? `<figcaption class="shot-url"><span>at</span> <code>${escapeHtml(step.url)}</code></figcaption>` : ''}
        </figure>
        <dialog class="lightbox" id="${id}">
          <form method="dialog"><button class="lightbox-close" aria-label="Close">Close</button></form>
          <img src="${src}" alt="${caption(step.title)}">
        </dialog>`;
  } else if (step.body) {
    body = `<pre class="dump"><code>${escapeHtml(step.body)}</code></pre>`;
  }

  return `
      <section class="step step--${kind}">
        <div class="step-rail">
          <span class="step-num">${number}</span>
        </div>
        <div class="step-body">
          <p class="step-kind">${KIND_LABEL[kind]}</p>
          <h3 class="step-title">${caption(step.title)}</h3>
          <p class="step-caption">${caption(step.caption)}</p>
          ${body}
        </div>
      </section>`;
}

function renderTest(test: LoadedTest, images: Map<string, string>): string {
  const { manifest } = test;
  const testSlug = path.basename(test.dir);
  const facts = Object.entries(manifest.facts);

  return `
    <article class="test" id="${slug(manifest.test)}">
      <header class="test-head">
        <span class="status status--${manifest.status}">${manifest.status}</span>
        <h2>${caption(manifest.test)}</h2>
        <dl class="facts">
          ${facts
            .map(
              ([name, value]) =>
                `<div><dt>${escapeHtml(name)}</dt><dd>${escapeHtml(value)}</dd></div>`
            )
            .join('\n          ')}
        </dl>
      </header>
      <div class="steps">
        ${manifest.steps.map(step => renderStep(step, images, testSlug)).join('\n')}
      </div>
    </article>`;
}

// ── Page ────────────────────────────────────────────────────────────────────

function buildPage(tests: LoadedTest[], images: Map<string, string>, generatedAt: string): string {
  const counts = {
    passed: tests.filter(t => t.manifest.status === 'passed').length,
    skipped: tests.filter(t => t.manifest.status === 'skipped').length,
    failed: tests.filter(t => t.manifest.status === 'failed').length,
  };
  const screens = tests.reduce(
    (total, t) => total + t.manifest.steps.filter(s => s.kind === 'ui').length, 0);
  const reads = tests.reduce(
    (total, t) => total + t.manifest.steps.filter(s => s.kind === 'db').length, 0);

  return `<title>FleetPlus Evidence Walkthrough</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600&family=Spectral:ital,wght@0,500;0,600;1,400&display=swap">
<style>
:root {
  --ground:   #eef1f2;
  --surface:  #ffffff;
  --sunken:   #f5f7f8;
  --line:     #d5dcdf;
  --line-soft:#e6ebed;
  --ink:      #14191c;
  --ink-soft: #3d4b51;
  --muted:    #6b7b82;
  --screen:   #1c6ea4;
  --data:     #8a6410;
  --pass:     #2b6f4a;
  --skip:     #8a6410;
  --fail:     #a83a33;
  --shadow:   0 1px 2px rgba(20,25,28,.06), 0 8px 24px -12px rgba(20,25,28,.18);
  --sans: "IBM Plex Sans", ui-sans-serif, system-ui, sans-serif;
  --serif: "Spectral", Georgia, "Times New Roman", serif;
  --mono: "IBM Plex Mono", ui-monospace, "SF Mono", Menlo, monospace;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --ground:   #101416;
    --surface:  #171d20;
    --sunken:   #1d2427;
    --line:     #2c363a;
    --line-soft:#232b2e;
    --ink:      #e6ecee;
    --ink-soft: #b9c5c9;
    --muted:    #8b9aa0;
    --screen:   #6bb4e0;
    --data:     #d6a94a;
    --pass:     #6cc194;
    --skip:     #d6a94a;
    --fail:     #e88a83;
    --shadow:   0 1px 2px rgba(0,0,0,.5), 0 10px 28px -14px rgba(0,0,0,.7);
  }
}
:root[data-theme="dark"] {
  --ground:   #101416;
  --surface:  #171d20;
  --sunken:   #1d2427;
  --line:     #2c363a;
  --line-soft:#232b2e;
  --ink:      #e6ecee;
  --ink-soft: #b9c5c9;
  --muted:    #8b9aa0;
  --screen:   #6bb4e0;
  --data:     #d6a94a;
  --pass:     #6cc194;
  --skip:     #d6a94a;
  --fail:     #e88a83;
  --shadow:   0 1px 2px rgba(0,0,0,.5), 0 10px 28px -14px rgba(0,0,0,.7);
}

* { box-sizing: border-box; }
body {
  margin: 0;
  background: var(--ground);
  color: var(--ink);
  font-family: var(--sans);
  font-size: 16px;
  line-height: 1.6;
  -webkit-font-smoothing: antialiased;
}
.wrap { max-width: 1180px; margin: 0 auto; padding: 0 24px 96px; }

/* ── Masthead ───────────────────────────────────────────────────────── */
.masthead {
  padding: 72px 0 40px;
  border-bottom: 1px solid var(--line);
  display: flex; flex-direction: column; gap: 20px;
}
.eyebrow {
  font-family: var(--mono); font-size: .74rem; letter-spacing: .14em;
  text-transform: uppercase; color: var(--muted); margin: 0;
}
.masthead h1 {
  font-family: var(--serif); font-weight: 600; font-size: clamp(2.1rem, 4.4vw, 3.1rem);
  line-height: 1.1; margin: 0; text-wrap: balance; letter-spacing: -.01em;
}
.standfirst {
  font-family: var(--serif); font-style: italic; font-size: 1.15rem;
  color: var(--ink-soft); margin: 0; max-width: 62ch; line-height: 1.5;
}
.tally { display: flex; flex-wrap: wrap; gap: 8px 28px; margin: 4px 0 0; padding: 0; list-style: none; }
.tally li { display: flex; align-items: baseline; gap: 8px; }
.tally .n {
  font-family: var(--mono); font-size: 1.5rem; font-weight: 500;
  font-variant-numeric: tabular-nums; color: var(--ink);
}
.tally .l { font-size: .82rem; color: var(--muted); }
.tally .n[data-tone="pass"] { color: var(--pass); }
.tally .n[data-tone="skip"] { color: var(--skip); }
.tally .n[data-tone="fail"] { color: var(--fail); }

/* ── Contents ───────────────────────────────────────────────────────── */
.contents { padding: 32px 0 8px; }
.contents h2 {
  font-family: var(--mono); font-size: .74rem; letter-spacing: .14em;
  text-transform: uppercase; color: var(--muted); font-weight: 500; margin: 0 0 14px;
}
.contents ol { margin: 0; padding: 0; list-style: none; display: grid; gap: 2px; }
.contents a {
  display: flex; align-items: baseline; gap: 14px; padding: 11px 14px;
  border-radius: 6px; text-decoration: none; color: var(--ink);
  border: 1px solid transparent;
}
.contents a:hover, .contents a:focus-visible {
  background: var(--surface); border-color: var(--line-soft); outline: none;
}
.contents .idx { font-family: var(--mono); font-size: .8rem; color: var(--muted); }
.contents .ttl { flex: 1; }
.contents .dot { width: 8px; height: 8px; border-radius: 50%; flex: none; }
.dot--passed { background: var(--pass); }
.dot--skipped { background: var(--skip); }
.dot--failed { background: var(--fail); }
.dot--unknown { background: var(--muted); }

/* ── Test ───────────────────────────────────────────────────────────── */
.test { padding-top: 64px; scroll-margin-top: 24px; }
.test-head { border-top: 2px solid var(--ink); padding-top: 20px; margin-bottom: 8px; }
.status {
  display: inline-block; font-family: var(--mono); font-size: .68rem;
  letter-spacing: .12em; text-transform: uppercase; padding: 3px 9px;
  border-radius: 3px; border: 1px solid currentColor; margin-bottom: 12px;
}
.status--passed  { color: var(--pass); }
.status--skipped { color: var(--skip); }
.status--failed  { color: var(--fail); }
.status--unknown { color: var(--muted); }
.test-head h2 {
  font-family: var(--serif); font-weight: 600; font-size: clamp(1.4rem, 2.6vw, 1.95rem);
  line-height: 1.2; margin: 0 0 22px; text-wrap: balance; max-width: 26ch;
}
.facts {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
  gap: 1px; margin: 0; background: var(--line-soft);
  border: 1px solid var(--line-soft); border-radius: 6px; overflow: hidden;
}
.facts > div { background: var(--surface); padding: 11px 14px; }
.facts dt {
  font-size: .7rem; letter-spacing: .07em; text-transform: uppercase;
  color: var(--muted); margin-bottom: 3px;
}
.facts dd {
  margin: 0; font-family: var(--mono); font-size: .86rem;
  font-variant-numeric: tabular-nums; word-break: break-word;
}

/* ── Steps ──────────────────────────────────────────────────────────── */
.steps { padding-top: 8px; }
.step { display: grid; grid-template-columns: 62px 1fr; }
.step-rail {
  position: relative; display: flex; justify-content: center; padding-top: 30px;
}
.step-rail::before {
  content: ""; position: absolute; top: 0; bottom: 0; left: 50%;
  width: 1px; background: var(--line); transform: translateX(-.5px);
}
.step:first-child .step-rail::before { top: 30px; }
.step:last-child .step-rail::before { bottom: auto; height: 30px; }
.step-num {
  position: relative; font-family: var(--mono); font-size: .72rem;
  font-variant-numeric: tabular-nums; color: var(--muted);
  background: var(--ground); padding: 4px 0; width: 100%; text-align: center;
}
.step-body { padding: 26px 0 26px 8px; min-width: 0; }
.step-kind {
  font-family: var(--mono); font-size: .68rem; letter-spacing: .13em;
  text-transform: uppercase; margin: 0 0 5px;
}
.step--ui   .step-kind { color: var(--screen); }
.step--db   .step-kind { color: var(--data); }
.step--note .step-kind { color: var(--muted); }
.step-title {
  font-family: var(--serif); font-weight: 600; font-size: 1.28rem;
  line-height: 1.25; margin: 0 0 7px; text-wrap: balance; max-width: 34ch;
}
.step-caption { margin: 0 0 16px; color: var(--ink-soft); max-width: 66ch; }

/* Screenshot */
.shot { margin: 0; }
.shot-open {
  display: block; position: relative; width: 100%; padding: 0; border: 1px solid var(--line);
  border-radius: 8px; overflow: hidden; background: var(--surface);
  cursor: zoom-in; box-shadow: var(--shadow); line-height: 0;
}
.shot-open:focus-visible { outline: 2px solid var(--screen); outline-offset: 3px; }
.shot-open img {
  display: block; width: 100%; max-height: 460px;
  object-fit: cover; object-position: top center;
}
.shot-more {
  position: absolute; left: 0; right: 0; bottom: 0;
  display: block; padding: 30px 14px 11px; text-align: center;
  font-family: var(--mono); font-size: .68rem; letter-spacing: .11em;
  text-transform: uppercase; color: #fff; line-height: 1.4;
  background: linear-gradient(to bottom, rgba(12,16,18,0), rgba(12,16,18,.78));
}
.shot-url {
  font-family: var(--mono); font-size: .72rem; color: var(--muted);
  margin-top: 8px; overflow-x: auto; white-space: nowrap;
}
.shot-url span { text-transform: uppercase; letter-spacing: .1em; }
.shot-url code { color: var(--ink-soft); }

/* Database dump */
.dump {
  margin: 0; padding: 18px 20px; background: var(--sunken);
  border: 1px solid var(--line-soft); border-left: 3px solid var(--data);
  border-radius: 6px; overflow-x: auto;
  font-family: var(--mono); font-size: .8rem; line-height: 1.65;
  color: var(--ink-soft); white-space: pre; tab-size: 2;
}
.step--note .dump { border-left-color: var(--muted); white-space: pre-wrap; }

/* Lightbox */
.lightbox {
  border: none; padding: 0; max-width: 96vw; max-height: 94vh;
  background: var(--surface); border-radius: 10px; overflow: auto;
  color: var(--ink);
}
.lightbox::backdrop { background: rgba(8,11,13,.82); }
.lightbox img { display: block; width: 100%; height: auto; }
.lightbox form { position: sticky; top: 0; z-index: 1; display: flex; justify-content: flex-end; }
.lightbox-close {
  font-family: var(--mono); font-size: .72rem; letter-spacing: .1em;
  text-transform: uppercase; margin: 10px; padding: 7px 13px; cursor: pointer;
  background: var(--surface); color: var(--ink);
  border: 1px solid var(--line); border-radius: 5px;
}

.colophon {
  margin-top: 80px; padding-top: 22px; border-top: 1px solid var(--line);
  font-size: .82rem; color: var(--muted); max-width: 70ch;
}
.colophon code { font-family: var(--mono); font-size: .95em; }

@media (max-width: 640px) {
  .step { grid-template-columns: 34px 1fr; }
  .step-body { padding-left: 4px; }
  .wrap { padding: 0 16px 64px; }
  .masthead { padding-top: 44px; }
}
@media (prefers-reduced-motion: reduce) {
  * { animation: none !important; transition: none !important; }
}
</style>

<div class="wrap">
  <header class="masthead">
    <p class="eyebrow">FleetPlus QA · Evidence walkthrough</p>
    <h1>Every step, photographed and checked against the database</h1>
    <p class="standfirst">
      The UserType × CustomerType matrix, run through the live application. Each screen
      is captured as it was, and each claim the application makes is put next to the rows
      it actually wrote.
    </p>
    <ul class="tally">
      <li><span class="n" data-tone="pass">${counts.passed}</span><span class="l">passed</span></li>
      ${counts.skipped ? `<li><span class="n" data-tone="skip">${counts.skipped}</span><span class="l">skipped</span></li>` : ''}
      ${counts.failed ? `<li><span class="n" data-tone="fail">${counts.failed}</span><span class="l">failed</span></li>` : ''}
      <li><span class="n">${screens}</span><span class="l">screens captured</span></li>
      <li><span class="n">${reads}</span><span class="l">database reads</span></li>
    </ul>
  </header>

  <nav class="contents">
    <h2>What was run</h2>
    <ol>
      ${tests
        .map(
          (t, i) => `<li><a href="#${slug(t.manifest.test)}">
        <span class="idx">${String(i + 1).padStart(2, '0')}</span>
        <span class="ttl">${escapeHtml(t.manifest.test)}</span>
        <span class="dot dot--${t.manifest.status}"></span>
      </a></li>`
        )
        .join('\n      ')}
    </ol>
  </nav>

  ${tests.map(t => renderTest(t, images)).join('\n')}

  <footer class="colophon">
    <p>
      Generated ${escapeHtml(generatedAt)} from <code>visual-evidence/</code>, written by the
      tests as they ran. Screenshots are full-page captures shown cropped — click any one to
      open it whole. Database blocks are the verbatim result of read-only <code>SELECT</code>
      queries against the QA database; the test harness refuses to send anything else.
    </p>
    <p>
      Source: <code>tests/user-management/usertype-matrix.spec.ts</code> ·
      <code>src/helpers/evidence.helper.ts</code> ·
      <code>scripts/build-visual-report.ts</code>
    </p>
  </footer>
</div>

<script>
  document.querySelectorAll('.shot-open').forEach(function (button) {
    button.addEventListener('click', function () {
      var dialog = document.getElementById(button.dataset.full);
      if (dialog && dialog.showModal) dialog.showModal();
    });
  });
</script>
`;
}

// ── Main ────────────────────────────────────────────────────────────────────

function main(): void {
  const tests = loadTests();
  const generatedAt = new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC';

  let html = '';
  let fitted = false;

  for (const { width, jpegQuality } of ENCODING_LADDER) {
    const images = new Map<string, string>();
    for (const test of tests) {
      const testSlug = path.basename(test.dir);
      for (const step of test.manifest.steps) {
        if (step.kind !== 'ui' || !step.image) continue;
        const file = path.join(test.dir, step.image);
        if (!fs.existsSync(file)) continue;
        images.set(`${testSlug}/${step.image}`, dataUri(encode(file, width, jpegQuality)));
      }
    }

    html = buildPage(tests, images, generatedAt);
    const size = Buffer.byteLength(html, 'utf8');
    const label = jpegQuality ? `${width}px jpeg q${jpegQuality}` : `${width}px png`;
    console.log(`  ${label.padEnd(20)} -> ${(size / 1024 / 1024).toFixed(2)} MB`);
    if (size <= BUDGET_BYTES) {
      fitted = true;
      break;
    }
  }

  if (!fitted) {
    console.warn(
      `Report still exceeds ${(BUDGET_BYTES / 1024 / 1024).toFixed(0)} MB at the smallest ` +
        `width. It will open locally but may be rejected when published.`
    );
  }

  fs.writeFileSync(OUT, html);
  const steps = tests.reduce((n, t) => n + t.manifest.steps.length, 0);
  console.log(
    `\n${OUT}\n  ${tests.length} test(s), ${steps} step(s), ` +
      `${(Buffer.byteLength(html, 'utf8') / 1024 / 1024).toFixed(2)} MB`
  );
}

main();
