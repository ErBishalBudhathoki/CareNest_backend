import { describe, test, expect, beforeEach } from '@jest/globals';
import fc from 'fast-check';
import DataValidator from '../../src/validation/DataValidator.js';
import validationRules from '../../src/validation/validationRules.js';
import UserFactory from '../../src/factories/UserFactory.js';
import ClientFactory from '../../src/factories/ClientFactory.js';
import ShiftFactory from '../../src/factories/ShiftFactory.js';
import InvoiceFactory from '../../src/factories/InvoiceFactory.js';
import TimesheetFactory from '../../src/factories/TimesheetFactory.js';
import ExpenseFactory from '../../src/factories/ExpenseFactory.js';

/**
 * Property-Based Tests for Valid Range Compliance
 * 
 * Feature: e2e-testing-seed-data
 * Property 33: Valid Range Compliance
 * Validates: Requirements 10.4
 * 
 * Property: For any generated entity, all numeric fields should be within valid 
 * ranges and all date fields should be valid dates (not in the far past or future 
 * beyond reasonable bounds).
 */

describe('DataValidator - Valid Range Compliance', () => {
  let validator;
  let userFactory;
  let clientFactory;
  let shiftFactory;
  let invoiceFactory;
  let timesheetFactory;
  let expenseFactory;

  beforeEach(() => {
    validator = new DataValidator(validationRules);
    userFactory = new UserFactory();
    clientFactory = new ClientFactory();
    shiftFactory = new ShiftFactory();
    invoiceFactory = new InvoiceFactory();
    timesheetFactory = new TimesheetFactory();
    expenseFactory = new ExpenseFactory();
  });

  /**
   * Helper function to check if a date is within reasonable bounds
   * Reasonable bounds: between 1900 and 100 years from now
   */
  const isDateInReasonableBounds = (date) => {
    const dateObj = new Date(date);
    const minDate = new Date('1900-01-01');
    const maxDate = new Date();
    maxDate.setFullYear(maxDate.getFullYear() + 100);
    
    return dateObj >= minDate && dateObj <= maxDate && !isNaN(dateObj.getTime());
  };

  /**
   * Helper function to check numeric ranges
   */
  const checkNumericRanges = (entityType, entity, rules) => {
    if (!rules || !rules.ranges) {
      return { allValid: true, violations: [] };
    }

    const violations = [];
    for (const [field, range] of Object.entries(rules.ranges)) {
      const value = entity[field];
      if (value !== undefined && value !== null) {
        if (range.min !== undefined && value < range.min) {
          violations.push({ field, value, min: range.min, type: 'below_min' });
        }
        if (range.max !== undefined && value > range.max) {
          violations.push({ field, value, max: range.max, type: 'above_max' });
        }
      }
    }

    return {
      allValid: violations.length === 0,
      violations
    };
  };

  /**
   * Property 33: Valid Range Compliance for Shifts
   * 
   * Shift duration should be between 0.5 and 24 hours
   * Start and end times should be valid dates
   */
  test('Property 33: all generated shifts have valid duration ranges', async () => {
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

          // Check duration is within valid range (0.5 to 24 hours)
          expect(shift.duration).toBeGreaterThanOrEqual(0.5);
          expect(shift.duration).toBeLessThanOrEqual(24);

          // Check dates are valid and in reasonable bounds
          expect(isDateInReasonableBounds(shift.startTime)).toBe(true);
          expect(isDateInReasonableBounds(shift.endTime)).toBe(true);

          // Check end time is after start time
          const startDate = new Date(shift.startTime);
          const endDate = new Date(shift.endTime);
          expect(endDate.getTime()).toBeGreaterThan(startDate.getTime());

          // Validate against rules
          const result = validator.validate('shift', shift);
          expect(result.valid).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 33: Valid Range Compliance for Invoices
   * 
   * Invoice amounts should be non-negative
   * Dates should be valid and in reasonable bounds
   */
  test('Property 33: all generated invoices have valid amount ranges', async () => {
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

          // Check amounts are non-negative
          if (invoice.subtotal !== undefined) {
            expect(invoice.subtotal).toBeGreaterThanOrEqual(0);
          }
          if (invoice.tax !== undefined) {
            expect(invoice.tax).toBeGreaterThanOrEqual(0);
          }
          if (invoice.totalAmount !== undefined) {
            expect(invoice.totalAmount).toBeGreaterThanOrEqual(0);
          }

          // Check dates are valid
          expect(isDateInReasonableBounds(invoice.issueDate)).toBe(true);
          expect(isDateInReasonableBounds(invoice.dueDate)).toBe(true);

          // Check due date is on or after issue date
          const issueDate = new Date(invoice.issueDate);
          const dueDate = new Date(invoice.dueDate);
          expect(dueDate.getTime()).toBeGreaterThanOrEqual(issueDate.getTime());

          // Validate against rules
          const result = validator.validate('invoice', invoice);
          expect(result.valid).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 33: Valid Range Compliance for Timesheets
   * 
   * Total hours should be within reasonable range (0 to 24 hours)
   * Break duration should be reasonable (0 to 4 hours)
   */
  test('Property 33: all generated timesheets have valid hour ranges', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom('pending', 'approved', 'rejected'),
        async (status) => {
          // Generate timesheet
          const timesheet = timesheetFactory.create({
            status,
            workerId: 'test-worker-id',
            shiftId: 'test-shift-id',
            organizationId: 'test-org-id'
          });

          // Check total hours is within valid range
          if (timesheet.totalHours !== undefined) {
            expect(timesheet.totalHours).toBeGreaterThanOrEqual(0);
            expect(timesheet.totalHours).toBeLessThanOrEqual(24);
          }

          // Check break duration is reasonable
          if (timesheet.breakDuration !== undefined) {
            expect(timesheet.breakDuration).toBeGreaterThanOrEqual(0);
            expect(timesheet.breakDuration).toBeLessThanOrEqual(4);
          }

          // Check dates are valid
          expect(isDateInReasonableBounds(timesheet.clockIn)).toBe(true);
          if (timesheet.clockOut) {
            expect(isDateInReasonableBounds(timesheet.clockOut)).toBe(true);
            
            // Check clock out is after clock in
            const clockIn = new Date(timesheet.clockIn);
            const clockOut = new Date(timesheet.clockOut);
            expect(clockOut.getTime()).toBeGreaterThan(clockIn.getTime());
          }

          // Validate against rules
          const result = validator.validate('timesheet', timesheet);
          expect(result.valid).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 33: Valid Range Compliance for Expenses
   * 
   * Expense amounts should be positive and within reasonable range
   */
  test('Property 33: all generated expenses have valid amount ranges', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom('pending', 'approved', 'rejected', 'reimbursed'),
        async (status) => {
          // Generate expense
          const expense = expenseFactory.create({
            status,
            workerId: 'test-worker-id',
            organizationId: 'test-org-id'
          });

          // Check amount is positive and reasonable (not more than $10,000)
          expect(expense.amount).toBeGreaterThan(0);
          expect(expense.amount).toBeLessThanOrEqual(10000);

          // Check date is valid
          expect(isDateInReasonableBounds(expense.date)).toBe(true);

          // Validate against rules
          const result = validator.validate('expense', expense);
          expect(result.valid).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 33: Valid Range Compliance for Clients
   * 
   * Date of birth should be in the past and within reasonable bounds
   */
  test('Property 33: all generated clients have valid date of birth', async () => {
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

          // Check date of birth is in the past
          const dob = new Date(client.dateOfBirth);
          const now = new Date();
          expect(dob.getTime()).toBeLessThan(now.getTime());

          // Check date is within reasonable bounds (not before 1900)
          expect(isDateInReasonableBounds(client.dateOfBirth)).toBe(true);

          // Check age is reasonable (0 to 120 years)
          const age = (now - dob) / (1000 * 60 * 60 * 24 * 365.25);
          expect(age).toBeGreaterThanOrEqual(0);
          expect(age).toBeLessThanOrEqual(120);

          // Validate against rules
          const result = validator.validate('client', client);
          expect(result.valid).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 33: Batch generation maintains range compliance
   */
  test('Property 33: batch generated entities maintain range compliance', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 5, max: 20 }),
        async (count) => {
          // Generate batch of shifts
          const shifts = shiftFactory.createBatch(count, {
            clientId: 'test-client-id',
            organizationId: 'test-org-id'
          });

          // Check all shifts have valid ranges
          for (const shift of shifts) {
            expect(shift.duration).toBeGreaterThanOrEqual(0.5);
            expect(shift.duration).toBeLessThanOrEqual(24);
            expect(isDateInReasonableBounds(shift.startTime)).toBe(true);
            expect(isDateInReasonableBounds(shift.endTime)).toBe(true);

            const result = validator.validate('shift', shift);
            expect(result.valid).toBe(true);
          }
        }
      ),
      { numRuns: 50 }
    );
  });

  /**
   * Property 33: Numeric ranges are enforced by validation rules
   */
  test('Property 33: validation rules enforce numeric ranges', () => {
    const entityTypes = ['shift', 'invoice', 'timesheet', 'expense'];

    for (const entityType of entityTypes) {
      const rules = validator.getValidationRules(entityType);
      expect(rules).toBeDefined();
      
      if (rules.ranges) {
        for (const [field, range] of Object.entries(rules.ranges)) {
          const hasMinOrMax = range.min !== undefined || range.max !== undefined;
          const hasEnum = range.enum !== undefined;
          const hasLength = range.minLength !== undefined || range.maxLength !== undefined;
          
          expect(hasMinOrMax || hasEnum || hasLength).toBe(true);
          
          if (range.min !== undefined && range.max !== undefined) {
            expect(range.min).toBeLessThan(range.max);
          }
        }
      }
    }
  });
});
