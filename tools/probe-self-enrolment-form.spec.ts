import { test } from '../src/fixtures/page.fixtures';

/**
 * What the OD self-enrolment form asks for.
 *
 * The requirement covers both enrolment paths, and only one of them is applied: 15 of 15 OD
 * applications raised through Add Customer carry the state's dummy division, while the one
 * raised by a customer enrolling itself carries a real division — 34, Noida — and is live as
 * NAYAFP3023400262. One record is thin evidence for a claim that a whole path was missed, so
 * the next step is to raise one deliberately.
 *
 * Nothing in the repository models this screen; login.spec.ts only asserts that the sign-up
 * link points at it. So this reads the form before anything tries to fill it: whether it is
 * reachable without signing in, what it asks for, and whether it asks for a division or a pin
 * code — the two fields the change is about.
 *
 *   TOOLS=true ENV=qa npx playwright test --project=tools --grep "probe self enrolment form"
 */

test.use({ storageState: { cookies: [], origins: [] } });

test.describe('Tools — probes @tools', () => {
  test('probe self enrolment form', async ({ page }) => {
    test.setTimeout(300_000);

    const response = await page.goto('/Home/PersonalSelfEnrolment', { waitUntil: 'domcontentloaded' })
      .catch(() => null);
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);
    console.log(`  http ${response?.status() ?? 0}, url ${page.url()}`);
    console.log(`  reachable without signing in: ${!/login/i.test(page.url())}`);

    const fields = await page.evaluate(() =>
      Array.from(document.querySelectorAll('input,select,textarea'))
        .filter(e => (e as HTMLInputElement).type !== 'hidden' && e.id)
        .map(e => {
          const element = e as HTMLInputElement;
          const label = document.querySelector(`label[for="${element.id}"]`);
          return {
            id: element.id,
            tag: element.tagName.toLowerCase(),
            type: element.type,
            label: (label?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40),
            required: element.required || element.getAttribute('data-val-required') !== null,
            visible: !!element.offsetParent,
            options: element.tagName === 'SELECT'
              ? Array.from((element as unknown as HTMLSelectElement).options)
                  .map(o => o.textContent?.trim()).slice(0, 6).join(' | ')
              : undefined,
          };
        })
    );

    console.log(`\n  ${fields.filter(f => f.visible).length} visible field(s) of ${fields.length}:`);
    for (const f of fields.filter(f => f.visible)) {
      const marker = /division|pin|state|city|district/i.test(f.id) ? '   <-- location' : '';
      console.log(`    ${f.tag}#${f.id} (${f.type})${f.required ? ' required' : ''} "${f.label}"${marker}`);
      if (f.options) console.log(`        options: ${f.options}`);
    }

    const hiddenLocation = fields.filter(f => !f.visible && /division|pin|state/i.test(f.id));
    if (hiddenLocation.length) {
      console.log(`\n  location fields present but hidden: ${hiddenLocation.map(f => f.id).join(', ')}`);
    }

    const controls = await page.evaluate(() =>
      Array.from(document.querySelectorAll('button, a.btn, input[type=submit]'))
        .filter(e => !!(e as HTMLElement).offsetParent)
        .map(e => `${e.id || '(no id)'} "${(e.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 28)}"`));
    console.log(`\n  visible controls: ${controls.join(' | ') || 'none'}`);
  });
});
