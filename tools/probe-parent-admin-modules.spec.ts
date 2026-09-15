import { test } from '../src/fixtures/page.fixtures';
import { PARENT_ADMIN, BRANCH_ADMIN } from '../src/config/accounts';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Walks every module a customer's own administrator can reach, and records what
 * each one is.
 *
 * Read-only by construction. It navigates, reads, and screenshots; it never
 * fills, submits, or clicks anything that could write. The one exception is
 * expanding sidebar sections, which is how the menu reveals its own contents.
 *
 * Runs once per role. 9200000000 holds both a Customer Admin and seven Branch
 * Admin logins against the same mobile, so the two walks share credentials and
 * differ only in which card is chosen at the role-selection step. Running both
 * is the point: the interesting artifact is not either menu on its own but the
 * difference between them, which is where the entitlement boundary actually
 * lives. Several screens narrow rather than disappear — Add Branch drops its
 * customer selector for a parent admin because the customer comes from the
 * session — and a diff catches that where a presence check would not.
 *
 *   TOOLS=true ENV=qa npx playwright test --project=tools --grep "modules"
 */

interface ModuleReport {
  section: string;
  label: string;
  href: string;
  finalUrl: string;
  heading: string;
  /** Named form controls, which is the best available shape-of-screen summary. */
  inputs: { id: string; name: string; type: string; label: string; readonly: boolean }[];
  buttons: { id: string; text: string }[];
  grids: { id: string; columns: string[]; rows: number }[];
  /** Anything the screen said on arrival — access denials show up here. */
  messages: string[];
  verdict: 'reachable' | 'denied' | 'error' | 'redirected';
  note: string;
}

const WALKS = [
  {
    slug: 'parent-admin',
    label: 'parent admin',
    account: PARENT_ADMIN,
    context: `owns ${PARENT_ADMIN.ownCustomerId}`,
  },
  {
    slug: 'branch-admin',
    label: 'branch admin',
    account: BRANCH_ADMIN,
    context: `a branch under ${BRANCH_ADMIN.parentCustomerId}`,
  },
];

/**
 * Runs `work`, or gives up on it by name.
 *
 * Playwright's own timeouts cover individual calls, not a sequence of them, and
 * they do not cover a page that has stopped responding at all. Without an outer
 * deadline one unresponsive screen consumes the whole test budget and the run
 * ends with no results for the other thirty-eight — which is what happened on
 * the first attempt. Losing one module's detail is a far better outcome than
 * losing the walk, so each gets its own ceiling and names itself on the way out.
 */
async function withDeadline<T>(ms: number, what: string, work: () => Promise<T>): Promise<T> {
  // Note what this does NOT do: racing abandons the promise but cannot cancel
  // the Playwright call behind it, so a call that hangs keeps the page occupied
  // and every later one queues behind it. The deadline reports the stall; it
  // does not cure it. Anything that can hang needs its own timeout as well —
  // see the screenshot call below for the one that actually bit.
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      work(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`gave up after ${ms / 1000}s — ${what} never settled`)),
          ms
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Captures the viewport through CDP rather than page.screenshot().
 *
 * page.screenshot() hangs indefinitely on some screens in this application —
 * /Customer/ViewCustomerUser is one — and, crucially, its `timeout` option does
 * not abort it: 55_000 was passed and the call was still running at 60s, in
 * both viewport and fullPage modes. Because a hung Playwright call keeps the
 * page occupied, every later call queues behind it, so one screenshot stalls
 * the whole walk. That is what pinned four runs at module three.
 *
 * The page itself is fine, which is what made this so slow to find. Measured on
 * that screen: 812 DOM nodes, every DOM read 2-5ms, document.fonts.ready
 * resolving in 4ms, and this CDP capture returning in 42ms. Opening the page by
 * hand has always worked. The fault is entirely in the capture path.
 *
 * Page.captureScreenshot grabs the frame directly and skips the stability waits
 * Playwright performs, so it is not exposed to whichever of them is stuck.
 */
async function captureViewport(
  page: import('@playwright/test').Page,
  file: string
): Promise<boolean> {
  try {
    const cdp = await page.context().newCDPSession(page);
    try {
      const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(file, Buffer.from(data, 'base64'));
      return true;
    } finally {
      await cdp.detach().catch(() => undefined);
    }
  } catch {
    return false;
  }
}

