import { test } from '@playwright/test';
import { notExecutable, REASON } from '../../../src/helpers/v3-sheet.helper';

/**
 * Financial-lane cases that cannot be executed from the web application with the lane's
 * accounts, each emitted as a skipped entry with its reason.
 *
 * ── EFT Recharge (API) ────────────────────────────────────────────────────
 * The EFT credit is pushed by the bank/SAP side to FleetPlus's partner API. The endpoint
 * exists on QA — POST https://webapiqa.fleetforc.com/api/nayara/SAP/eft_recharge answers
 * 401 "Client_Id and API_Key are mandatory headers" — but no Client_Id / API_Key for it is
 * configured for the suite (.env.qa carries only the OFFICE_API_* and RO_API_* pairs, issued
 * for other endpoints), so no request can be authenticated.
 *
 * ── POS Transactions ──────────────────────────────────────────────────────
 * Every case is a fuel dispense at a POS terminal (Merchant/POS app).
 */

const EFT = 'EFT recharge API endpoint and credentials not provided to the suite (endpoint /api/nayara/SAP/eft_recharge exists on webapiqa.fleetforc.com and requires Client_Id/API_Key headers; none are configured for it).';

test.describe('v3 Financial — not executable from the web application', () => {
  notExecutable(['W-0069', 'F-142'], 'EFT recharge: missing amount', EFT);
  notExecutable(['W-0070', 'F-143'], 'EFT recharge: missing customerCode', EFT);
  notExecutable(['W-0071', 'F-144'], 'EFT recharge: missing utrNo', EFT);
  notExecutable(['W-0072'], 'EFT recharge: duplicate UTR', EFT);
  notExecutable(['W-0073'], 'EFT recharge: invalid virtual account goes to unclaimed (802)', EFT);
  notExecutable(['W-0074'], 'EFT recharge: negative amount', EFT);
  notExecutable(['W-0075', 'F-145'], 'EFT recharge: valid recharge', EFT);
  notExecutable(['W-0076', 'F-146'], 'EFT recharge: multiple payload processing', EFT);
  notExecutable(['W-0077', 'F-147'], 'EFT recharge: current date', EFT);
  notExecutable(['W-0078', 'F-148'], 'EFT recharge: past date', EFT);
  notExecutable(['W-0079', 'F-149'], 'EFT recharge: future date refused', EFT);
  notExecutable(['W-0080', 'F-150'], 'EFT recharge: optional valueDate', EFT);
  notExecutable(['W-0081', 'F-151'], 'EFT recharge: large amount', EFT);
  notExecutable(['W-0082'], 'EFT recharge: special characters in name', EFT);
  notExecutable(['W-0083'], 'EFT recharge: null payload', EFT);
  notExecutable(['W-0084'], 'EFT recharge: wallet credit reflected', EFT);

  notExecutable(['W-0523'], 'POS: blocked vehicle rejects Wallet Sale before OTP', REASON.POS);
  notExecutable(['W-0524'], 'POS: blocked vehicle rejects RO Credit Sale before OTP', REASON.POS);
  notExecutable(['W-0525'], 'POS: blocked vehicle rejects SFL Sale before OTP', REASON.POS);
  notExecutable(['W-0526'], 'POS: de-mapped vehicle rejects all transaction types', REASON.POS);
  notExecutable(['W-0527'], 'POS: RO credit disabled blocks RO Credit Sale', REASON.POS);
  notExecutable(['W-0528'], 'POS: active vehicle completes a Wallet Sale', REASON.POS);
  notExecutable(['W-0529'], 'POS: vehicle re-activated transacts again', REASON.POS);
  notExecutable(['W-0530'], 'POS: Wallet Sale has no independent gate flag', REASON.POS);
  notExecutable(['W-0531'], 'POS: active RO-customer mapping allows RO Credit Sale', REASON.POS);
  notExecutable(['W-0532'], 'POS: vehicle-RO mapped vehicle transacts at its RO', REASON.POS);
  notExecutable(['W-0533'], 'POS: unmapped vehicle transacts at any RO', REASON.POS);
  notExecutable(['W-0534'], 'POS: daily limit — exact remaining balance passes', REASON.POS);
  notExecutable(['W-0535'], 'POS: daily limit shared across Wallet, RO Credit and SFL', REASON.POS);
  notExecutable(['W-0536'], 'POS: daily limit resets at midnight IST', REASON.POS);
});
