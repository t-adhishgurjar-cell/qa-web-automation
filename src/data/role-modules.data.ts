/**
 * Every module a customer's own administrators can reach, and its measured shape.
 *
 * Built by walking the live application as each role — not from the coverage
 * note, which lists screens this account never sees, and not from the sidebar
 * markup, which omits what a role can still reach by URL. Each entry's control
 * counts were read off the rendered page on 14 September 2026.
 *
 * ── What the counts are for ───────────────────────────────────────────────
 * They are floors, not equalities. A screen that grows a field still passes; a
 * screen that comes back with its form missing does not. That catches the
 * failure this application actually produces — a page that answers 200 and
 * renders an empty shell, which a bare "did it load" check calls healthy.
 *
 * Counting *visible* controls matters here. This application keeps dialogs in
 * the DOM permanently and hidden, so an unfiltered count is inflated by
 * machinery that is never on screen.
 *
 * ── Roles ─────────────────────────────────────────────────────────────────
 * 9200000000 holds both. The parent admin reaches 39 modules, the branch admin
 * 25, and the branch set is a strict subset — it has nothing of its own. The 14
 * it lacks are the ones that create company structure or move money.
 */

export type ModuleRole = 'parent' | 'branch';

export interface RoleModule {
  /** Sidebar section, as the application groups it. */
  section: string;
  label: string;
  route: string;
  /** Which of the two roles gets this module in its menu. */
  roles: ModuleRole[];
  /** Minimum visible inputs/selects/textareas, measured. */
  fields: number;
  /** Minimum visible buttons, measured. */
  buttons: number;
  /** Minimum visible tables, measured. */
  grids: number;
}

/**
 * Shapes that differ between the two roles.
 *
 * Where a role sees a narrower version of the same screen, its floor is lower —
 * asserting the parent's numbers against a branch admin would fail on a
 * correctly-scoped page. The difference is itself asserted in role-scope.spec.ts;
 * here it only keeps the floors honest.
 */
export const BRANCH_OVERRIDES: Record<string, Partial<Pick<RoleModule, 'fields' | 'buttons' | 'grids'>>> = {
  '/Customer/CustomerProfile': { buttons: 4 },
  '/Customer/ViewCustomerUser': { fields: 5, buttons: 11 },
  '/TransactionDetail/WalletFundTransactions': { fields: 10, buttons: 20 },
  '/Customer/CustomerCreditPinValidity': { fields: 2, buttons: 12 },
  '/Vehicle/VehicleBlockUnblock': { buttons: 12 },
  '/Vehicle/ManageVehicles': { fields: 5 },
  '/Financial/ShowWalletBalance': { fields: 1, buttons: 3, grids: 0 },
};

const B: ModuleRole[] = ['parent', 'branch'];
const P: ModuleRole[] = ['parent'];

