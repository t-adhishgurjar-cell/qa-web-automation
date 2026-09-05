import { DbHelper } from './db.helper';

/**
 * Database snapshots for the UserType × CustomerType matrix.
 *
 * The matrix defines each of its 117 cells as a *precondition on database state*
 * — "mobile already in CustomerMaster as Fleet", "mobile already an RO user" —
 * and then asserts an outcome. A UI test alone can only observe the outcome; it
 * cannot show the precondition was ever true, and it cannot prove that a blocked
 * attempt created nothing.
 *
 * So a test captures everything the stored procedure looks at, before and after
 * acting, and attaches both to the report. That turns "the app showed an error"
 * into "the mobile was in CustomerMaster as Fleet, the attempt was refused, and
 * no row was added to Users" — which is the actual test case.
 *
 * Read-only throughout: DbHelper refuses to send anything but a SELECT.
 */

export interface CustomerRecord {
  customerId: string;
  mobile: string;
  customerTypeCode: number;
  status: number;
  statusFlag: boolean;
  customerName: string;
  createdOn: string;
}

export interface UserRecord {
  userId: number;
  userName: string;
  mobile: string;
  userTypeCode: string;
  isActive: boolean;
  isSystemUser: boolean;
  isParentUser: boolean;
  firstName: string;
  createdOn: string;
}

export interface RoRecord {
  roCode: string;
  mobile: string;
  roStatus: number;
  statusFlag: boolean;
}

/** A submitted-but-unapproved application, which lives in a staging table. */
export interface PendingApplication {
  referenceNo: string;
  mobile: string;
  customerType: number;
  status: number;
  customerName: string;
}

export interface MobileSnapshot {
  mobile: string;
  takenAt: string;
  customers: CustomerRecord[];
  pendingApplications: PendingApplication[];
  users: UserRecord[];
  retailOutlets: RoRecord[];
}

/**
 * Customer statuses, from dbo.StatusMaster where EntityTypeId = 1.
 *
 * Worth having by name rather than number: 107 is not "awaiting approval" as
 * its position in the flow suggests, and reading it that way sent an earlier
 * test looking for a checker account it did not need.
 */
export const CUSTOMER_STATUS: Record<number, string> = {
  101: 'Active',
  102: 'Pending for Review',
  103: 'Draft',
  104: 'Inactive',
  105: 'Pending for Approval',
  106: 'Rejected',
  107: 'Consent Pending',
  108: 'Branch Pending for Approval',
  109: 'Pending for Correction',
};

/** Retail outlet statuses, EntityTypeId = 2. 201 is the one the RO check reads. */
export const RO_STATUS: Record<number, string> = {
  201: 'Active', 202: 'Approved', 203: 'Inactive', 204: 'Pending', 205: 'Rejected',
};

/**
 * The customer statuses the procedure's CustomerMaster check accepts.
 *
 * 101 is Active, which is expected. **104 is Inactive** — an entity someone has
 * deliberately disabled — and it blocks user creation just as firmly. So a
 * customer can be switched off and still hold its mobile hostage forever. That
 * is what the code does; whether it is what anyone intended is worth asking,
 * and it is the subject of edge case TC-UAM-EC-006.
 *
 * Notably absent: 105 Pending for Approval and 107 Consent Pending. An
 * application still working its way through onboarding blocks nothing.
 */
export const BLOCKING_CUSTOMER_STATUSES: readonly number[] = [101, 104];

/** The OD customer type, which the CustomerMaster check deliberately excludes. */
export const OD_CUSTOMER_TYPE_CODE = 1004;

/**
 * Where an application lives before it becomes a customer.
 *
 * Onboarding through the UI writes here at status 107 — **Consent Pending**,
 * "awaiting customer consent and OTP on onboarding form". Not, as the name
 * RawCustomerMaster invites you to assume, waiting for a checker: that is 105,
 * a later state the record has not reached yet. The OTP the wizard collects
 * verifies the mobile, and is a different thing from the consent this status
 * is waiting on.
 *
 * Either way it does not arm the CustomerMaster check, whose columns describe
 * customers at 101 or 104. A test that onboards a customer and expects the
 * block to follow will find nothing blocked.
 */
export const PENDING_APPLICATION_TABLE = 'RawCustomerMaster';
export const PENDING_APPLICATION_STATUS = 107;

/**
 * The codes whose existing mobile blocks any new user, per @TypeCodeRules in
 * usp_AddUser. Notably absent: CUSTOMER_ADMIN and BRANCH_ADMIN, which together
 * account for 83% of all users.
 */
