import * as path from 'path';
import { expect } from '@playwright/test';
import { test } from '../../src/fixtures/session.fixtures';
import {
  description, epic, feature, owner, parameter, severity, story,
} from 'allure-js-commons';
import { CustomerBankPage } from '../../src/pages/customer-management/customer-bank.page';
import { DbHelper } from '../../src/helpers/db.helper';
import { Evidence } from '../../src/helpers/evidence.helper';
import { runTag } from '../../src/helpers/test-identity';

/**
 * Add Customer Bank Account, and the approval that makes it real.
 *
 * No workbook sheet covers this screen, so the cases are derived from the
 * screen itself rather than from a specification. That is worth stating plainly:
 * these tests describe what the form does, and cannot tell you whether what it
 * does is what was intended.
 *
 * ── Why the approval half matters ────────────────────────────────────────
 * Submitting writes to RawCustomerBankDetails. Only approval moves the account
 * into CustomerBankDetails, which is what the rest of the system reads. A test
 * that stops at "submitted successfully" proves the form posts, not that the
 * customer has a bank account — and the distinction is the entire point of a
 * maker-checker flow.
 *
 * ── What these tests create ──────────────────────────────────────────────
 * Real rows, on a real customer. Every account number is run-tagged so QA can
 * find them. Nothing is deleted afterwards, because the connection is read-only
 * and the screen offers no removal — so the happy-path test is deliberately one
 * account per run, not one per case.
 */

/** A customer this framework created. Not one of QA's own records. */
const CUSTOMER = process.env.BANK_TEST_CUSTOMER ?? 'NAYAFP1013400034';

const UPLOAD = path.join(__dirname, '../../test-data/files/sample-doc.pdf');

/** A syntactically valid IFSC — the format is bank code, 0, branch code. */
const IFSC = process.env.BANK_TEST_IFSC ?? 'HDFC0002048';

interface BankRow {
  BankId: number;
  ReferenceNo: string;
  CustomerID: string;
  AccountNumber: string;
  Status: number;
  StatusFlag: boolean;
}

async function pendingRows(customerId: string): Promise<BankRow[]> {
  return DbHelper.query<BankRow>(
    `SELECT BankId, ReferenceNo, CustomerID, AccountNumber, Status, StatusFlag
       FROM dbo.RawCustomerBankDetails WHERE CustomerID = @customerId
      ORDER BY BankId DESC`,
    { customerId }
  );
}

async function approvedRows(customerId: string): Promise<BankRow[]> {
  return DbHelper.query<BankRow>(
    `SELECT BankId, ReferenceNo, CustomerID, AccountNumber, Status, StatusFlag
       FROM dbo.CustomerBankDetails WHERE CustomerID = @customerId
      ORDER BY BankId DESC`,
    { customerId }
  );
}

/** Ten digits, run-tagged so the row is traceable to the run that made it. */
function accountNumber(): string {
  return String(Date.now()).slice(-10);
}

