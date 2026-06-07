export interface FleetPlusCredential {
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