export const BLOCKS_MOBILE_REUSE: readonly string[] = [
  'FP_ADMIN', 'HO_ADMIN', 'HO', 'REGION_ADMIN', 'STATE_ADMIN',
  'DIVISION_ADMIN', 'TERRITORY_ADMIN', 'OTHER_NAYARA', 'OTHER_NON', 'RO', 'OTHER_RO',
];

export class MatrixDb {
  /** Everything usp_AddUser inspects for one mobile number. */
  static async snapshot(mobile: string): Promise<MobileSnapshot> {
    const customers = await DbHelper.query<CustomerRecord>(
      `SELECT cm.CustomerId AS customerId, cm.MobileNo AS mobile,
              ctm.CustomerTypeCode AS customerTypeCode, cm.Status AS status,
              cm.StatusFlag AS statusFlag, ISNULL(cm.CustomerName, '') AS customerName,
              CONVERT(varchar(19), cm.CreatedOn, 126) AS createdOn
         FROM dbo.CustomerMaster cm
         LEFT JOIN dbo.CustomerTypeMaster ctm ON ctm.Id = cm.CustomerType
        WHERE cm.MobileNo = @mobile
        ORDER BY cm.CustomerId`,
      { mobile }
    );

    const users = await DbHelper.query<UserRecord>(
      `SELECT u.Id AS userId, u.UserName AS userName, u.MobileNumber AS mobile,
              ut.Code AS userTypeCode, u.IsActive AS isActive,
              u.IsSystemUser AS isSystemUser, u.IsParentUser AS isParentUser,
              ISNULL(up.FirstName, '') AS firstName,
              CONVERT(varchar(19), u.CreatedOn, 126) AS createdOn
         FROM dbo.Users u
         JOIN dbo.UserTypesMaster ut ON ut.Id = u.UserTypeId
         LEFT JOIN dbo.UserProfiles up ON up.UserId = u.Id
        WHERE u.MobileNumber = @mobile OR u.UserName = @mobile
        ORDER BY u.Id`,
      { mobile }
    );

    const pendingApplications = await DbHelper.query<PendingApplication>(
      `SELECT raw.ReferenceNo AS referenceNo, raw.MobileNo AS mobile,
              raw.CustomerType AS customerType, raw.Status AS status,
              ISNULL(raw.CustomerName, '') AS customerName
         FROM dbo.RawCustomerMaster raw
        WHERE raw.MobileNo = @mobile`,
      { mobile }
    );

    const retailOutlets = await DbHelper.query<RoRecord>(
      `SELECT ro.ROCode AS roCode, ro.MobileNo AS mobile,
              ro.ROStatus AS roStatus, ro.StatusFlag AS statusFlag
         FROM dbo.ROMaster ro
        WHERE ro.MobileNo = @mobile OR ro.MobileNo1 = @mobile`,
      { mobile }
    );

    const [{ now }] = await DbHelper.query<{ now: string }>(
      `SELECT CONVERT(varchar(19), GETDATE(), 126) AS now`
    );

    return { mobile, takenAt: now, customers, pendingApplications, users, retailOutlets };
  }

  /**
   * Which of the procedure's three checks this state would trip, and why.
   *
   * Derived from the snapshot rather than from the outcome, so the report shows
   * what *should* happen independently of what did — the only way a mismatch
   * between the two becomes visible.
   */
  static predictedBlocks(snapshot: MobileSnapshot): string[] {
    const reasons: string[] = [];

    const nonOd = snapshot.customers.filter(
      c =>
        c.statusFlag &&
        BLOCKING_CUSTOMER_STATUSES.includes(c.status) &&
        c.customerTypeCode !== OD_CUSTOMER_TYPE_CODE
    );
    if (nonOd.length) {
      reasons.push(
        `Check 1 (CustomerMaster non-OD): ` +
          nonOd.map(c => `${c.customerId} type=${c.customerTypeCode} status=${c.status}`).join('; ')
      );
    }

    const activeRo = snapshot.retailOutlets.filter(r => r.statusFlag && r.roStatus === 201);
    if (activeRo.length) {
      reasons.push(`Check 2 (ROMaster active): ${activeRo.map(r => r.roCode).join(', ')}`);
    }

    const blocking = snapshot.users.filter(
      u => u.mobile === snapshot.mobile && BLOCKS_MOBILE_REUSE.includes(u.userTypeCode)
    );
    if (blocking.length) {
      reasons.push(
        `Check 3 (Users blocking type): ` +
          blocking.map(u => `${u.userId}/${u.userTypeCode}`).join(', ')
      );
    }

    return reasons;
  }

