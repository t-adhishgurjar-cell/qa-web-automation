import { test } from '@playwright/test';

/**
 * What an officer sees on first login, while still on its temporary password.
 *
 * The SMS says "Please log in and change your password immediately", so the
 * application must present a change screen somewhere — but nothing in this
 * framework models it, and guessing at its markup is how the review stage lost
 * an afternoon. This drives the login manually and prints every field and
 * control at each step, so the real screen can be read off.
 *
 *   TOOLS=true ENV=qa PROBE_MOBILE=9072986100 PROBE_TEMP='&WHDGWMmE7' \
 *     npx playwright test --project=tools --grep "first login"
 */

const MOBILE = process.env.PROBE_MOBILE ?? '9072986100';
const TEMP = process.env.PROBE_TEMP ?? '';

test.describe('Tools — probes @tools', () => {
  test('probe first login', async ({ page }) => {
    test.setTimeout(6 * 60_000);
    test.skip(!TEMP, 'Set PROBE_TEMP to the temporary password');

    const shot = async (when: string) => {
      const info = await page.evaluate(() => {
        const onScreen = (el: Element) => {
          const r = (el as HTMLElement).getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        };
        const txt = (el: Element) => (el.textContent || '').replace(/\s+/g, ' ').trim();
        return {
          url: location.href,
          title: document.title,
          fields: Array.from(document.querySelectorAll('input:not([type=hidden]), select, textarea'))
            .filter(onScreen)
            .map(f => {
              const e = f as HTMLInputElement;
              return `${e.tagName.toLowerCase()}#${e.id || '-'}[name=${e.name || '-'}][type=${e.type || '-'}]` +
                `${e.placeholder ? ` ph="${e.placeholder}"` : ''}`;
            }),
          buttons: Array.from(document.querySelectorAll('button, input[type=submit], a.btn'))
            .filter(onScreen)
            .map(b => `<${b.tagName.toLowerCase()}>#${(b as HTMLElement).id || '-'}:"${txt(b)}"`),
          modals: Array.from(document.querySelectorAll('.modal.show'))
            .map(m => `#${(m as HTMLElement).id || '-'}: "${txt(m).slice(0, 200)}"`),
          heading: txt(document.body).slice(0, 220),
        };
      });
      console.log(`\n${'='.repeat(90)}\n${when}\n  url   : ${info.url}\n  title : ${info.title}`);
      console.log(`  fields  : ${info.fields.join(' | ') || '(none)'}`);
      console.log(`  buttons : ${info.buttons.join(' | ') || '(none)'}`);
      if (info.modals.length) console.log(`  MODALS  : ${info.modals.join('  ||  ')}`);
      console.log(`  text    : ${info.heading}`);
    };

    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page.waitForTimeout(2_000);
    await shot('step 0 — login page');

    await page.locator('#Username').fill(MOBILE);
    await page.locator('#Password').fill(TEMP);
    const captcha = page.locator('#CaptchaCode, #captcha');
    if (await captcha.first().isVisible().catch(() => false)) await captcha.first().fill('123456');
    await page.locator('#btnLogin').click();
    await page.waitForTimeout(6_000);
    await shot('step 1 — after submitting the temporary password');

    // The OTP boxes are six unnamed inputs filled one digit at a time.
    if (/LoginOtpVerification/i.test(page.url())) {
      const boxes = page.locator('input[maxlength="1"], .otp-box');
      const count = await boxes.count();
      const otp = process.env.TEST_OTP ?? '123456';
      for (let i = 0; i < Math.min(count, otp.length); i += 1) {
        await boxes.nth(i).fill(otp[i]);
      }
      await page.locator('#btnVerifyOtp').click();
      await page.waitForTimeout(6_000);
      await shot('step 2 — after the OTP');
    }
  });
});
