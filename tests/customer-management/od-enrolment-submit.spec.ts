import { expect } from '@playwright/test';
import * as path from 'path';
import { test } from '../../src/fixtures/page.fixtures';
import { epic, feature, story, severity, description, owner } from 'allure-js-commons';
import { AddCustomerPage } from '../../src/pages/customer-management/add-customer.page';
import { DSA, TEST_OTP } from '../../src/config/accounts';
import { runTag } from '../../src/helpers/test-identity';

/**
 * OD enrolment, submitted — what division the application is actually stored with.
 *
 * The read-only suite (od-enrolment.spec.ts) establishes what the form shows. This
 * establishes what the server does with it, and the two can disagree in the way
 * that matters most here:
 *
 *   #CustDivisionID is hidden under OD but NOT cleared. Select Fleet, choose a
 *   division, switch to OD, and the control still holds that division — invisible
 *   to the maker. Whether that reaches the database decides whether a hidden field
 *   is a cosmetic untidiness or a customer silently enrolled into a division the
 *   change request says should no longer apply.
 *
 * A disabled control is not posted by an ordinary form submit, so the honest answer
 * is "it depends on how this page serialises itself" — and this page builds its
 * payload in script. So it is measured, not reasoned about.
 *
 * The maker is a DSA in Gurgaon (DivisionId 17), deliberately: the placeholder for
 * their state is "OD Default - HR_HP_PB" (DivisionId 54), so the two candidate
 * outcomes are different numbers and the result cannot be ambiguous.
 *
 * This creates real applications in QA — one per test, tagged AUTO<timestamp>.
 */

test.use({ storageState: { cookies: [], origins: [] } });
// Not serial: each test raises its own application and shares no state, and under
// serial the first failure — which is the finding, not an accident — would stop the
// second from ever running.
test.describe.configure({ mode: 'default' });

const OTP = TEST_OTP;
const UPLOAD = path.join(__dirname, '../../test-data/files/sample-doc.pdf');

/** The maker's own division — what an OD application must NOT be stored against. */
const MAKER_DIVISION_NAME = 'Gurgaon';
const MAKER_STATE = 'HR_HP_PB';
/**
 * Present but deliberately unused.
 *
 * dbo.DivisionMaster carries fifteen "OD Default - <state>" rows with
 * IsPlaceholder = 1, created 2026-09-22 16:11. A first version of this test asserted
 * an OD application would be stored against the one for its state, which was a guess
 * at the implementation rather than a reading of the requirement — and it failed for
 * that reason while the application was in fact correct. Kept only so the assertion
 * below can say what was NOT stored.
 */
const PLACEHOLDER_FOR_MAKER_STATE = 'OD Default - HR_HP_PB';

/** Deliberately in another state — the pin code must no longer be judged by division. */
const CROSS_STATE_PIN = '201304';

function testMobile(): string {
  return `9${String(Date.now()).slice(-9)}`;
}

interface StoredDivision {
  ReferenceNo: number;
  Status: number;
  CustomerDivisionId: number | null;
  DivisionName: string | null;
  IsPlaceholder: boolean | null;
}

