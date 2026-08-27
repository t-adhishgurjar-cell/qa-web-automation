export interface FleetPlusCredential {
  /** Territory/division the account is mapped to, from the credentials sheet. */
  region?: string;
  sno: number;
  userType: string;
  mobile: string;
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  status: string;
}

export interface LoginTestCase {
  tcId: string;
  module: string;
  scenario: string;
  steps: string;
  preConditions: string;
  testData: string;
  expectedResult: string;
  subModule: string;
  status: string;
  priority: string;
  severity: string;
  automate: string;
}

/**
 * A row from any of the Vehicle Management sheets.
 *
 * These sheets share a column layout that differs from the Login sheet: they split
 * Description and Test Steps into two columns and carry no Sub-Module, so they need
 * their own shape rather than reusing LoginTestCase.
 */
export interface VehicleTestCase {
  tcId: string;
  module: string;
  scenario: string;
  description: string;
  preConditions: string;
  steps: string;
  testData: string;
  expectedResult: string;
  status: string;
  priority: string;
  severity: string;
  automate: string;
}