test.describe('Customer Bank Account — add and approve @customer-management', () => {
  test.describe.configure({ mode: 'default' });

  test.beforeEach(async () => {
    await epic('Customer Management');
    await feature('Add Customer Bank Account');
    await owner('QA Team');
  });

  test('the screen opens with only a search box', async ({ page }) => {
    await story('Form contract');
    await severity('normal');
    await description(
      'The entry form must not be usable before a customer is chosen. Every ' +
        'field exists in the DOM from the start, so "present" proves nothing — ' +
        'what matters is that they are not yet interactable.'
    );

    const bank = new CustomerBankPage(page);
    await bank.openAddForm();

    await expect(bank.searchCustomerId).toBeVisible();
    await expect(bank.searchButton).toBeVisible();
    await expect(
      bank.bankName,
      'The bank form is reachable before a customer has been selected.'
    ).toBeHidden();
    await expect(bank.accountNumber).toBeHidden();
  });

  test('an unknown customer id does not reveal the form', async ({ page }) => {
    await story('Form contract');
    await severity('normal');
    await description('Searching a customer that does not exist must not offer the entry form.');

    const bank = new CustomerBankPage(page);
    await bank.openAddForm();
    const found = await bank.findCustomer('NAYAFP0000000000');

    expect(found, 'The form was offered for a customer that does not exist.').toBe(false);
    expect(
      (await bank.messages()).join(' | '),
      'Nothing was displayed for an unknown customer id.'
    ).not.toBe('');
  });

  test('a known customer reveals the entry form', async ({ page }) => {
    await story('Form contract');
    await severity('critical');
    await parameter('Customer', CUSTOMER);
    await description('Searching an approved customer offers the bank entry form.');

    const bank = new CustomerBankPage(page);
    await bank.openAddForm();
    const found = await bank.findCustomer(CUSTOMER);
    test.skip(!found, `${CUSTOMER} was not found on the bank screen.`);

    await bank.revealForm();
    await expect(bank.bankName).toBeVisible();
    await expect(bank.accountNumber).toBeVisible();
    await expect(bank.ifscCode).toBeVisible();
  });

  /**
   * The whole flow, in one test.
   *
   * Kept together for the same reason the deactivate/reactivate pair is: the
   * approval only means something in relation to the submission that preceded
   * it, and splitting them would leave a pending row behind whenever the first
   * half failed. One run creates one account.
   */
  test('an added account stays pending until it is approved', async ({ page }) => {
    test.setTimeout(240_000);
    await story('Maker-checker');
    await severity('critical');
    await parameter('Customer', CUSTOMER);
    await description(
      'Adds a bank account, checks it lands in RawCustomerBankDetails and NOT ' +
        'in CustomerBankDetails, then approves it and checks it moves. The ' +
        'screen saying "submitted" is not evidence that either happened.'
    );

    const ev = new Evidence('Customer bank account — add and approve', 'customer-bank-add-approve');
    ev.fact('Customer', CUSTOMER);
    let status: 'passed' | 'failed' | 'skipped' = 'passed';

    try {
      const account = accountNumber();
      const tag = runTag();
      ev.fact('Account number', account);
      ev.fact('Run tag', tag);

      const pendingBefore = await pendingRows(CUSTOMER);
      const approvedBefore = await approvedRows(CUSTOMER);
      await ev.note(
        'Database before',
        `${pendingBefore.length} pending, ${approvedBefore.length} approved.`,
        `RawCustomerBankDetails : ${pendingBefore.length} row(s)\n` +
          `CustomerBankDetails    : ${approvedBefore.length} row(s)`
      );

      const bank = new CustomerBankPage(page);
      await bank.openAddForm();

      const found = await bank.findCustomer(CUSTOMER);
      if (!found) {
        status = 'skipped';
        const reason = `${CUSTOMER} was not found on the bank screen, so nothing can be added.`;
        await ev.note('Precondition unavailable', reason, reason);
        ev.finish(status);
        test.skip(true, reason);
        return;
      }

      await bank.revealForm();
      await bank.fillAccount({
        bankName: 'HDFC',
        accountHolderName: `${tag} Holder`,
        accountNumber: account,
        ifscCode: IFSC,
        chequeFile: UPLOAD,
      });

      const submitMessage = await bank.submit();
      await ev.ui(page, 'After submitting', `The screen said: “${submitMessage || 'nothing'}”.`);

      // ── Pending, and only pending ──────────────────────────────────────
      const pendingAfter = await pendingRows(CUSTOMER);
      const approvedAfter = await approvedRows(CUSTOMER);
      const created = pendingAfter.find(r => r.AccountNumber === account);

      await ev.note(
        'Database after submitting',
        created ? 'The account is pending.' : 'Nothing was written.',
        `RawCustomerBankDetails : ${pendingBefore.length} -> ${pendingAfter.length}\n` +
          `CustomerBankDetails    : ${approvedBefore.length} -> ${approvedAfter.length}\n` +
          `reference              : ${created?.ReferenceNo ?? '(none)'}\n` +
          `status                 : ${created?.Status ?? '(none)'}`
      );

      expect(
        created,
        `The screen said “${submitMessage}” but no row with account ${account} ` +
          `reached RawCustomerBankDetails.`
      ).toBeTruthy();

      expect(
        approvedAfter.some(r => r.AccountNumber === account),
        'The account reached CustomerBankDetails without an approval. A ' +
          'maker-checker flow that skips the checker is not a maker-checker flow.'
      ).toBe(false);

      // ── Approve, and check it moved ────────────────────────────────────
      const reference = created!.ReferenceNo;
      ev.fact('Reference', reference);
      // Driven by bankDetailId, which the detail page takes as a query
      // parameter. The queue masks the account and carries no reference, so
      // matching its rows is ambiguous once more than one row is pending.
      const decision = await bank.approve(created!.BankId, account);
      await ev.ui(page, 'After approving', `The screen said: “${decision.message || 'nothing'}”.`);

      if (!decision.reached) {
        await ev.note(
          'Not in the approvals queue',
          'The submitted account could not be found to approve.',
          `${decision.message}\n\nThe row exists in RawCustomerBankDetails as ` +
            `${reference}, so it was created — but the checker screen did not ` +
            `list it. That gap is worth reporting on its own.`
        );
      }

      const finalApproved = await approvedRows(CUSTOMER);
      await ev.note(
        'Database after approving',
        `${finalApproved.length} approved row(s).`,
        `CustomerBankDetails: ${approvedAfter.length} -> ${finalApproved.length}`
      );

      expect(
        finalApproved.some(r => r.AccountNumber === account),
        `Approval reported “${decision.message}” but account ${account} is still ` +
          `absent from CustomerBankDetails. The screen and the record disagree.`
      ).toBe(true);
    } catch (error) {
      if (status !== 'skipped') status = 'failed';
      throw error;
    } finally {
      if (status !== 'skipped') ev.finish(status);
    }
  });
});