export const ROLE_MODULES: RoleModule[] = [
  // ── Top level ───────────────────────────────────────────────────────────
  { section: 'Top level', label: 'Dashboard', route: '/Dashboard/Index', roles: B, fields: 2, buttons: 9, grids: 0 },
  { section: 'Top level', label: 'RO Locator', route: '/RetailOutlet/ViewLiveRo', roles: B, fields: 3, buttons: 10, grids: 0 },

  // ── Customer Management ─────────────────────────────────────────────────
  { section: 'Customer Management', label: 'Customer Profile', route: '/Customer/CustomerProfile', roles: B, fields: 0, buttons: 9, grids: 0 },
  { section: 'Customer Management', label: 'Manage Customer Users', route: '/Customer/ViewCustomerUser', roles: B, fields: 6, buttons: 20, grids: 2 },
  { section: 'Customer Management', label: 'Add Branch', route: '/Customer/AddBranch', roles: P, fields: 9, buttons: 6, grids: 0 },
  { section: 'Customer Management', label: 'Add Customer Bank Account', route: '/Financial/AddBankDetails', roles: P, fields: 3, buttons: 11, grids: 2 },
  { section: 'Customer Management', label: 'Transaction Details', route: '/TransactionDetail/WalletFundTransactions', roles: B, fields: 11, buttons: 21, grids: 2 },
  { section: 'Customer Management', label: 'Redeem Reward Points', route: '/Reward/RedeemCoins', roles: P, fields: 1, buttons: 4, grids: 0 },
  { section: 'Customer Management', label: 'Customer Referrals', route: '/Lead/CustomerReferral', roles: P, fields: 0, buttons: 4, grids: 0 },
  { section: 'Customer Management', label: 'Manage Credit PIN', route: '/Customer/CustomerCreditPinValidity', roles: B, fields: 3, buttons: 30, grids: 2 },
  { section: 'Customer Management', label: 'Credit Pin Logs', route: '/Customer/CreditPinChangeLog', roles: B, fields: 7, buttons: 12, grids: 2 },
  { section: 'Customer Management', label: 'Customer Audit Logs', route: '/Customer/CustomerAuditLog', roles: B, fields: 3, buttons: 5, grids: 0 },

  // ── Vehicle Management ──────────────────────────────────────────────────
  { section: 'Vehicle Management', label: 'Add Vehicles', route: '/Vehicle/AddVehicles', roles: B, fields: 4, buttons: 7, grids: 0 },
  { section: 'Vehicle Management', label: 'Transfer vehicle', route: '/Vehicle/TransferVehicle', roles: B, fields: 4, buttons: 5, grids: 0 },
  { section: 'Vehicle Management', label: 'De-map vehicle', route: '/Vehicle/DeMapVehicle', roles: B, fields: 1, buttons: 5, grids: 0 },
  { section: 'Vehicle Management', label: 'Block/Unblock Vehicle', route: '/Vehicle/VehicleBlockUnblock', roles: B, fields: 4, buttons: 7, grids: 2 },
  { section: 'Vehicle Management', label: 'Manage Vehicles', route: '/Vehicle/ManageVehicles', roles: B, fields: 8, buttons: 12, grids: 2 },
  { section: 'Vehicle Management', label: 'Vehicle Authentication', route: '/Vehicle/VehicleAuthentication', roles: B, fields: 2, buttons: 5, grids: 0 },
  { section: 'Vehicle Management', label: 'Vehicle RO Mapping', route: '/Vehicle/VehicleROMapping', roles: P, fields: 5, buttons: 8, grids: 1 },
  { section: 'Vehicle Management', label: 'Vehicle Lifecycle', route: '/Vehicle/VehicleLifecycle', roles: B, fields: 2, buttons: 5, grids: 0 },
  { section: 'Vehicle Management', label: 'Manage Pending Vehicle', route: '/Vehicle/ManagePendingVehicle', roles: P, fields: 4, buttons: 11, grids: 2 },
  { section: 'Vehicle Management', label: 'View Vehicle Limits Usage', route: '/Vehicle/ViewVehicleLimitsUsage', roles: P, fields: 1, buttons: 5, grids: 0 },
  { section: 'Vehicle Management', label: 'Set Vehicle Purchase Limit', route: '/Vehicle/SetVehiclePrepaidLimit', roles: B, fields: 2, buttons: 9, grids: 0 },

  // ── Wallet Management ───────────────────────────────────────────────────
  { section: 'Wallet Management', label: 'View Virtual Account', route: '/Customer/VirtualAccountDetails', roles: B, fields: 0, buttons: 4, grids: 0 },
  { section: 'Wallet Management', label: 'View Wallet Balance', route: '/Financial/ShowWalletBalance', roles: B, fields: 4, buttons: 8, grids: 1 },
  { section: 'Wallet Management', label: 'Wallet Transfer', route: '/Financial/FundTransfer', roles: P, fields: 4, buttons: 20, grids: 1 },
  { section: 'Wallet Management', label: 'Wallet Recharge By PG', route: '/PgRecharge/WalletRecharge', roles: P, fields: 3, buttons: 5, grids: 0 },
  { section: 'Wallet Management', label: 'View Wallet Recharge Status', route: '/PgRecharge/PgTransactionDetails', roles: P, fields: 7, buttons: 9, grids: 2 },
  { section: 'Wallet Management', label: 'View Purchase OTP', route: '/User/UserOtpLog', roles: B, fields: 2, buttons: 9, grids: 1 },

  // ── Fuel Voucher ────────────────────────────────────────────────────────
  { section: 'Fuel Voucher', label: 'Manage Fuel Voucher', route: '/FuelVoucher/FuelVoucherDetails', roles: P, fields: 6, buttons: 12, grids: 2 },
  { section: 'Fuel Voucher', label: 'Redeem Fuel Voucher', route: '/FuelVoucher/RenderRedeemVoucherPage', roles: P, fields: 6, buttons: 11, grids: 2 },

  // ── RO Credit Management ────────────────────────────────────────────────
  { section: 'RO Credit Management', label: 'RO Credit Settlement', route: '/Customer/RoCreditSettlement', roles: B, fields: 4, buttons: 9, grids: 1 },
  { section: 'RO Credit Management', label: 'RO Credit Transactions', route: '/Customer/RoAccountDetail', roles: B, fields: 3, buttons: 6, grids: 0 },

  // ── Reports ─────────────────────────────────────────────────────────────
  { section: 'Reports', label: 'Vehicle Onboarding Report', route: '/Reports/VehicleOnboardingReport', roles: B, fields: 8, buttons: 5, grids: 0 },
  { section: 'Reports', label: 'Transactions History', route: '/Reports/TransactionsHistory', roles: P, fields: 8, buttons: 5, grids: 0 },
  { section: 'Reports', label: 'RO Customer Credit Report', route: '/Reports/RoCustomerCredit', roles: B, fields: 8, buttons: 5, grids: 0 },
  { section: 'Reports', label: 'Transaction Passbook', route: '/Reports/TransactionPassbook', roles: B, fields: 6, buttons: 5, grids: 0 },
  { section: 'Reports', label: 'Vehicle Lifecycle Report', route: '/Reports/VehicleLifecycleReport', roles: B, fields: 7, buttons: 5, grids: 0 },
  { section: 'Reports', label: 'Loyalty Report', route: '/Reports/LoyaltyReport', roles: P, fields: 4, buttons: 5, grids: 0 },
];

/** The modules one role gets, with that role's own floors applied. */
export function modulesFor(role: ModuleRole): RoleModule[] {
  return ROLE_MODULES.filter(m => m.roles.includes(role)).map(m =>
    role === 'branch' ? { ...m, ...(BRANCH_OVERRIDES[m.route] ?? {}) } : m
  );
}