test.describe('OD enrolment — submitted @customer-management @regression', () => {
  test.beforeEach(async ({ loginPage, dashboardPage, addCustomerPage }) => {
    await epic('Customer Management');
    await feature('OD enrolment');
    await owner('QA Team');

    await loginPage.navigate();
    await loginPage.login(DSA.username, DSA.password);
    await dashboardPage.assertDashboardLoaded();
    await addCustomerPage.gotoWizard();
  });

  /** Fills every step after Basic Information and submits, returning the reference. */
  async function completeAndSubmit(
    addCustomerPage: AddCustomerPage,
    reference: string
  ): Promise<void> {
    // OD is a single-step form: no Address, Branch or Meeting step, and the
    // multi-step controls the other customer types use are hidden throughout.
    await addCustomerPage.saveAsDraft();

    // Save As Draft raises its own modal, and it does not always arrive before
    // saveAsDraft() has finished looking for one. Left open it swallows the click
    // on Submit, which then fails as "an element intercepts pointer events" —
    // a message that says nothing about what the application actually complained
    // about. So it is cleared here, and reported.
    await addCustomerPage.waitForDialog(5_000);
    const afterDraft = await addCustomerPage.dismissValidationDialogs();
    if (afterDraft.length) console.log(`  Save As Draft said: ${afterDraft.join(' | ')}`);

    await addCustomerPage.submitOd();

    // Asserted before anything dismisses dialogs. The confirmation is a modal like
    // every other message on this form, so a helper that clears modals to unblock
    // the next click will also clear the evidence that the submit worked — which
    // is how a successful submission was first reported here as a refusal.

    // Waited for explicitly rather than asserted on, so that a submission which
    // did not go through can be reported with what the application actually said.
    // A bare "element not found" for the confirmation modal names the one thing
    // that is definitely not the cause.
    const confirmed = await addCustomerPage.submissionSuccess
      .waitFor({ state: 'visible', timeout: 30_000 })
      .then(() => true)
      .catch(() => false);

    if (!confirmed) {
      const dialogs = await addCustomerPage.dismissValidationDialogs();
      const inline = await addCustomerPage.visibleFieldErrors();
      throw new Error(
        `The OD application was not confirmed.\n` +
          `  dialogs: ${dialogs.join(' | ') || 'none'}\n` +
          `  inline errors: ${inline.join(' | ') || 'none'}\n` +
          `The address pin code (${CROSS_STATE_PIN}) is in another state, so a ` +
          `refusal naming the pin code, the state or the division is the restriction ` +
          `this change was meant to remove still being applied.`
      );
    }

    const confirmation = ((await addCustomerPage.submissionSuccess.textContent()) ?? '')
      .replace(/\s+/g, ' ').trim();
    console.log(`  submitted: ${confirmation}`);
    expect(
      confirmation,
      `The confirmation names a different application than the one filled in.`
    ).toContain(reference);
  }

  const storedDivision = async (
    db: { query: <T>(sql: string) => Promise<T[]> },
    reference: string
  ): Promise<StoredDivision> => {
    const rows = await db.query<StoredDivision>(`
      SELECT r.ReferenceNo, r.Status, r.CustomerDivisionId, d.DivisionName, d.IsPlaceholder
      FROM dbo.RawCustomerMaster r
      LEFT JOIN dbo.DivisionMaster d ON d.DivisionId = r.CustomerDivisionId
      WHERE r.ReferenceNo = ${Number(reference)}`);
    expect(rows, `No application was stored for reference ${reference}`).toHaveLength(1);
    return rows[0];
  };

  test('OD-20 a clean OD application is stored with no division at all', async ({
    addCustomerPage, db,
  }) => {
    test.setTimeout(420_000);
    await story('What the server stores for OD');
    await severity('critical');
    await description(
      'The acceptance criterion for the change. The client asked for the division ' +
        'level of the hierarchy to be removed from OD, so an OD application must be ' +
        'stored with NO division — not the maker\'s own, and not a substitute. ' +
        'Raised with OD chosen as the first action, so no division was ever picked, ' +
        'and with an address pin code in another state.'
    );

    const tag = runTag();
    const reference = await addCustomerPage.referenceNo.inputValue();
    console.log(`OD-20 reference ${reference}, tag ${tag}`);

    await addCustomerPage.fillOdBasicInformation({
      state: MAKER_STATE,
      pinCode: CROSS_STATE_PIN,
      businessAddress: `${tag} Test Address`,
      addressProofNumber: '1234567890',
      panNumber: AddCustomerPage.freshPan(),
      panDob: '1990-01-01',
      customerName: `${tag} OD Customer`,
      customerEmail: `${tag.toLowerCase()}.od@example.com`,
      customerMobile: testMobile(),
      otp: OTP,
      bankName: 'HDFC',
      bankAccountHolder: `${tag} OD Customer`,
      bankAccountNumber: '1234567890',
      ifscCode: 'HDFC0002048',
      uploadFile: UPLOAD,
    });

    await completeAndSubmit(addCustomerPage, reference);

    const stored = await storedDivision(db, reference);
    console.log(`OD-20 stored: ${JSON.stringify(stored)}`);

    // No division, expressed as the application stores it: CustomerDivisionId 0,
    // which resolves to no DivisionMaster row at all.
    expect(
      stored.CustomerDivisionId,
      `The OD application was stored against division ${stored.CustomerDivisionId} ` +
        `("${stored.DivisionName}"). The change removes the division level from OD, so ` +
        `an OD application should carry no division — any division here means the ` +
        `hierarchy is still being applied to OD somewhere.`
    ).toBe(0);

    expect(
      stored.DivisionName,
      `Division ${stored.CustomerDivisionId} resolves to "${stored.DivisionName}". ` +
        `A stored division of 0 should match no row in DivisionMaster.`
    ).toBeNull();

    // Two specific wrong answers worth naming, because each would look plausible:
    // the maker's own division, which is what the form used to impose, and the
    // OD Default placeholder, which exists in the data but is not used.
    expect(
      [MAKER_DIVISION_NAME, PLACEHOLDER_FOR_MAKER_STATE],
      `The application carries "${stored.DivisionName}".`
    ).not.toContain(stored.DivisionName);
  });

  test('OD-21 a division chosen under Fleet does not follow the form into OD', async ({
    addCustomerPage, db,
  }) => {
    test.setTimeout(420_000);
    await story('What the server stores for OD');
    await severity('critical');
    await description(
      'The same application, except a division is chosen under Fleet before the ' +
        'type is switched to OD. The control keeps that division while hidden ' +
        '(proved by OD-03), so this is the test that decides whether the hidden ' +
        'value reaches the database — which would mean an OD customer enrolled into ' +
        'a division nobody on the form could see.'
    );

    const tag = runTag();
    const reference = await addCustomerPage.referenceNo.inputValue();
    console.log(`OD-21 reference ${reference}, tag ${tag}`);

    // Pick Fleet and a real division first — the state this change has to survive.
    await addCustomerPage.selectDropdown('CustomerTypeID', { label: 'Fleet' });
    const chosen = await addCustomerPage.selectDropdown('CustDivisionID',
      { label: MAKER_DIVISION_NAME });
    console.log(`OD-21 chose division "${chosen}" under Fleet before switching to OD`);

    await addCustomerPage.fillOdBasicInformation({
      state: MAKER_STATE,
      pinCode: CROSS_STATE_PIN,
      businessAddress: `${tag} Test Address`,
      addressProofNumber: '1234567890',
      panNumber: AddCustomerPage.freshPan(),
      panDob: '1990-01-01',
      customerName: `${tag} OD Switch Customer`,
      customerEmail: `${tag.toLowerCase()}.ods@example.com`,
      customerMobile: testMobile(),
      otp: OTP,
      bankName: 'HDFC',
      bankAccountHolder: `${tag} OD Switch Customer`,
      bankAccountNumber: '1234567890',
      ifscCode: 'HDFC0002048',
      uploadFile: UPLOAD,
    });

    await completeAndSubmit(addCustomerPage, reference);

    const stored = await storedDivision(db, reference);
    console.log(`OD-21 stored: ${JSON.stringify(stored)}`);

    expect(
      stored.DivisionName,
      `The application was stored against "${stored.DivisionName}", the division ` +
        `chosen under Fleet before the type was switched to OD. The maker could not ` +
        `see that field at the point of submitting, so this OD customer has been ` +
        `enrolled into a division nobody chose for it — which is the restriction the ` +
        `change request asked to have removed, now applied invisibly.`
    ).not.toBe(MAKER_DIVISION_NAME);
    // What it *should* be is OD-20's subject; this test only has to establish that
    // the hidden Fleet choice did not follow the form into OD.
  });
});