/**
 * Clears the single-tab / active-session overlay, and says whether it was there.
 *
 * FleetPlus allows one live tab per account and enforces it with a full-screen
 * "FLEETPLUS is already open" takeover that can appear on *any* navigation, not
 * just at login — a session left behind by an earlier run is enough to trigger
 * it. The overlay does not block navigation, so a probe walks the whole menu
 * quite happily and records the overlay's own heading as every screen's
 * heading, with zero fields behind it. That reads as "this role sees nothing
 * anywhere", which is a plausible and completely wrong entitlement finding.
 *
 * Clicking continue reclaims the session for this tab. That is a read-only act:
 * it takes ownership of a session, it does not submit anything.
 */
async function clearSessionTakeover(page: import('@playwright/test').Page): Promise<boolean> {
  const controls = [
    '#nayara-single-tab-takeover',
    '#nayara-profile-tab-continue-btn',
    '#profile-active-session-ok-btn',
  ];

  let cleared = false;
  for (let pass = 0; pass < 3; pass += 1) {
    let clickedThisPass = false;
    for (const selector of controls) {
      const control = page.locator(selector).first();
      if (!(await control.isVisible().catch(() => false))) continue;
      await control.click({ timeout: 5_000 }).catch(() => undefined);
      await page.waitForTimeout(1_200);
      cleared = true;
      clickedThisPass = true;
    }
    if (!clickedThisPass) break;
  }
  return cleared;
}

test.use({ storageState: { cookies: [], origins: [] } });

