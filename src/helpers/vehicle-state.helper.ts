import { DbHelper } from './db.helper';

/**
 * What the database says about a vehicle, for tests that change one.
 *
 * The regression sheet's vehicle cases all assert an outcome the UI only hints
 * at — "vehicle appears under Branch B. Removed from Branch A", "vehicle cannot
 * transact". A toast saying "Blocked successfully" is not that, and this
 * application has already been caught reporting success for work it did not do:
 * /Customer/ValidatePanNumber answers "message":"Success" for a PAN it rejects.
 * So the check goes to the row.
 *
 * ── Vehicle statuses, from StatusMaster ───────────────────────────────────
 *   401  Active                operational
 *   402  Admin Approved        awaiting approval
 *   403  Blocked               blocked from usage
 *   404  DeMapped              not mapped to any customer
 *   405  Failed                verification failed
 *   406  Permanent Hotlisted   blacklisted
 *   407  Temporary Hotlisted   temporarily restricted
 *   408  Vahan Verified        approved via Vahan
 *   409  Pending               awaiting Vahan verification
 *
 * ── CustomerID is a string, not a key ─────────────────────────────────────
 * VehicleDetails.CustomerID holds the customer *code* — 'NAYAFP2023400247' —
 * not CustomerMaster.Id. Joining it as an integer fails with "Conversion failed
 * when converting the varchar value 'NAYAFP2023400007' to data type int", which
 * names the value but not the mistake.
 */

export const VEHICLE_STATUS = {
  401: 'Active',
  402: 'Admin Approved',
  403: 'Blocked',
  404: 'DeMapped',
  405: 'Failed',
  406: 'Permanent Hotlisted',
  407: 'Temporary Hotlisted',
  408: 'Vahan Verified',
  409: 'Pending',
} as const;

export interface VehicleRow {
  Id: number;
  VehicleNo: string;
  CustomerID: string;
  VehicleStatus: number;
  VehicleType: string | null;
  StatusFlag: boolean;
}

/** Describes a status by name as well as number, for failure messages. */
export function describeStatus(status: number): string {
  const name = (VEHICLE_STATUS as Record<number, string>)[status];
  return name ? `${status} (${name})` : `${status} (unknown)`;
}

export async function vehicle(registration: string): Promise<VehicleRow | undefined> {
  const rows = await DbHelper.query<VehicleRow>(
    `SELECT TOP 1 Id, VehicleNo, CustomerID, VehicleStatus, VehicleType, StatusFlag
       FROM dbo.VehicleDetails WHERE VehicleNo = @registration ORDER BY Id DESC`,
    { registration }
  );
  return rows[0];
}

/**
 * Vehicles belonging to a parent customer or any of its branches.
 *
 * Branches are CustomerMaster rows carrying a ParentId, and a vehicle names its
 * owner by code, so this resolves the parent to its branch codes first.
 */
export async function vehiclesUnder(parentCustomerId: string): Promise<VehicleRow[]> {
  return DbHelper.query<VehicleRow>(
    `SELECT Id, VehicleNo, CustomerID, VehicleStatus, VehicleType, StatusFlag
       FROM dbo.VehicleDetails
      WHERE CustomerID = @parent
         OR CustomerID IN (
              SELECT CustomerId FROM dbo.CustomerMaster
               WHERE ParentId = (SELECT Id FROM dbo.CustomerMaster WHERE CustomerId = @parent))
      ORDER BY Id DESC`,
    { parent: parentCustomerId }
  );
}

/**
 * Waits for a vehicle to reach a status, or reports what it is instead.
 *
 * The screens here act asynchronously — a block posts and the grid refreshes —
 * so reading the row immediately after clicking catches the old value and
 * reports a working feature as broken. Polling makes the failure mean "it never
 * changed" rather than "it had not changed yet".
 */
export async function waitForStatus(
  registration: string,
  expected: number,
  timeoutMs = 30_000
): Promise<{ reached: boolean; actual: number | undefined }> {
  const deadline = Date.now() + timeoutMs;
  let actual: number | undefined;

  while (Date.now() < deadline) {
    actual = (await vehicle(registration))?.VehicleStatus;
    if (actual === expected) return { reached: true, actual };
    await new Promise(resolve => setTimeout(resolve, 2_000));
  }
  return { reached: false, actual };
}
