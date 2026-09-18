import { test } from '../src/fixtures/page.fixtures';
import { TSM } from '../src/config/accounts';

/**
 * What the TSM review screen actually offers, step by step.
 *
 * The E2E chain left reference 1000514858 at status 102 with the message
 * "no completing control found on the final review step; it offered:
 *  sidebarPinBtn:"" | (no id):"Terrority Admin Territory Admin"".
 *
 * Two buttons, neither belonging to the form — that reading is suspicious
 * rather than informative, because the inventory that produced it queries only
 * `button, input[type=submit], input[type=button]`. This application styles
 * anchors as buttons routinely, so an <a class="btn">Submit</a> would be
 * invisible to that scan and the message would be literally true and
 * completely misleading.
 *
 * So this prints EVERY clickable candidate — anchors included — at every step
 * of the Next walk, with enough context to tell "not present" from "present and
 * not matched": tag, id, classes, text, rect, and why it was or was not
 * considered visible. It clicks Next and nothing else; Reject and Send for
 * Correction are never touched.
 *
 *   TOOLS=true ENV=qa npx playwright test --project=tools --grep "review controls"
 */

const REFERENCE = process.env.PROBE_REFERENCE ?? '1000514858';

interface Candidate {
  tag: string;
  id: string;
  cls: string;
  text: string;
  type: string;
  w: number;
  h: number;
  top: number;
  display: string;
  visibility: string;
  hasOffsetParent: boolean;
  inHiddenTabPane: boolean;
}

test.use({ storageState: { cookies: [], origins: [] } });

test.describe('Tools — probes @tools', () => {
  test('probe review controls', async ({ loginPage, dashboardPage, page }) => {
    test.setTimeout(10 * 60_000);
    test.skip(!TSM.password, 'Set TSM_PASS');

    await loginPage.navigate();
    await loginPage.login(TSM.username, TSM.password);
    await dashboardPage.assertDashboardLoaded();

    const inventory = async (): Promise<Candidate[]> =>
      page.evaluate(() => {
        const sel = 'button, input[type=submit], input[type=button], input[type=image], a, [role=button]';
        return Array.from(document.querySelectorAll(sel)).map(el => {
          const e = el as HTMLElement;
          const r = e.getBoundingClientRect();
          const cs = getComputedStyle(e);
          // A control inside a tab pane that is not `.active` is in the DOM but
          // off screen. Recording it separately is the whole point: "hidden in
          // an inactive tab" and "not on this page" need different responses.
          const pane = e.closest('.tab-pane');
          return {
            tag: e.tagName.toLowerCase(),
            id: e.id || '',
            cls: (e.className || '').toString().replace(/\s+/g, ' ').trim().slice(0, 90),
            text: (e.textContent || (e as HTMLInputElement).value || '')
              .replace(/\s+/g, ' ')
              .trim()
              .slice(0, 60),
            type: (e as HTMLInputElement).type || '',
            w: Math.round(r.width),
            h: Math.round(r.height),
            top: Math.round(r.top + window.scrollY),
            display: cs.display,
            visibility: cs.visibility,
            hasOffsetParent: e.offsetParent !== null,
            inHiddenTabPane: !!pane && !pane.classList.contains('active'),
          };
        });
      });

    const report = (step: string, all: Candidate[]) => {
      const onScreen = all.filter(c => c.w > 0 && c.h > 0 && !c.inHiddenTabPane);
      const parked = all.filter(c => c.inHiddenTabPane || c.w === 0 || c.h === 0);
      console.log(`\n${'='.repeat(78)}\n${step} — url: ${page.url()}`);
      console.log(`  on screen (${onScreen.length}):`);
      for (const c of onScreen) {
        console.log(
          `    <${c.tag}${c.type ? ` type=${c.type}` : ''}> id=${c.id || '-'} ` +
            `"${c.text}" ${c.w}x${c.h}@${c.top} cls=${c.cls}`
        );
      }
      console.log(`  parked / hidden (${parked.length}), texts only:`);
      const texts = parked.map(c => `${c.tag}:"${c.text}"`).filter(t => !t.endsWith(':""'));
      console.log(`    ${texts.join(' | ') || '(none with text)'}`);
    };

    await page.goto(`/Customer/ReviewCustomerDetails?ReferenceNo=${REFERENCE}`, {
      waitUntil: 'domcontentloaded',
      timeout: 45_000,
    });
    await page.waitForTimeout(3_000);

    report('step 0 — on open', await inventory());

    // The acknowledgement checkboxes are the actual blocker, and the inventory
    // above cannot see them: it queries buttons and anchors only. Print every
    // checkbox with its id, name, label and checked state.
    const boxes = await page.evaluate(() =>
      Array.from(document.querySelectorAll('input[type=checkbox]')).map(el => {
        const e = el as HTMLInputElement;
        const r = e.getBoundingClientRect();
        const lab = e.id ? document.querySelector(`label[for="${e.id}"]`) : null;
        const pane = e.closest('.tab-pane');
        return {
          id: e.id || '(no id)',
          name: e.name || '',
          checked: e.checked,
          disabled: e.disabled,
          size: `${Math.round(r.width)}x${Math.round(r.height)}`,
          opacity: getComputedStyle(e).opacity,
          label: (lab?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80),
          near: (e.closest('div')?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 90),
          pane: pane ? `${pane.id || '?'}${pane.classList.contains('active') ? ' [ACTIVE]' : ''}` : '(no pane)',
        };
      })
    );
    console.log(`\n  CHECKBOXES (${boxes.length}):`);
    for (const b of boxes) console.log(`    ${JSON.stringify(b)}`);

    // Also record which tab is active at each step. A walk that stops early
    // looks identical to a walk that finished unless you can see which tab it
    // stopped on.
    const tabs = async () =>
      page.evaluate(() =>
        Array.from(document.querySelectorAll('[role=tab], .nav-link, .nav-tabs a')).map(
          el =>
            `${(el.textContent || '').replace(/\s+/g, ' ').trim()}${
              el.classList.contains('active') ? ' [ACTIVE]' : ''
            }`
        )
      );
    console.log(`  tabs: ${(await tabs()).join(' | ')}`);

    for (let i = 1; i <= 8; i += 1) {
      const next = page
        .locator('button:visible:has-text("Next"), input[type=button][value="Next"]:visible, a:visible:has-text("Next")')
        .filter({ hasNotText: /previous/i })
        .first();

      if (!(await next.isVisible().catch(() => false))) {
        console.log(`\nNo visible Next at step ${i} — walk ends here.`);
        break;
      }

      await next.click({ timeout: 10_000 }).catch(e => console.log(`  Next click failed: ${e}`));
      await page.waitForTimeout(2_500);
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(800);

      report(`step ${i} — after clicking Next`, await inventory());
      console.log(`  tabs: ${(await tabs()).join(' | ')}`);

      const modal = page.locator('.modal.show').first();
      if (await modal.isVisible().catch(() => false)) {
        console.log(`  MODAL: "${((await modal.textContent()) ?? '').replace(/\s+/g, ' ').trim().slice(0, 300)}"`);
        break;
      }
    }

    await page.screenshot({ path: 'scratchpad/review-final.png', fullPage: false }).catch(() => undefined);
  });
});
