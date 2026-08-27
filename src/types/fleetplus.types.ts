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
