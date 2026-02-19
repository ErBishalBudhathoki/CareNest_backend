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
 * Property-Based Tests for Backend Validation Compliance
 * 
 * Feature: e2e-testing-seed-data
 * Property 4: Backend Validation Compliance
 * Validates: Requirements 1.4, 10.1
 * 
 * Property: For any generated entity, when validated against the backend API 
 * validation rules, it should pass all validation checks without errors.
 */

describe('DataValidator - Backend Validation Compliance', () => {
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
   * Property 4: Backend Validation Compliance
   * 
   * For any generated entity, when validated against backend validation rules,
   * it should pass all validation checks without errors.
   */
  test('Property 4: all generated users pass backend validation', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom('admin', 'worker', 'client', 'family', 'manager', 'supervisor'),
        async (role) => {
          const user = userFactory.createWithRole(role);

          const result = validator.validate('user', user);

          expect(result.valid).toBe(true);

          expect(user.email).toBeDefined();
          expect(user.password).toBeDefined();
          expect(user.firstName).toBeDefined();
          expect(user.lastName).toBeDefined();
          expect(user.role).toBe(role);

          expect(user.email).toMatch(/^[^\s@]+@[^\s@]+\.[^\s@]+$/);

          expect(user.password.length).toBeGreaterThanOrEqual(8);
          expect(user.password).toMatch(/(?=.*[a-zA-Z])(?=.*\d)/);
        }
      ),
      { numRuns: 100 }
    );
  });

  test('Property 4: all generated clients pass backend validation', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom('active', 'pending', 'inactive', 'suspended'),
        async (ndisStatus) => {
          const client = clientFactory.create({
            organizationId: 'test-org-id',
            ndisStatus
          });

          const result = validator.validate('client', client);

          expect(result.valid).toBe(true);

          expect(client.firstName).toBeDefined();
          expect(client.lastName).toBeDefined();
          expect(client.dateOfBirth).toBeDefined();
          expect(client.organizationId).toBeDefined();

          expect(new Date(client.dateOfBirth).getTime()).toBeLessThan(new Date().getTime());

          // Verify email format if present
          if (client.email) {
            expect(client.email).toMatch(/^[^\s@]+@[^\s@]+\.[^\s@]+$/);
          }

          // Verify NDIS number format (9 digits)
          if (client.ndisNumber) {
            expect(client.ndisNumber).toMatch(/^\d{9}$/);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  test('Property 4: all generated shifts pass backend validation', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom('unassigned', 'assigned', 'in-progress', 'completed', 'cancelled'),
        async (status) => {
          // Generate shift with specified status
          const shift = shiftFactory.create({ 
            status,
            clientId: 'test-client-id',
            organizationId: 'test-org-id'
          });

          // Validate against backend rules
          const result = validator.validate('shift', shift);

          // Should pass validation
          expect(result.valid).toBe(true);
          expect(result.errors).toHaveLength(0);

          // Verify required fields
          expect(shift.clientId).toBeDefined();
          expect(shift.startTime).toBeDefined();
          expect(shift.endTime).toBeDefined();
          expect(shift.organizationId).toBeDefined();

          // Verify end time is after start time
          expect(new Date(shift.endTime).getTime()).toBeGreaterThan(new Date(shift.startTime).getTime());

          // Verify duration is within valid range
          expect(shift.duration).toBeGreaterThanOrEqual(0.5);
          expect(shift.duration).toBeLessThanOrEqual(24);

          // Verify status is valid
          expect(['unassigned', 'assigned', 'in-progress', 'completed', 'cancelled']).toContain(shift.status);
        }
      ),
      { numRuns: 100 }
    );
  });

  test('Property 4: all generated invoices pass backend validation', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom('draft', 'sent', 'paid', 'overdue', 'cancelled'),
        async (status) => {
          // Generate invoice with specified status
          const invoice = invoiceFactory.create({ 
            status,
            clientId: 'test-client-id',
            organizationId: 'test-org-id'
          });

          // Validate against backend rules
          const result = validator.validate('invoice', invoice);

          // Should pass validation
          expect(result.valid).toBe(true);
          expect(result.errors).toHaveLength(0);

          // Verify required fields
          expect(invoice.clientId).toBeDefined();
          expect(invoice.organizationId).toBeDefined();
          expect(invoice.invoiceNumber).toBeDefined();
          expect(invoice.issueDate).toBeDefined();
          expect(invoice.dueDate).toBeDefined();

          // Verify due date is on or after issue date
          expect(new Date(invoice.dueDate).getTime()).toBeGreaterThanOrEqual(new Date(invoice.issueDate).getTime());

          // Verify total amount is non-negative
          if (invoice.totalAmount !== undefined) {
            expect(invoice.totalAmount).toBeGreaterThanOrEqual(0);
          }

          // Verify status is valid
          expect(['draft', 'sent', 'paid', 'overdue', 'cancelled']).toContain(invoice.status);
        }
      ),
      { numRuns: 100 }
    );
  });

  test('Property 4: all generated care plans pass backend validation', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom('active', 'inactive', 'under-review', 'completed'),
        async (status) => {
          // Generate care plan with specified status
          const carePlan = carePlanFactory.create({ 
            status,
            clientId: 'test-client-id',
            organizationId: 'test-org-id'
          });

          // Validate against backend rules
          const result = validator.validate('carePlan', carePlan);

          // Should pass validation
          expect(result.valid).toBe(true);
          expect(result.errors).toHaveLength(0);

          // Verify required fields
          expect(carePlan.clientId).toBeDefined();
          expect(carePlan.organizationId).toBeDefined();
          expect(carePlan.startDate).toBeDefined();

          // Verify end date is after start date if present
          if (carePlan.endDate) {
            expect(new Date(carePlan.endDate).getTime()).toBeGreaterThan(new Date(carePlan.startDate).getTime());
          }

          // Verify status is valid
          expect(['active', 'inactive', 'under-review', 'completed']).toContain(carePlan.status);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Additional property test: Batch validation consistency
   * 
   * Verifies that batch validation produces the same results as individual validation
   */
  test('Property: batch validation matches individual validation results', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.constantFrom('admin', 'worker', 'client', 'family', 'manager'),
          { minLength: 5, maxLength: 20 }
        ),
        async (roles) => {
          // Generate users
          const users = roles.map(role => userFactory.createWithRole(role));

          // Validate individually
          const individualResults = users.map(user => validator.validate('user', user));

          // Validate as batch
          const batchResult = validator.validateBatch('user', users);

          // Batch result should match individual results
          expect(batchResult.results).toHaveLength(users.length);
          expect(batchResult.summary.total).toBe(users.length);

          // Each batch result should match corresponding individual result
          for (let i = 0; i < users.length; i++) {
            expect(batchResult.results[i].valid).toBe(individualResults[i].valid);
            expect(batchResult.results[i].errors).toEqual(individualResults[i].errors);
          }

          // Summary counts should be accurate
          const validCount = individualResults.filter(r => r.valid).length;
          const invalidCount = individualResults.filter(r => !r.valid).length;
          expect(batchResult.summary.valid).toBe(validCount);
          expect(batchResult.summary.invalid).toBe(invalidCount);
        }
      ),
      { numRuns: 50 }
    );
  });

  /**
   * Property test: All entity types have validation rules
   * 
   * Verifies that validation rules exist for all entity types we generate
   */
  test('Property: validation rules exist for all generated entity types', () => {
    const entityTypes = [
      'user',
      'client',
      'worker',
      'shift',
      'invoice',
      'carePlan',
      'medication',
      'incident',
      'timesheet',
      'expense',
      'complianceRecord',
      'appointment',
      'payment',
      'budget',
      'organization'
    ];

    for (const entityType of entityTypes) {
      const rules = validator.getValidationRules(entityType);
      expect(rules).toBeDefined();
      expect(rules).not.toBeNull();
      
      // Should have at least required fields or formats or ranges
      const hasRules = rules.required || rules.formats || rules.ranges || rules.customValidators;
      expect(hasRules).toBeTruthy();
    }
  });
});
