import { test } from '../src/fixtures/page.fixtures';
import { PARENT_ADMIN } from '../src/config/accounts';

/**
 * Why /Customer/ViewCustomerUser never settles.
 *
 * The module walk gave up on this screen at the full 120-second ceiling three
 * runs in a row, and every Playwright call against the page after that also
 * hung — which narrows the cause considerably. A slow *server* would leave the
 * page responsive while it waited; only something occupying the renderer's main
 * thread, or a dialog the browser is blocking on, stops evaluate() as well.
 *
 * So this deliberately avoids evaluate() until it knows the page is alive. It
 * navigates with waitUntil 'commit' — the earliest possible return, before any
 * page script has run — and then watches from the outside: console output, page
 * errors, failed requests, and which requests never finish.
 *
 *   TOOLS=true ENV=qa npx playwright test --project=tools --grep "view customer user"
 */

test.use({ storageState: { cookies: [], origins: [] } });

test.describe('Tools — probes @tools', () => {
  test('probe view customer user', async ({ loginPage, dashboardPage, page }) => {
    test.setTimeout(10 * 60_000);

    test.skip(!PARENT_ADMIN.password, 'Set PARENT_ADMIN_PASS for ' + PARENT_ADMIN.username);

    const consoleLines: string[] = [];
    const pageErrors: string[] = [];
    const failed: string[] = [];
    const started = new Map<string, number>();
    const finished = new Set<string>();

    page.on('console', m => consoleLines.push(`[${m.type()}] ${m.text()}`.slice(0, 300)));
    page.on('pageerror', e => pageErrors.push(e.message.split('\n')[0]));
    page.on('requestfailed', r =>
      failed.push(`${r.method()} ${r.url().slice(0, 140)} — ${r.failure()?.errorText}`)
    );
    page.on('request', r => started.set(r.url(), Date.now()));
    page.on('requestfinished', r => finished.add(r.url()));
    page.on('dialog', async d => {
      console.log(`\n!!! NATIVE DIALOG: [${d.type()}] "${d.message()}"`);
      await d.dismiss().catch(() => undefined);
    });

    await loginPage.navigate();
    await loginPage.login(PARENT_ADMIN.username, PARENT_ADMIN.password, PARENT_ADMIN.roleCode);
    await dashboardPage.assertDashboardLoaded();
    console.log('Logged in; navigating to /Customer/ViewCustomerUser');

    // 'commit' returns as soon as the response arrives, before any script runs.
    // If even this hangs the problem is the server or the network, not the page.
    const t0 = Date.now();
    const response = await page
      .goto('/Customer/ViewCustomerUser', { waitUntil: 'commit', timeout: 60_000 })
      .catch(e => {
        console.log(`goto(commit) FAILED after ${Date.now() - t0}ms: ${e.message.split('\n')[0]}`);
        return null;
      });
    console.log(`goto(commit) returned in ${Date.now() - t0}ms, HTTP ${response?.status() ?? '—'}`);

    // Is the renderer responding at all? A trivial evaluate with a short timeout
    // answers that without committing to the long one that hung before.
    for (const wait of [2_000, 5_000, 10_000, 20_000, 30_000]) {
      await page.waitForTimeout(wait);
      const elapsed = Date.now() - t0;
      const alive = await Promise.race([
        page.evaluate(() => document.readyState).catch(e => `evaluate error: ${e.message}`),
        new Promise<string>(r => setTimeout(() => r('BLOCKED — renderer did not answer in 5s'), 5_000)),
      ]);
      console.log(`  +${Math.round(elapsed / 1000)}s  readyState = ${alive}`);
      if (typeof alive === 'string' && alive.startsWith('BLOCKED')) {
        console.log('  The main thread is occupied. Nothing else can be read from this page.');
        break;
      }
    }

    // Time each step the walk performs, separately, so the slow one names
    // itself instead of being inferred. Every call gets its own ceiling —
    // page.evaluate has no timeout of its own and will wait forever.
    const step = async (name: string, work: () => Promise<unknown>) => {
      const start = Date.now();
      const result = await Promise.race([
        work().then(v => ({ ok: true, v })).catch(e => ({ ok: false, v: e.message.split('\n')[0] })),
        new Promise<{ ok: boolean; v: unknown }>(r =>
          setTimeout(() => r({ ok: false, v: 'TIMED OUT at 60s' }), 60_000)
        ),
      ]);
      console.log(
        `  ${String(Date.now() - start).padStart(7)}ms  ${name}  ` +
          `${result.ok ? '' : `<-- ${result.v}`}`
      );
      return result;
    };

    console.log('\n--- how big is this page? ---');
    await step('count DOM nodes', async () => {
      const counts = await page.evaluate(() => ({
        all: document.querySelectorAll('*').length,
        inputs: document.querySelectorAll('input, select, textarea').length,
        buttons: document.querySelectorAll('button, input[type=submit], input[type=button]').length,
        tables: document.querySelectorAll('table').length,
        rows: document.querySelectorAll('tbody tr').length,
      }));
      console.log(`            ${JSON.stringify(counts)}`);
      return counts;
    });

    // ORDER MATTERS, and getting it wrong invalidated a whole run.
    //
    // A hanging call is abandoned by the race below but not cancelled, so it
    // keeps the page occupied and everything after it times out too. A previous
    // pass put the screenshots first and then "measured" document.fonts.status
    // — a synchronous property read — at sixty seconds. That number described
    // the queue, not the page.
    //
    // So anything not yet proven safe runs BEFORE the first call known to hang.
    // The screenshots go last, and nothing is believed after them.
    console.log('\n--- calls that must be measured before anything can stall ---');
    await step('document.fonts.status', () => page.evaluate(() => document.fonts.status));
    await step('document.fonts.ready', () =>
      page.evaluate(() => document.fonts.ready.then(() => 'resolved'))
    );
    await step('CDP Page.captureScreenshot', async () => {
      const cdp = await page.context().newCDPSession(page);
      const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
      await cdp.detach().catch(() => undefined);
      return `${Math.round(data.length / 1024)}KB`;
    });

    console.log('\n--- timing each step the walk does ---');
    await step('getBoundingClientRect on every input/select/textarea', () =>
      page.evaluate(() =>
        Array.from(document.querySelectorAll('input, select, textarea')).filter(el => {
          const r = (el as HTMLElement).getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        }).length
      )
    );
    await step('getBoundingClientRect on every button', () =>
      page.evaluate(() =>
        Array.from(document.querySelectorAll('button')).filter(el => {
          const r = (el as HTMLElement).getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        }).length
      )
    );
    await step('read every table header + row count', () =>
      page.evaluate(() =>
        Array.from(document.querySelectorAll('table')).map(t => ({
          cols: t.querySelectorAll('thead th').length,
          rows: t.querySelectorAll('tbody tr').length,
        }))
      )
    );
    await step('fullPage screenshot', () =>
      page.screenshot({ fullPage: true, animations: 'disabled', timeout: 55_000 })
    );
    await step('viewport screenshot', () =>
      page.screenshot({ animations: 'disabled', timeout: 55_000 })
    );

    console.log('\n(nothing measured past the first screenshot is trustworthy)');

    console.log(`\n--- page errors (${pageErrors.length}) ---`);
    pageErrors.slice(0, 20).forEach(e => console.log(`  ${e}`));

    console.log(`\n--- failed requests (${failed.length}) ---`);
    failed.slice(0, 20).forEach(f => console.log(`  ${f}`));

    const pending = [...started.keys()].filter(u => !finished.has(u));
    console.log(`\n--- requests still in flight (${pending.length}) ---`);
    pending.slice(0, 25).forEach(u => {
      console.log(`  ${Math.round((Date.now() - (started.get(u) ?? 0)) / 1000)}s  ${u.slice(0, 150)}`);
    });

    console.log(`\n--- console (last 40 of ${consoleLines.length}) ---`);
    consoleLines.slice(-40).forEach(l => console.log(`  ${l}`));

    await page
      .screenshot({ path: 'test-results/view-customer-user.png', fullPage: false, timeout: 15_000 })
      .then(() => console.log('\nScreenshot: test-results/view-customer-user.png'))
      .catch(e => console.log(`\nScreenshot failed too: ${e.message.split('\n')[0]}`));
  });
});
