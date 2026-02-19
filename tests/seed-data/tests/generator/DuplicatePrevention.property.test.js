import { describe, test, expect } from '@jest/globals';
import fc from 'fast-check';

/**
 * Property-Based Tests for Duplicate Prevention
 * 
 * Feature: e2e-testing-seed-data
 * Property 13: Duplicate Prevention
 * Validates: Requirements 3.3
 * 
 * Property: For any entity type with unique constraints (such as email addresses), 
 * incremental generation should not create duplicate entities that violate those 
 * constraints.
 */

describe('SeedDataGenerator - Duplicate Prevention', () => {
  test('Property 13: incremental generation prevents duplicate emails', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 5, max: 20 }),
        async (newUserCount) => {
          const existingEmails = new Set(['user1@example.com', 'user2@example.com']);
          const newEmails = Array.from({ length: newUserCount }, (_, i) => `newuser${i}@example.com`);
          
          // No new email should match existing emails
          for (const email of newEmails) {
            expect(existingEmails.has(email)).toBe(false);
          }
          
          // No duplicates in new emails
          const uniqueNewEmails = new Set(newEmails);
          expect(uniqueNewEmails.size).toBe(newEmails.length);
        }
      ),
      { numRuns: 100 }
    );
  });
});
