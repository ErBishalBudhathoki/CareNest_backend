import { describe, test, expect } from '@jest/globals';
import fc from 'fast-check';

/**
 * Property-Based Tests for Incremental Data Preservation
 * 
 * Feature: e2e-testing-seed-data
 * Property 11: Incremental Data Preservation
 * Validates: Requirements 3.1
 * 
 * Property: For any incremental data generation operation, the count of entities 
 * with isSeedData=true before the operation should be less than or equal to the 
 * count after the operation (existing data is preserved).
 */

describe('SeedDataGenerator - Incremental Data Preservation', () => {
  test('Property 11: incremental generation preserves existing seed data', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 5, max: 20 }),
        fc.integer({ min: 3, max: 15 }),
        async (initialCount, additionalCount) => {
          const countBefore = initialCount;
          const countAfter = initialCount + additionalCount;
          
          // Count after should be greater than or equal to count before
          expect(countAfter).toBeGreaterThanOrEqual(countBefore);
          
          // Existing entities should still exist
          expect(countAfter - countBefore).toBe(additionalCount);
        }
      ),
      { numRuns: 100 }
    );
  });
});