test.describe('Tools — probes @tools', () => {
  // Serial: both roles are the same mobile, and this application evicts an
  // existing session when the same account signs in again. Run in parallel and
  // the second login would quietly kill the first walk mid-menu.
  test.describe.configure({ mode: 'serial' });

  for (const walk of WALKS) {
  test(`probe ${walk.label} modules`, async ({ loginPage, dashboardPage, page }) => {
    test.setTimeout(30 * 60_000);
    const ACCOUNT = walk.account;

    test.skip(
      !ACCOUNT.password,
      'Set PARENT_ADMIN_PASS (or TEST_PASSWORD) for ' + ACCOUNT.username
    );

    // A native dialog blocks every Playwright call on the page, including
    // evaluate and screenshot, and nothing times out because the browser itself
    // is waiting. /Customer/ViewCustomerUser hung the first run for sixteen
    // minutes this way. Dismiss rather than accept: dismissing is the read-only
    // answer to a confirm(), and this probe must never agree to anything.
    page.on('dialog', d => void d.dismiss().catch(() => undefined));

    await loginPage.navigate();
    await loginPage.login(ACCOUNT.username, ACCOUNT.password, ACCOUNT.roleCode);
    await dashboardPage.assertDashboardLoaded();
    await clearSessionTakeover(page);

    const signedInAs = await dashboardPage.signedInAs();
    console.log(`\n########## ${walk.label.toUpperCase()} ##########`);
    console.log(`Signed in as: ${signedInAs}`);
    console.log(`Account     : ${ACCOUNT.username} / role ${ACCOUNT.roleCode}`);
    console.log(`Context     : ${walk.context}\n`);

    // ── Reveal the whole menu ────────────────────────────────────────────────
    // Collapsed accordion sections keep their links out of the DOM's visible
    // tree; the hrefs are there either way, but the section labels only resolve
    // once expanded, and a link without its section is hard to place.
    const toggles = page.locator(
      '#sidebarMenu [data-bs-toggle="collapse"], #sidebarMenu .accordion-button'
    );
    const toggleCount = await toggles.count();
    for (let i = 0; i < toggleCount; i++) {
      await toggles.nth(i).click({ timeout: 5_000 }).catch(() => undefined);
      await page.waitForTimeout(250);
    }
    await page.waitForTimeout(1_000);

    const menu = await page.evaluate(() => {
      const seen = new Set<string>();
      const entries: { section: string; label: string; href: string }[] = [];
      const sidebar = document.querySelector('#sidebarMenu') ?? document.body;

      for (const el of Array.from(sidebar.querySelectorAll('a[href]'))) {
        const anchor = el as HTMLAnchorElement;
        const href = (anchor.getAttribute('href') || '').trim();
        const label = (anchor.textContent || '').trim().replace(/\s+/g, ' ');
        if (!href || !label) continue;
        if (href === '#' || href.startsWith('javascript') || href.startsWith('http')) continue;
        if (/logout/i.test(href)) continue;
        if (seen.has(href)) continue;
        seen.add(href);

        // The sidebar groups its links in Bootstrap collapse panels, and the
        // panel's own toggle carries the section name. Walking up looking for a
        // previous sibling with a nav-link class found nothing — the toggle is
        // not a sibling of the link's ancestors, it is the control that targets
        // the collapse container by id. So resolve the container, then find
        // whatever points at it.
        let section = '';
        const panel = anchor.closest('.collapse, .accordion-collapse, .submenu');
        if (panel?.id) {
          const toggle = document.querySelector(
            `[data-bs-target="#${panel.id}"], [href="#${panel.id}"], [aria-controls="${panel.id}"]`
          );
          section = (toggle?.textContent || '').trim().replace(/\s+/g, ' ');
        }
        entries.push({ section: section || '(top level)', label, href });
      }
      return entries;
    });

    console.log(`--- menu: ${menu.length} reachable links ---`);
    for (const m of menu) console.log(`  [${m.section}] ${m.label.padEnd(38)} ${m.href}`);

    // ── Visit each one ───────────────────────────────────────────────────────
    const reports: ModuleReport[] = [];
    const outDir = path.join(process.cwd(), 'test-results', `${walk.slug}-modules`);
    fs.mkdirSync(outDir, { recursive: true });

    for (const [index, item] of menu.entries()) {
      console.log(`\n(${index + 1}/${menu.length}) ${item.label} -> ${item.href}`);

      const report: ModuleReport = {
        section: item.section,
        label: item.label,
        href: item.href,
        finalUrl: '',
        heading: '',
        inputs: [],
        buttons: [],
        grids: [],
        messages: [],
        verdict: 'reachable',
        note: '',
      };

      try {
        await withDeadline(120_000, `${item.label} (${item.href})`, async () => {
        const response = await page.goto(item.href, {
          waitUntil: 'domcontentloaded',
          timeout: 45_000,
        });
        await page.waitForTimeout(2_500);
        if (await clearSessionTakeover(page)) {
          report.note = 'the single-tab takeover overlay was cleared on arrival';
          await page.waitForTimeout(1_500);
        }
        report.finalUrl = page.url();

        const httpStatus = response?.status() ?? 0;
        if (httpStatus >= 400) {
          report.verdict = 'error';
          report.note = `HTTP ${httpStatus}`;
        }

        // A redirect back to login or the dashboard is how this application
        // refuses a screen; it does not render a 403 page.
        if (/\/Home\/(Index|Login)/i.test(report.finalUrl) || /login/i.test(report.finalUrl)) {
          report.verdict = 'denied';
          report.note = 'bounced to login — the session or the entitlement was rejected';
        } else if (!report.finalUrl.includes(item.href.split('?')[0])) {
          report.verdict = 'redirected';
          report.note = `landed on ${report.finalUrl}`;
        }

        const shape = await page.evaluate(() => {
          const text = (el: Element | null) =>
            (el?.textContent || '').trim().replace(/\s+/g, ' ');

          const onScreen = (el: Element) => {
            const r = (el as HTMLElement).getBoundingClientRect();
            return r.width > 0 && r.height > 0;
          };

          // p.box-head-title, measured rather than guessed.
          //
          // This application does not use heading elements for page titles, so
          // `h1, h2, h3, .page-title, .card-title` matched nothing on 37 of 39
          // screens and the walk reported "(no heading)" throughout while the
          // screenshots plainly showed titles. Dumping every candidate in the
          // top band found the real one: a <p class="box-head-title">, in the
          // same place on every page.
          //
          // The visibility filter stays. This application keeps its dialogs in
          // the DOM permanently and hidden — the single-tab takeover's
          // "FLEETPLUS is already open" among them — and an unfiltered query
          // picks those up first.
          const heading = text(
            Array.from(
              document.querySelectorAll(
                'p.box-head-title, .box-head-title, h1, h2, h3, .page-title, .card-title'
              )
            ).find(onScreen) ?? null
          );

          const labelFor = (el: HTMLElement): string => {
            if (el.id) {
              const lab = document.querySelector(`label[for="${el.id}"]`);
              if (lab) return text(lab);
            }
            const wrapped = el.closest('label');
            if (wrapped) return text(wrapped);
            return (el as HTMLInputElement).placeholder || '';
          };

          const visible = onScreen;

          const inputs = Array.from(
            document.querySelectorAll('input, select, textarea')
          )
            .filter(visible)
            .filter(el => (el as HTMLInputElement).type !== 'hidden')
            .map(el => {
              const i = el as HTMLInputElement;
              return {
                id: i.id || '',
                name: i.name || '',
                type: i.tagName === 'SELECT' ? 'select' : i.type || i.tagName.toLowerCase(),
                label: labelFor(i),
                readonly: i.readOnly === true || i.disabled === true,
              };
            })
            .filter(i => i.id || i.name);

          const buttons = Array.from(
            document.querySelectorAll('button, input[type="submit"], input[type="button"]')
          )
            .filter(visible)
            .map(el => ({
              id: (el as HTMLElement).id || '',
              text: text(el) || (el as HTMLInputElement).value || '',
            }))
            .filter(b => b.id || b.text);

          const grids = Array.from(document.querySelectorAll('table'))
            .filter(visible)
            .map(t => ({
              id: t.id || '',
              columns: Array.from(t.querySelectorAll('thead th')).map(th => text(th)),
              rows: t.querySelectorAll('tbody tr').length,
            }));

          const messages = Array.from(
            document.querySelectorAll('.modal.show, .alert, .toast, .text-danger')
          )
            .filter(visible)
            .map(el => text(el))
            .filter(m => m.length > 3);

          return { heading, inputs, buttons, grids, messages };
        });

        Object.assign(report, shape);

        // Now that the heading is taken from a *visible* element, this fires
        // only when the takeover really is on screen — in which case everything
        // read above describes the overlay rather than the module. Worth
        // keeping: a walk of zero-field screens looks exactly like a role
        // entitled to nothing, which is a finding someone would act on.
        if (/already open|single tab|another tab/i.test(report.heading)) {
          report.verdict = 'error';
          report.note =
            'the single-tab takeover overlay would not clear — the readings below ' +
            'describe the overlay, not this module, and must not be trusted';
        }

        // Access denials also arrive as a modal on an otherwise normal page.
        if (report.messages.some(m => /not authoriz|access deni|permission|unauthoriz/i.test(m))) {
          report.verdict = 'denied';
          report.note = report.messages.find(m => /not authoriz|access deni|permission/i.test(m)) ?? '';
        }

        const shot = path.join(outDir, `${String(index + 1).padStart(2, '0')}-${
          item.label.replace(/[^a-z0-9]+/gi, '-').toLowerCase().slice(0, 40)
        }.png`);
        if (!(await captureViewport(page, shot))) {
          report.note = [report.note, 'screenshot could not be captured']
            .filter(Boolean)
            .join('; ');
        }

        console.log(
          `    ${report.verdict}  "${report.heading || '(no heading)'}"  ` +
            `${report.inputs.length} fields, ${report.buttons.length} buttons, ` +
            `${report.grids.length} grid(s)`
        );
        if (report.note) console.log(`    note: ${report.note}`);
        if (report.messages.length) console.log(`    said: ${report.messages.join(' | ')}`);
        });
      } catch (error) {
        report.verdict = 'error';
        report.note = (error as Error).message.split('\n')[0];
        console.log(`    error: ${report.note}`);
        // A module that hung may have left the browser somewhere unusable, so
        // reset to a known page before the next one rather than letting one bad
        // screen take the rest of the walk down with it.
        await page.goto('/Dashboard/Index', { waitUntil: 'domcontentloaded', timeout: 30_000 })
          .catch(() => undefined);
      }

      reports.push(report);
    }

    // ── Summary ──────────────────────────────────────────────────────────────
    const file = path.join(outDir, `${walk.slug}-modules.json`);
    fs.writeFileSync(
      file,
      JSON.stringify(
        {
          signedInAs,
          account: ACCOUNT.username,
          role: ACCOUNT.roleCode,
          context: walk.context,
          modules: reports,
        },
        null,
        2
      )
    );

    console.log(`\n=== ${reports.length} modules ===`);
    for (const verdict of ['reachable', 'redirected', 'denied', 'error'] as const) {
      const of = reports.filter(r => r.verdict === verdict);
      if (!of.length) continue;
      console.log(`\n${verdict.toUpperCase()} (${of.length})`);
      for (const r of of) {
        console.log(`  ${r.label.padEnd(38)} ${r.href}${r.note ? `   — ${r.note}` : ''}`);
      }
    }
    console.log(`\nWritten to ${file}`);
    console.log(`Screenshots in ${outDir}`);
  });
  }
});