  /** A snapshot rendered for an Allure attachment. */
  static format(label: string, snapshot: MobileSnapshot): string {
    const lines: string[] = [
      label,
      `mobile   : ${snapshot.mobile}`,
      `taken at : ${snapshot.takenAt} (server time)`,
      '',
      `CustomerMaster — ${snapshot.customers.length} row(s)`,
    ];

    if (!snapshot.customers.length) lines.push('  (none)');
    snapshot.customers.forEach(c =>
      lines.push(
        `  ${c.customerId}  type=${c.customerTypeCode}  ` +
          `status=${c.status} (${CUSTOMER_STATUS[c.status] ?? 'unknown'})  ` +
          `statusFlag=${c.statusFlag}  "${c.customerName}"  created=${c.createdOn}`
      )
    );

    lines.push(
      '',
      `RawCustomerMaster (onboarding in progress) — ${snapshot.pendingApplications.length} row(s)`
    );
    if (!snapshot.pendingApplications.length) lines.push('  (none)');
    snapshot.pendingApplications.forEach(a =>
      lines.push(
        `  ref=${a.referenceNo}  type=${a.customerType}  ` +
          `status=${a.status} (${CUSTOMER_STATUS[a.status] ?? 'unknown'})  "${a.customerName}"` +
          (BLOCKING_CUSTOMER_STATUSES.includes(a.status)
            ? ''
            : '   <- does not arm the CustomerMaster check')
      )
    );

    lines.push('', `Users — ${snapshot.users.length} row(s)`);
    if (!snapshot.users.length) lines.push('  (none)');
    snapshot.users.forEach(u =>
      lines.push(
        `  id=${u.userId}  userName=${u.userName}  mobile=${u.mobile}  ${u.userTypeCode}  ` +
          `active=${u.isActive} system=${u.isSystemUser} parent=${u.isParentUser}  ` +
          `"${u.firstName.trim()}"  created=${u.createdOn}`
      )
    );

    lines.push('', `ROMaster — ${snapshot.retailOutlets.length} row(s)`);
    if (!snapshot.retailOutlets.length) lines.push('  (none)');
    snapshot.retailOutlets.forEach(r =>
      lines.push(
        `  ${r.roCode}  roStatus=${r.roStatus} (${RO_STATUS[r.roStatus] ?? 'unknown'})  ` +
          `statusFlag=${r.statusFlag}`
      )
    );

    const predicted = this.predictedBlocks(snapshot);
    lines.push('', 'usp_AddUser would block on:');
    lines.push(predicted.length ? predicted.map(p => `  ${p}`).join('\n') : '  nothing — creation allowed');

    return lines.join('\n');
  }

  /** What changed between two snapshots, for the report. */
  static diff(before: MobileSnapshot, after: MobileSnapshot): string {
    const beforeCustomers = new Set(before.customers.map(c => c.customerId));
    const beforeUsers = new Set(before.users.map(u => u.userId));
    const afterCustomers = new Set(after.customers.map(c => c.customerId));
    const afterUsers = new Set(after.users.map(u => u.userId));

    const newCustomers = after.customers.filter(c => !beforeCustomers.has(c.customerId));
    const newUsers = after.users.filter(u => !beforeUsers.has(u.userId));
    const goneCustomers = before.customers.filter(c => !afterCustomers.has(c.customerId));
    const goneUsers = before.users.filter(u => !afterUsers.has(u.userId));

    const lines = [
      `CustomerMaster    : ${before.customers.length} -> ${after.customers.length}`,
      `RawCustomerMaster : ${before.pendingApplications.length} -> ${after.pendingApplications.length}`,
      `Users             : ${before.users.length} -> ${after.users.length}`,
      `ROMaster          : ${before.retailOutlets.length} -> ${after.retailOutlets.length}`,
      '',
    ];

    after.pendingApplications
      .filter(a => !before.pendingApplications.some(b => b.referenceNo === a.referenceNo))
      .forEach(a => lines.push(`  + application ref=${a.referenceNo} status=${a.status} "${a.customerName}"`));

    newCustomers.forEach(c =>
      lines.push(`  + customer ${c.customerId} type=${c.customerTypeCode} status=${c.status} "${c.customerName}"`)
    );
    newUsers.forEach(u => lines.push(`  + user id=${u.userId} ${u.userTypeCode} "${u.firstName.trim()}"`));
    goneCustomers.forEach(c => lines.push(`  - customer ${c.customerId}`));
    goneUsers.forEach(u => lines.push(`  - user id=${u.userId}`));

    const pendingAdded =
      after.pendingApplications.length !== before.pendingApplications.length;
    if (!newCustomers.length && !newUsers.length && !goneCustomers.length &&
        !goneUsers.length && !pendingAdded) {
      lines.push('  no rows added or removed');
    }

    return lines.join('\n');
  }
}
