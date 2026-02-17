import { describe, test, expect, beforeEach } from '@jest/globals';
import fc from 'fast-check';
import UserFactory from '../../src/factories/UserFactory.js';

/**
 * Property-Based Tests for Credential Generation
 * 
 * Feature: e2e-testing-seed-data
 * Property 8: Credential Generation
 * Validates: Requirements 2.3
 * 
 * Property: For any generated user, there should be associated authentication 
 * credentials (password hash or token) stored in the system.
 */

describe('UserFactory - Credential Generation', () => {
  let userFactory;

  beforeEach(() => {
    userFactory = new UserFactory();
  });

  /**
   * Property 8: Credential Generation
   * 
   * All generated users should have authentication credentials
   */
  test('Property 8: all generated users have authentication credentials', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom('admin', 'worker', 'client', 'family', 'manager', 'supervisor'),
        async (role) => {
          // Generate user
          const user = userFactory.createWithRole(role);

          // Verify password is generated
          expect(user.password).toBeDefined();
          expect(user.password).not.toBeNull();
          expect(typeof user.password).toBe('string');
          expect(user.password.length).toBeGreaterThan(0);

          // Password should meet minimum requirements
          expect(user.password.length).toBeGreaterThanOrEqual(8);
          
          // Password should contain letters and numbers
          expect(user.password).toMatch(/[a-zA-Z]/);
          expect(user.password).toMatch(/\d/);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 8: Credentials are unique per user
   */
  test('Property 8: each user has unique credentials', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 10, max: 30 }),
        async (count) => {
          // Generate multiple users
          const users = [];
          for (let i = 0; i < count; i++) {
            const user = userFactory.createWithRole('worker');
            users.push(user);
          }

          // Collect all passwords
          const passwords = users.map(u => u.password);
          const uniquePasswords = new Set(passwords);

          // All passwords should be unique
          expect(uniquePasswords.size).toBe(passwords.length);
        }
      ),
      { numRuns: 50 }
    );
  });

  /**
   * Property 8: Credentials are retrievable
   */
  test('Property 8: credentials can be retrieved from user object', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom('admin', 'worker', 'client', 'family', 'manager', 'supervisor'),
        async (role) => {
          const user = userFactory.createWithRole(role);

          // Credentials should be accessible
          const credentials = {
            email: user.email,
            password: user.password
          };

          expect(credentials.email).toBeDefined();
          expect(credentials.password).toBeDefined();
          expect(typeof credentials.email).toBe('string');
          expect(typeof credentials.password).toBe('string');
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 8: Password complexity requirements
   */
  test('Property 8: generated passwords meet complexity requirements', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom('admin', 'worker', 'client', 'family', 'manager', 'supervisor'),
        async (role) => {
          const user = userFactory.createWithRole(role);

          // Minimum length
          expect(user.password.length).toBeGreaterThanOrEqual(8);

          // Contains at least one letter
          expect(/[a-zA-Z]/.test(user.password)).toBe(true);

          // Contains at least one number
          expect(/\d/.test(user.password)).toBe(true);

          // No spaces
          expect(user.password).not.toMatch(/\s/);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 8: Batch generation maintains credential uniqueness
   */
  test('Property 8: batch generated users have unique credentials', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 5, max: 20 }),
        async (count) => {
          const users = userFactory.createBatch(count, { role: 'worker' });

          // All emails should be unique
          const emails = users.map(u => u.email);
          const uniqueEmails = new Set(emails);
          expect(uniqueEmails.size).toBe(emails.length);

          // All passwords should be unique
          const passwords = users.map(u => u.password);
          const uniquePasswords = new Set(passwords);
          expect(uniquePasswords.size).toBe(passwords.length);
        }
      ),
      { numRuns: 50 }
    );
  });
});
