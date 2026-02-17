import { describe, test, expect, beforeEach } from '@jest/globals';
import fc from 'fast-check';
import DataValidator from '../../src/validation/DataValidator.js';
import validationRules from '../../src/validation/validationRules.js';
import UserFactory from '../../src/factories/UserFactory.js';
import ClientFactory from '../../src/factories/ClientFactory.js';

/**
 * Property-Based Tests for Format Validation
 * 
 * Feature: e2e-testing-seed-data
 * Property 34: Format Validation
 * Validates: Requirements 10.5
 * 
 * Property: For any generated user or client, the email address should match a 
 * valid email format pattern and the phone number should match a valid phone 
 * format pattern.
 */

describe('DataValidator - Format Validation', () => {
  let validator;
  let userFactory;
  let clientFactory;

  beforeEach(() => {
    validator = new DataValidator(validationRules);
    userFactory = new UserFactory();
    clientFactory = new ClientFactory();
  });

  /**
   * Email format regex pattern
   * Matches standard email format: local@domain.tld
   */
  const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  /**
   * Phone format regex patterns
   * Supports various formats: +61412345678, 0412345678, (04) 1234 5678, etc.
   */
  const PHONE_REGEX = /^[\d\s\(\)\+\-x\.]+$/;
  const PHONE_MIN_DIGITS = 7;
  const PHONE_MAX_DIGITS = 15;

  /**
   * Helper function to validate email format
   */
  const isValidEmail = (email) => {
    if (!email || typeof email !== 'string') return false;
    return EMAIL_REGEX.test(email);
  };

  /**
   * Helper function to validate phone format
   */
  const isValidPhone = (phone) => {
    if (!phone || typeof phone !== 'string') return false;
    
    // Check basic format
    if (!PHONE_REGEX.test(phone)) return false;
    
    // Count digits
    const digits = phone.replace(/\D/g, '');
    return digits.length >= PHONE_MIN_DIGITS && digits.length <= PHONE_MAX_DIGITS;
  };

  /**
   * Property 34: Format Validation for User Emails
   * 
   * All generated users should have valid email format
   */
  test('Property 34: all generated users have valid email format', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom('admin', 'worker', 'client', 'family', 'manager', 'supervisor'),
        fc.option(fc.record({
          firstName: fc.string({ minLength: 1, maxLength: 50 }),
          lastName: fc.string({ minLength: 1, maxLength: 50 })
        }), { nil: undefined }),
        async (role, overrides) => {
          // Generate user
          const user = userFactory.createWithRole(role, overrides);

          // Check email format
          expect(user.email).toBeDefined();
          expect(isValidEmail(user.email)).toBe(true);
          expect(user.email).toMatch(EMAIL_REGEX);

          // Email should not have spaces
          expect(user.email).not.toMatch(/\s/);

          // Email should have @ symbol
          expect(user.email).toContain('@');

          // Email should have domain with dot
          const parts = user.email.split('@');
          expect(parts).toHaveLength(2);
          expect(parts[1]).toContain('.');

          // Validate against rules
          const result = validator.validate('user', user);
          expect(result.valid).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 34: Format Validation for User Phone Numbers
   * 
   * All generated users with phone numbers should have valid format
   */
  test('Property 34: all generated users have valid phone format', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom('admin', 'worker', 'client', 'family', 'manager', 'supervisor'),
        async (role) => {
          // Generate user
          const user = userFactory.createWithRole(role);

          // Check phone format if present
          if (user.phone) {
            expect(isValidPhone(user.phone)).toBe(true);
            expect(user.phone).toMatch(PHONE_REGEX);

            // Count digits
            const digits = user.phone.replace(/\D/g, '');
            expect(digits.length).toBeGreaterThanOrEqual(PHONE_MIN_DIGITS);
            expect(digits.length).toBeLessThanOrEqual(PHONE_MAX_DIGITS);
          }

          // Validate against rules
          const result = validator.validate('user', user);
          expect(result.valid).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 34: Format Validation for Client Emails
   * 
   * All generated clients with emails should have valid format
   */
  test('Property 34: all generated clients have valid email format', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.option(fc.record({
          ndisStatus: fc.constantFrom('active', 'pending', 'inactive', 'suspended')
        }), { nil: undefined }),
        async (overrides) => {
          // Generate client
          const client = clientFactory.create({
            organizationId: 'test-org-id',
            ...overrides
          });

          // Check email format if present
          if (client.email) {
            expect(isValidEmail(client.email)).toBe(true);
            expect(client.email).toMatch(EMAIL_REGEX);

            // Email should not have spaces
            expect(client.email).not.toMatch(/\s/);

            // Email should have @ symbol
            expect(client.email).toContain('@');

            // Email should have domain with dot
            const parts = client.email.split('@');
            expect(parts).toHaveLength(2);
            expect(parts[1]).toContain('.');
          }

          // Validate against rules
          const result = validator.validate('client', client);
          expect(result.valid).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 34: Format Validation for Client Phone Numbers
   * 
   * All generated clients should have valid phone format
   */
  test('Property 34: all generated clients have valid phone format', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.option(fc.record({
          ndisStatus: fc.constantFrom('active', 'pending', 'inactive', 'suspended')
        }), { nil: undefined }),
        async (overrides) => {
          // Generate client
          const client = clientFactory.create({
            organizationId: 'test-org-id',
            ...overrides
          });

          // Check phone format if present
          if (client.phone) {
            expect(isValidPhone(client.phone)).toBe(true);
            expect(client.phone).toMatch(PHONE_REGEX);

            // Count digits
            const digits = client.phone.replace(/\D/g, '');
            expect(digits.length).toBeGreaterThanOrEqual(PHONE_MIN_DIGITS);
            expect(digits.length).toBeLessThanOrEqual(PHONE_MAX_DIGITS);
          }

          // Check emergency contact phone formats
          if (client.emergencyContacts && Array.isArray(client.emergencyContacts)) {
            for (const contact of client.emergencyContacts) {
              if (contact.phone) {
                expect(isValidPhone(contact.phone)).toBe(true);
                const digits = contact.phone.replace(/\D/g, '');
                expect(digits.length).toBeGreaterThanOrEqual(PHONE_MIN_DIGITS);
                expect(digits.length).toBeLessThanOrEqual(PHONE_MAX_DIGITS);
              }
            }
          }

          // Validate against rules
          const result = validator.validate('client', client);
          expect(result.valid).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 34: Format Validation for NDIS Numbers
   * 
   * NDIS numbers should be 9 digits
   */
  test('Property 34: all generated clients have valid NDIS number format', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom('active', 'pending', 'inactive', 'suspended'),
        async (ndisStatus) => {
          // Generate client
          const client = clientFactory.create({
            organizationId: 'test-org-id',
            ndisStatus
          });

          // Check NDIS number format if present
          if (client.ndisNumber) {
            // Should be exactly 9 digits
            expect(client.ndisNumber).toMatch(/^\d{9}$/);
            expect(client.ndisNumber.length).toBe(9);
            
            // Should only contain digits
            expect(client.ndisNumber).toMatch(/^\d+$/);
          }

          // Validate against rules
          const result = validator.validate('client', client);
          expect(result.valid).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 34: Batch generation maintains format compliance
   */
  test('Property 34: batch generated users maintain format compliance', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 5, max: 20 }),
        async (count) => {
          // Generate batch of users
          const users = userFactory.createBatch(count, { role: 'worker' });

          // Check all users have valid formats
          for (const user of users) {
            // Email format
            expect(isValidEmail(user.email)).toBe(true);
            expect(user.email).toMatch(EMAIL_REGEX);

            // Phone format if present
            if (user.phone) {
              expect(isValidPhone(user.phone)).toBe(true);
            }

            // Validate against rules
            const result = validator.validate('user', user);
            expect(result.valid).toBe(true);
          }
        }
      ),
      { numRuns: 50 }
    );
  });

  /**
   * Property 34: Format validation rules are defined
   */
  test('Property 34: validation rules define format patterns', () => {
    const entityTypes = ['user', 'client'];

    for (const entityType of entityTypes) {
      const rules = validator.getValidationRules(entityType);
      expect(rules).toBeDefined();
      
      if (rules.formats) {
        if (rules.formats.email) {
          expect(rules.formats.email).toBeDefined();
          expect(typeof rules.formats.email === 'string' || typeof rules.formats.email === 'object' || rules.formats.email instanceof RegExp).toBe(true);
        }

        if (rules.formats.phone) {
          expect(rules.formats.phone).toBeDefined();
          expect(typeof rules.formats.phone === 'string' || typeof rules.formats.phone === 'object' || rules.formats.phone instanceof RegExp).toBe(true);
        }
      }
    }
  });

  /**
   * Property 34: Invalid formats are rejected by validator
   */
  test('Property 34: validator rejects invalid email formats', () => {
    const invalidEmails = [
      'notanemail',
      '@example.com',
      'user@',
      'user @example.com',
      'user@example',
      '',
      null,
      undefined
    ];

    for (const invalidEmail of invalidEmails) {
      const user = userFactory.createWithRole('worker');
      user.email = invalidEmail;

      const result = validator.validate('user', user);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.field === 'email')).toBe(true);
    }
  });

  /**
   * Property 34: Invalid phone formats are rejected by validator
   */
  test('Property 34: validator rejects invalid phone formats', () => {
    const invalidPhones = [
      '123',  // Too short
      'abcdefghij',  // No digits
      '12345678901234567890',  // Too long
      '',
      null
    ];

    for (const invalidPhone of invalidPhones) {
      const user = userFactory.createWithRole('worker');
      user.phone = invalidPhone;

      const result = validator.validate('user', user);
      if (invalidPhone) {  // Only validate if phone is provided
        expect(result.valid).toBe(false);
        expect(result.errors.some(e => e.field === 'phone')).toBe(true);
      }
    }
  });
});
