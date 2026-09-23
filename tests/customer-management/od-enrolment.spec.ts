import { Locator, expect } from '@playwright/test';
import { test } from '../../src/fixtures/session.fixtures';
import { epic, feature, story, severity, description, owner } from 'allure-js-commons';
import { DSA } from '../../src/config/accounts';

/**
 * OD enrolment — Division removed, and the pin code no longer tied to it.
 *
 * Change request: "During enrolment of OD user type, Division along with Pin code
 * restriction basis division to be removed."
 *
 * The implementation is not a deleted field. dbo.DivisionMaster gained an
 * IsPlaceholder column and fifteen rows named "OD Default - <business state>", one
 * per state, and the form hides #CustDivisionID when the customer type is OD. So
 * "removed" means three separate things a test can check, and they fail
 * differently:
 *
 *   the control is not offered            (OD-01, OD-03)
 *   it is still offered for other types   (OD-02, OD-04)
 *   no pin code is judged against it      (OD-10..OD-13)
 *
 * The maker here is deliberately a DSA. A DSA belongs to exactly one division, so
 * "a pin code outside the maker's division" is a real condition for this account —
 * against an FP Admin, who is mapped everywhere, the same test would prove nothing.
 * Measured: 9611200199 is Gurgaon division, HR_HP_PB state, North region.
 *
 * Nothing here writes. The wizard is filled only as far as the field under test,
 * and no draft is saved and nothing submitted — see OD-ENROLMENT-SCENARIOS.md for
 * the submit-and-verify cases, which create a real application.
 */

test.use({ sessionAccount: DSA });

/** Pin codes chosen relative to the maker's own division, not at random. */
const IN_DIVISION = { pin: '122001', state: 'HARYANA' };
const OTHER_STATE = { pin: '201304', state: 'UTTAR PRADESH' };
const OTHER_REGION = { pin: '560001', state: 'KARNATAKA' };
const UNRESOLVABLE = '999999';

const NON_OD_TYPES = ['Fleet', 'Non Fleet', 'Corporate'] as const;

/**
 * Reads a resolved-location field, whichever kind of element it is.
 *
 * The address state, city and district are filled by the pin code lookup, and they
 * are not all inputs — #BusinessStateDisplay is not, so inputValue() throws on it.
 * A first version of these tests swallowed that in a catch and reported every pin
 * code as having resolved to nothing, which read exactly like the restriction the
 * change request removes. Hence value-or-text, and no catch around the pair.
 */
async function displayedValue(locator: Locator): Promise<string> {
  const tag = await locator.evaluate(element => element.tagName.toLowerCase());
  const raw = tag === 'input' || tag === 'select' || tag === 'textarea'
    ? await locator.inputValue()
    : (await locator.textContent()) ?? '';
  return raw.trim();
}

