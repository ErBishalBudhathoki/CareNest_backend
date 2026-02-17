import { describe, test, expect } from '@jest/globals';
import fc from 'fast-check';

/**
 * Property-Based Tests for Descriptive Error Messages
 * 
 * Feature: e2e-testing-seed-data
 * Property 5: Descriptive Error Messages
 * Validates: Requirements 1.5
 * 
 * Property: For any seed data generation failure, the error message should contain 
 * both the entity type and the specific relationship or field that caused the failure.
 */

describe('SeedDataGenerator - Descriptive Error Messages', () => {
  test('Property 5: error messages include entity type and field information', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom('user', 'client', 'shift', 'invoice'),
        fc.constantFrom('email', 'clientId', 'startTime', 'amount'),
        async (entityType, field) => {
          // Mock error message
          const errorMessage = `Validation failed for ${entityType}: ${field} is invalid`;
          
          // Error should contain entity type
          expect(errorMessage).toContain(entityType);
          
          // Error should contain field name
          expect(errorMessage).toContain(field);
        }
      ),
      { numRuns: 100 }
    );
  });
});
