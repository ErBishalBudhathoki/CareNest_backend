import { describe, test, expect, beforeEach } from '@jest/globals';
import fc from 'fast-check';
import DataValidator from '../../src/validation/DataValidator.js';
import validationRules from '../../src/validation/validationRules.js';
import UserFactory from '../../src/factories/UserFactory.js';
import ClientFactory from '../../src/factories/ClientFactory.js';
import ShiftFactory from '../../src/factories/ShiftFactory.js';
import InvoiceFactory from '../../src/factories/InvoiceFactory.js';
import CarePlanFactory from '../../src/factories/CarePlanFactory.js';

/**
 * Property-Based Tests for Required Field Population
 * 
 * Feature: e2e-testing-seed-data
 * Property 32: Required Field Population
 * Validates: Requirements 10.3
 * 
 * Property: For any generated entity, all fields marked as required in the 
 * entity schema should be populated with non-null values.
 */

describe('DataValidator - Required Field Population', () => {
  let validator;
  let userFactory;
  let clientFactory;
  let shiftFactory;
  let invoiceFactory;
  let carePlanFactory;

  beforeEach(() => {
    validator = new DataValidator(validationRules);
    userFactory = new UserFactory();
    clientFactory = new ClientFactory();
    shiftFactory = new ShiftFactory();
    invoiceFactory = new InvoiceFactory();
    carePlanFactory = new CarePlanFactory();
  });

  /**
   * Helper function to check if all required fields are populated
   */
  const checkRequiredFields = (entityType, entity, rules) => {
    if (!rules || !rules.required) {
      return { allPopulated: true, missingFields: [] };
    }

    const missingFields = [];
    for (const field of rules.required) {
      const value = entity[field];
      if (value === undefined || value === null || value === '') {
        missingFields.push(field);
      }
    }

    return {
      allPopulated: missingFields.length === 0,
      missingFields
    };
  };

  /**
   * Property 32: Required Field Population for Users
   * 
   * For any generated user, all required fields (email, password, firstName, 
   * lastName, role) should be populated with non-null values.
   */
  test('Property 32: all generated users have required fields populated', async () => {
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

          // Get validation rules for user
          const rules = validationRules.user;
          expect(rules).toBeDefined();
          expect(rules.required).toBeDefined();

          // Check all required fields are populated
          const { allPopulated, missingFields } = checkRequiredFields('user', user, rules);

          // Assert all required fields are present
          expect(allPopulated).toBe(true);
          expect(missingFields).toHaveLength(0);

          // Explicitly verify each required field
          expect(user.email).toBeDefined();
          expect(user.email).not.toBeNull();
          expect(user.email).not.toBe('');

          expect(user.password).toBeDefined();
          expect(user.password).not.toBeNull();
          expect(user.password).not.toBe('');

          expect(user.firstName).toBeDefined();
          expect(user.firstName).not.toBeNull();
          expect(user.firstName).not.toBe('');

          expect(user.lastName).toBeDefined();
          expect(user.lastName).not.toBeNull();
          expect(user.lastName).not.toBe('');

          expect(user.role).toBeDefined();
          expect(user.role).not.toBeNull();
          expect(user.role).not.toBe('');
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 32: Required Field Population for Clients
   * 
   * For any generated client, all required fields (firstName, lastName, 
   * dateOfBirth, organizationId) should be populated.
   */
  test('Property 32: all generated clients have required fields populated', async () => {
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

          // Get validation rules for client
          const rules = validationRules.client;
          expect(rules).toBeDefined();
          expect(rules.required).toBeDefined();

          // Check all required fields are populated
          const { allPopulated, missingFields } = checkRequiredFields('client', client, rules);

          // Assert all required fields are present
          expect(allPopulated).toBe(true);
          expect(missingFields).toHaveLength(0);

          // Explicitly verify each required field
          expect(client.firstName).toBeDefined();
          expect(client.firstName).not.toBeNull();
          expect(client.firstName).not.toBe('');

          expect(client.lastName).toBeDefined();
          expect(client.lastName).not.toBeNull();
          expect(client.lastName).not.toBe('');

          expect(client.dateOfBirth).toBeDefined();
          expect(client.dateOfBirth).not.toBeNull();

          expect(client.organizationId).toBeDefined();
          expect(client.organizationId).not.toBeNull();
          expect(client.organizationId).not.toBe('');
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 32: Required Field Population for Shifts
   * 
   * For any generated shift, all required fields (clientId, startTime, 
   * endTime, organizationId) should be populated.
   */
  test('Property 32: all generated shifts have required fields populated', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom('unassigned', 'assigned', 'in-progress', 'completed', 'cancelled'),
        async (status) => {
          // Generate shift
          const shift = shiftFactory.create({
            status,
            clientId: 'test-client-id',
            organizationId: 'test-org-id'
          });

          // Get validation rules for shift
          const rules = validationRules.shift;
          expect(rules).toBeDefined();
          expect(rules.required).toBeDefined();

          // Check all required fields are populated
          const { allPopulated, missingFields } = checkRequiredFields('shift', shift, rules);

          // Assert all required fields are present
          expect(allPopulated).toBe(true);
          expect(missingFields).toHaveLength(0);

          // Explicitly verify each required field
          expect(shift.clientId).toBeDefined();
          expect(shift.clientId).not.toBeNull();
          expect(shift.clientId).not.toBe('');

          expect(shift.startTime).toBeDefined();
          expect(shift.startTime).not.toBeNull();

          expect(shift.endTime).toBeDefined();
          expect(shift.endTime).not.toBeNull();

          expect(shift.organizationId).toBeDefined();
          expect(shift.organizationId).not.toBeNull();
          expect(shift.organizationId).not.toBe('');
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 32: Required Field Population for Invoices
   * 
   * For any generated invoice, all required fields (clientId, organizationId, 
   * invoiceNumber, issueDate, dueDate) should be populated.
   */
  test('Property 32: all generated invoices have required fields populated', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom('draft', 'sent', 'paid', 'overdue', 'cancelled'),
        async (status) => {
          // Generate invoice
          const invoice = invoiceFactory.create({
            status,
            clientId: 'test-client-id',
            organizationId: 'test-org-id'
          });

          // Get validation rules for invoice
          const rules = validationRules.invoice;
          expect(rules).toBeDefined();
          expect(rules.required).toBeDefined();

          // Check all required fields are populated
          const { allPopulated, missingFields } = checkRequiredFields('invoice', invoice, rules);

          // Assert all required fields are present
          expect(allPopulated).toBe(true);
          expect(missingFields).toHaveLength(0);

          // Explicitly verify each required field
          expect(invoice.clientId).toBeDefined();
          expect(invoice.clientId).not.toBeNull();
          expect(invoice.clientId).not.toBe('');

          expect(invoice.organizationId).toBeDefined();
          expect(invoice.organizationId).not.toBeNull();
          expect(invoice.organizationId).not.toBe('');

          expect(invoice.invoiceNumber).toBeDefined();
          expect(invoice.invoiceNumber).not.toBeNull();
          expect(invoice.invoiceNumber).not.toBe('');

          expect(invoice.issueDate).toBeDefined();
          expect(invoice.issueDate).not.toBeNull();

          expect(invoice.dueDate).toBeDefined();
          expect(invoice.dueDate).not.toBeNull();
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 32: Required Field Population for Care Plans
   * 
   * For any generated care plan, all required fields (clientId, organizationId, 
   * startDate) should be populated.
   */
  test('Property 32: all generated care plans have required fields populated', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom('active', 'inactive', 'under-review', 'completed'),
        async (status) => {
          // Generate care plan
          const carePlan = carePlanFactory.create({
            status,
            clientId: 'test-client-id',
            organizationId: 'test-org-id'
          });

          // Get validation rules for care plan
          const rules = validationRules.carePlan;
          expect(rules).toBeDefined();
          expect(rules.required).toBeDefined();

          // Check all required fields are populated
          const { allPopulated, missingFields } = checkRequiredFields('carePlan', carePlan, rules);

          // Assert all required fields are present
          expect(allPopulated).toBe(true);
          expect(missingFields).toHaveLength(0);

          // Explicitly verify each required field
          expect(carePlan.clientId).toBeDefined();
          expect(carePlan.clientId).not.toBeNull();
          expect(carePlan.clientId).not.toBe('');

          expect(carePlan.organizationId).toBeDefined();
          expect(carePlan.organizationId).not.toBeNull();
          expect(carePlan.organizationId).not.toBe('');

          expect(carePlan.startDate).toBeDefined();
          expect(carePlan.startDate).not.toBeNull();
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 32: Batch generation maintains required field population
   * 
   * When generating multiple entities in batch, all should have required fields populated.
   */
  test('Property 32: batch generated entities have required fields populated', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 5, max: 20 }),
        async (count) => {
          // Generate batch of users
          const users = userFactory.createBatch(count, { role: 'worker' });

          // Get validation rules
          const rules = validationRules.user;
          expect(rules).toBeDefined();
          expect(rules.required).toBeDefined();

          // Check all users have required fields populated
          for (const user of users) {
            const { allPopulated, missingFields } = checkRequiredFields('user', user, rules);

            expect(allPopulated).toBe(true);
            expect(missingFields).toHaveLength(0);

            // Verify each required field
            for (const field of rules.required) {
              expect(user[field]).toBeDefined();
              expect(user[field]).not.toBeNull();
              if (typeof user[field] === 'string') {
                expect(user[field]).not.toBe('');
              }
            }
          }
        }
      ),
      { numRuns: 50 }
    );
  });
});
