import { test } from '../src/fixtures/page.fixtures';
import { ONBOARDING_MAKER, TEST_OTP } from '../src/config/accounts';
import { AddCustomerPage } from '../src/pages/customer-management/add-customer.page';
import { runTag, freshMobile } from '../src/helpers/test-identity';
import * as path from 'path';

/**
 * What /Customer/ValidatePanNumber actually accepts.
 *
 * ABCPE1234F is rejected with isValid 0 even though it is a well-formed PAN and
 * carries the 'P' that PAN_ENTITY_RULES says a Sole Proprietorship needs. So
 * the rule the application applies is not the rule this framework encodes, and
 * guessing which character it dislikes would be a fourth guess in a day that
 * has punished three.
 *
 * This replays the endpoint against a set of candidates that differ in one
 * dimension each — entity character, the fifth character, the digits, the
 * checksum letter — so the response says which dimension matters.
 *
 * Read-only: the endpoint validates, it does not write.
 *
 *   TOOLS=true ENV=qa npx playwright test --project=tools --grep "pan validation"
 */

const CANDIDATES = [
  { pan: 'ABCPE1234F', why: 'the current TEST_PAN — rejected today' },
  { pan: 'ABCPA1234F', why: 'fifth char A, matching a business name starting "AUTO"' },
  { pan: 'AAAPA1234A', why: 'all-A but for the entity char' },
  { pan: 'ABCCE1234F', why: 'entity char C (company) instead of P' },
  { pan: 'ABCFE1234F', why: 'entity char F (partnership)' },
  { pan: 'BNZPM2501F', why: 'a realistic individual PAN shape' },
  { pan: 'AAACP1234C', why: 'entity char C, different digits and checksum' },
  { pan: 'ABCDE1234F', why: 'entity char D — not a valid PAN entity at all' },
  // Repeats, to separate "this PAN is rejected" from "the first attempt is
  // rejected". The original was tested first and was also the value the wizard
  // had already entered, so its verdict is confounded until it is re-run from a
  // different position.
  { pan: 'ABCPE1234F', why: 'the original again, now late in the sequence' },
  { pan: 'ABCPA1234F', why: 'a known-accepted one again, to confirm stability' },
];

test.use({ storageState: { cookies: [], origins: [] } });

test.describe('Tools — probes @tools', () => {
  test('probe pan validation', async ({ loginPage, dashboardPage, page }) => {
    test.setTimeout(10 * 60_000);

    await loginPage.navigate();
    await loginPage.login(ONBOARDING_MAKER.username, ONBOARDING_MAKER.password);
    await dashboardPage.assertDashboardLoaded();

    // Capture the real request shape before replaying it — the payload's field
    // names and any anti-forgery token come from the page, not from guesswork.
    let payload = '';
    let endpoint = '';
    page.on('request', r => {
      if (/ValidatePanNumber/i.test(r.url())) {
        endpoint = r.url();
        payload = r.postData() ?? '';
      }
    });

    // Drive the real wizard. The validation call is gated behind form state
    // that is not obvious from the markup — a blur on a fresh page, or after
    // setting only the business type, produces no call at all, which looks
    // exactly like a PAN that passed silently. The page object is the only
    // thing known to reach the state where it fires, so use it and let the new
    // fail-fast throw; the payload is captured before it does.
    const wizard = new AddCustomerPage(page);
    const tag = runTag();
    const upload = path.join(process.cwd(), 'test-data', 'files', 'sample-doc.pdf');

    await wizard.gotoWizard();
    await wizard
      .fillBasicInformation({
        customerType: 'Fleet',
        panNumber: AddCustomerPage.TEST_PAN,
        panDob: '1990-01-01',
        businessName: `${tag} Probe Co`,
        businessEmail: `${tag.toLowerCase()}@example.com`,
        customerName: `${tag} Customer`,
        customerEmail: `${tag.toLowerCase()}.cust@example.com`,
        customerMobile: freshMobile(),
        otp: TEST_OTP,
        idProofNumber: AddCustomerPage.TEST_PAN,
        bankName: 'HDFC',
        bankAccountHolder: `${tag} Customer`,
        bankAccountNumber: '1234567890',
        ifscCode: 'HDFC0002048',
        uploadFile: upload,
      })
      .catch(e => console.log(`\n(wizard stopped as expected: ${e.message.split('\n')[0]})`));

    console.log(`\nendpoint : ${endpoint || '(never called)'}`);
    console.log(
      `payload  : ${payload ? 'encrypted (clientPayload blob) — cannot be edited and replayed' : '(none)'}\n`
    );

    // Replaying is not an option: the PAN travels inside an AES blob the page
    // builds, so substituting the string in the form body changes nothing and
    // every "candidate" would silently re-send the original. Each one has to go
    // through the field.
    const panField = page.locator('#SaveCustomerModel_PANNumber');

    for (const candidate of CANDIDATES) {
      const waiting = page
        .waitForResponse(r => /ValidatePanNumber/i.test(r.url()), { timeout: 15_000 })
        .catch(() => null);

      await panField.fill('');
      await panField.fill(candidate.pan);
      await panField.blur();

      const response = await waiting;
      const text = response ? await response.text().catch(() => '<unreadable>') : '(no call fired)';
      const accepted = /"isValid"\s*:\s*1/.test(text);

      console.log(`${candidate.pan}  ${(accepted ? 'ACCEPTED' : 'rejected').padEnd(8)} ${text.replace(/\s+/g, ' ').slice(0, 120)}`);
      console.log(`             ${candidate.why}`);

      // Clear whatever popup the verdict raised, or the next fill is swallowed.
      const modal = page.locator('.modal.show').first();
      if (await modal.isVisible().catch(() => false)) {
        await modal.locator('button.btn-close, .btn-primary').first().click({ timeout: 4_000 }).catch(() => undefined);
        await page.waitForTimeout(700);
      }
    }
  });
});
