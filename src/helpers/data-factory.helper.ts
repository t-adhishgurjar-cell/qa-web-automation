import { CustomerProfile, UserCredentials, UserProfile } from '../types/user.types';

export class DataFactory {
  private static counter = 0;

  private static getUniqueId(): number {
    return ++this.counter;
  }

  /**
   * Generate a unique email address for test isolation
   */
  static generateEmail(prefix = 'user'): string {
    const id   = this.getUniqueId();
    const ts   = Date.now();
    return `${prefix}.${id}.${ts}@test.example.com`;
  }

  /**
   * Generate random strong password
   */
  static generatePassword(length = 12): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%';
    return Array.from({ length }, () =>
      chars.charAt(Math.floor(Math.random() * chars.length))
    ).join('');
  }

  /**
   * Create a standard test user
   */
  static createUser(overrides: Partial<UserProfile> = {}): UserProfile {
    const id = this.getUniqueId();
    return {
      id:        `test-user-${id}`,
      username:  `testuser${id}`,
      email:     this.generateEmail('testuser'),
      firstName: 'Test',
      lastName:  `User${id}`,
      role:      'user',
      ...overrides,
    };
  }

  /**
   * Create admin test user
   */
  static createAdmin(overrides: Partial<UserProfile> = {}): UserProfile {
    return this.createUser({ role: 'admin', ...overrides });
  }

  static createCustomer(overrides: Partial<CustomerProfile> = {}): CustomerProfile {
    const id = this.getUniqueId();
    return {
      firstName: 'Test',
      lastName:  `Customer${id}`,
      email:     this.generateEmail('customer'),
      company:   `Test Company ${id}`,
      phone:     '9876543210',
      country:   'India',
      ...overrides,
    };
  }

  /**
   * Get valid credentials from environment
   */
  static getValidCredentials(): UserCredentials {
    return {
      username: process.env.TEST_USERNAME ?? 'testuser@example.com',
      password: process.env.TEST_PASSWORD ?? 'P@ssw0rd!',
    };
  }

  /**
   * Get invalid credentials for negative testing
   */
  static getInvalidCredentials(): UserCredentials {
    return {
      username: 'invalid@example.com',
      password: 'wrongpassword',
    };
  }
}