test.describe('OD enrolment @customer-management @regression', () => {
  test.beforeEach(async ({ addCustomerPage }) => {
    await epic('Customer Management');
    await feature('OD enrolment');
    await owner('QA Team');

    // A fresh wizard per test, on the session the worker already holds. Each
    // test asserts against a clean form, so this reload is the isolation the
    // shared context gives up.
    await addCustomerPage.gotoWizard();
  });

  // ─── A: the division control ───────────────────────────────────────────────
  test('OD-01 the division is not offered when the customer type is OD', async ({
    addCustomerPage,
  }) => {
    await story('Division removed for OD');
    await severity('critical');
    await description(
      'The heart of the change. Asserts on a clean form — choosing OD as the first ' +
        'action — because the control is disabled under OD, so nothing resets it: a ' +
        'division left behind by an earlier selection stays selected and reads as ' +
        'though OD had chosen it.'
    );

    await addCustomerPage.selectDropdown('CustomerTypeID', { label: 'OD' });
    await addCustomerPage.settle();

    await expect(
      addCustomerPage.division,
      'The division dropdown is still on screen for an OD enrolment. The change ' +
        'request asks for it to be removed for this customer type.'
    ).toBeHidden();

    expect(
      await addCustomerPage.division.inputValue(),
      'The division control is hidden but still carries a value, which the form ' +
        'would post as the division for an OD customer.'
    ).toBe('0');
  });

  for (const type of NON_OD_TYPES) {
    test(`OD-02 the division is still required for ${type}`, async ({ addCustomerPage }) => {
      await story('Other customer types unaffected');
      await severity('critical');
      await description(
        'The change names OD only. This is the regression guard: a fix applied to ' +
          'the shared form rather than to the OD branch of it would take the ' +
          'division away from every customer type, and nothing else in the suite ' +
          'would notice.'
      );

      await addCustomerPage.selectDropdown('CustomerTypeID', { label: type });
      await addCustomerPage.settle();

      await expect(
        addCustomerPage.division,
        `The division dropdown is hidden for ${type}. Only OD was meant to change.`
      ).toBeVisible();
      await expect(addCustomerPage.division).toBeEnabled();

      const options = await addCustomerPage.division.locator('option').count();
      expect(options, `${type} offers no divisions to choose from`).toBeGreaterThan(1);
    });
  }

  test('OD-03 switching from Fleet to OD clears the division it had chosen', async ({
    addCustomerPage,
  }) => {
    await story('Division removed for OD');
    await severity('critical');
    await description(
      'A hidden control that keeps its value is the failure mode this change ' +
        'invites: the maker sees no division, the form posts one anyway, and the ' +
        'application is divisioned by a field nobody chose.'
    );

    await addCustomerPage.selectDropdown('CustomerTypeID', { label: 'Fleet' });
    const chosen = await addCustomerPage.selectDropdown('CustDivisionID', {});
    await addCustomerPage.settle();
    expect(await addCustomerPage.division.inputValue()).not.toBe('0');

    await addCustomerPage.selectDropdown('CustomerTypeID', { label: 'OD' });
    await addCustomerPage.settle();

    await expect(addCustomerPage.division).toBeHidden();
    expect(
      await addCustomerPage.division.inputValue(),
      `The division "${chosen}" chosen under Fleet survived the switch to OD. It is ` +
        `hidden from the maker but still in the form, so an OD application would be ` +
        `raised into that division.`
    ).toBe('0');
  });

  test('OD-04 switching from OD back to Fleet restores the division', async ({
    addCustomerPage,
  }) => {
    await story('Other customer types unaffected');
    await severity('normal');
    await description(
      'The reverse of OD-03. Hiding a control on a customer-type change is easy to ' +
        'implement one-way, leaving a maker who mis-picked OD with no division field ' +
        'and no way to get it back short of reloading the form.'
    );

    await addCustomerPage.selectDropdown('CustomerTypeID', { label: 'OD' });
    await addCustomerPage.settle();
    await expect(addCustomerPage.division).toBeHidden();

    await addCustomerPage.selectDropdown('CustomerTypeID', { label: 'Fleet' });
    await addCustomerPage.settle();

    await expect(
      addCustomerPage.division,
      'The division did not come back when the customer type was changed away from ' +
        'OD, so a maker who picked OD by mistake cannot choose a division without ' +
        'starting the form again.'
    ).toBeVisible();
    await expect(addCustomerPage.division).toBeEnabled();
  });

  test('OD-05 the division list follows the business state', async ({
    addCustomerPage, page,
  }) => {
    await story('Division removed for OD');
    await severity('normal');
    await description(
      'Not about OD directly, but about what OD leaves behind. The division list is ' +
        'a child of the state; if it stops reloading while the control is hidden, ' +
        'switching back to Fleet offers the previous state\'s divisions under the new ' +
        'state, and the maker cannot tell.'
    );

    await addCustomerPage.selectDropdown('CustomerTypeID', { label: 'OD' });
    await addCustomerPage.settle();

    const before = await page.$$eval('#CustDivisionID option', o =>
      o.map(x => (x.textContent || '').trim()));

    const states = await page.$$eval('#CustStateID option:not([value="0"]):not([value=""])',
      o => o.map(x => (x.textContent || '').trim()));
    const otherState = states.find(s => !/HR_HP_PB/i.test(s));
    expect(otherState, 'only one business state is on offer, so this cannot be tested').toBeTruthy();

    await addCustomerPage.selectDropdown('CustStateID', { label: otherState! });
    await addCustomerPage.settle();

    const after = await page.$$eval('#CustDivisionID option', o =>
      o.map(x => (x.textContent || '').trim()));

    expect(
      after,
      `The division list did not reload when the business state changed to ` +
        `${otherState}. It still offers ${before.join(', ')}, which belong to the ` +
        `maker's own state — so switching the customer type back to Fleet would ` +
        `present divisions from the wrong state.`
    ).not.toEqual(before);
  });

  test('OD-05b the division list follows the business state under Fleet too', async ({
    addCustomerPage, page,
  }) => {
    await story('Other customer types unaffected');
    await severity('normal');
    await description(
      'The control for OD-05, and the whole of its triage. If the division list is ' +
        'stale under Fleet as well, the change did not cause it and the finding ' +
        'belongs to the form; if Fleet reloads and OD does not, hiding the control ' +
        'stopped it being refreshed and the finding belongs to this change.'
    );

    await addCustomerPage.selectDropdown('CustomerTypeID', { label: 'Fleet' });
    await addCustomerPage.settle();

    const before = await page.$$eval('#CustDivisionID option', o =>
      o.map(x => (x.textContent || '').trim()));

    const states = await page.$$eval('#CustStateID option:not([value="0"]):not([value=""])',
      o => o.map(x => (x.textContent || '').trim()));
    const otherState = states.find(s => !/HR_HP_PB/i.test(s));

    await addCustomerPage.selectDropdown('CustStateID', { label: otherState! });
    await addCustomerPage.settle();

    const after = await page.$$eval('#CustDivisionID option', o =>
      o.map(x => (x.textContent || '').trim()));
    console.log(`Fleet, state -> ${otherState}\n  before: ${before.join(', ')}\n  after:  ${after.join(', ')}`);

    expect(
      after,
      `Under Fleet the division list also failed to reload when the state changed ` +
        `to ${otherState}: still ${after.join(', ')}. The maker can therefore choose ` +
        `a division belonging to a different state than the one on the application.`
    ).not.toEqual(before);
  });

  test('OD-06 OD can be enrolled under any business state, division still hidden', async ({
    addCustomerPage, page,
  }) => {
    await story('Division removed for OD');
    await severity('normal');
    await description(
      'The other half of "no restriction basis division": a maker in one division ' +
        'should be able to raise an OD application anywhere. Walks every business ' +
        'state the form offers and checks the division never reappears.'
    );

    await addCustomerPage.selectDropdown('CustomerTypeID', { label: 'OD' });
    await addCustomerPage.settle();

    const states = await page.$$eval('#CustStateID option:not([value="0"]):not([value=""])',
      o => o.map(x => (x.textContent || '').trim()));
    expect(states.length, 'no business states on offer').toBeGreaterThan(1);

    const reappeared: string[] = [];
    for (const state of states) {
      await addCustomerPage.selectDropdown('CustStateID', { label: state });
      await addCustomerPage.settle();
      if (await addCustomerPage.division.isVisible().catch(() => false)) reappeared.push(state);
    }

    expect(
      reappeared,
      `The division reappeared for an OD enrolment under ${reappeared.join(', ')}.`
    ).toEqual([]);
    console.log(`Division stayed hidden across all ${states.length} business states.`);
  });

  // ─── B: the pin code ───────────────────────────────────────────────────────
  for (const { label, pin, state } of [
    { label: 'OD-10 in another state', ...OTHER_STATE },
    { label: 'OD-11 in another region', ...OTHER_REGION },
    { label: 'OD-12 in the maker\'s own division', ...IN_DIVISION },
  ]) {
    test(`${label} — the address pin code ${pin} is accepted for OD`, async ({
      addCustomerPage,
    }) => {
      await story('Pin code no longer judged against the division');
      await severity('critical');
      await description(
        'The pin code is the second half of the change request. Asserts on what the ' +
          'pin code resolved to, not merely on the absence of an error: a lookup ' +
          'that silently fails also produces no error, and would pass a test that ' +
          'only checked for complaints.'
      );

      await addCustomerPage.selectDropdown('CustomerTypeID', { label: 'OD' });
      await addCustomerPage.settle();

      await addCustomerPage.enterAddressPinCode(pin);
      await addCustomerPage.waitForResolvedLocation();

      const resolved = await displayedValue(addCustomerPage.addressState);
      expect(
        resolved.toUpperCase(),
        `Pin code ${pin} did not resolve to ${state} for an OD enrolment. The form ` +
          `shows the state as "${resolved}", which is how a division-based ` +
          `restriction on the pin code would present itself.`
      ).toContain(state);

      const complaints = await addCustomerPage.visibleFieldErrors();
      const aboutLocation = complaints.filter(c => /pin|division|state|district|city/i.test(c));
      expect(
        aboutLocation,
        `The form complained about ${pin} on an OD enrolment: ${aboutLocation.join(' | ')}`
      ).toEqual([]);
    });
  }

  test('OD-13 a pin code that resolves to nothing is still refused', async ({
    addCustomerPage,
  }) => {
    await story('Pin code no longer judged against the division');
    await severity('critical');
    await description(
      'The counterweight to OD-10 to OD-12. The change removes a division rule, not ' +
        'pin-code validation — a build that accepts any six digits satisfies every ' +
        'other test here and is worse than the restriction it replaced.'
    );

    await addCustomerPage.selectDropdown('CustomerTypeID', { label: 'OD' });
    await addCustomerPage.settle();

    await addCustomerPage.enterAddressPinCode(UNRESOLVABLE);
    // Given the same chance to resolve as a valid pin code, so "never resolved"
    // is a measured outcome rather than a read taken too early.
    await addCustomerPage.waitForResolvedLocation();

    const resolved = await displayedValue(addCustomerPage.addressState);
    const complaints = await addCustomerPage.visibleFieldErrors();

    expect(
      resolved.trim() === '' || complaints.some(c => /pin/i.test(c)),
      `${UNRESOLVABLE} is not a real pin code, and the form neither left the state ` +
        `empty nor said anything: it resolved to "${resolved}" with no complaint.`
    ).toBeTruthy();
    console.log(`${UNRESOLVABLE} -> state "${resolved}", complaints: ${complaints.join(' | ') || 'none'}`);
  });
});
