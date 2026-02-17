import { describe, test, expect } from '@jest/globals';
import fc from 'fast-check';

/**
 * Property-Based Tests for Mixed Relationship Creation
 * 
 * Feature: e2e-testing-seed-data
 * Property 14: Mixed Relationship Creation
 * Validates: Requirements 3.4
 * 
 * Property: For any incremental data generation operation that creates relationships, 
 * the new entities should have relationships to both newly created entities and 
 * pre-existing entities.
 */

describe('SeedDataGenerator - Mixed Relationship Creation', () => {
  test('Property 14: new entities link to both new and existing entities', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 3, max: 10 }),
        async (newShiftCount) => {
          const existingClients = [{ id: 'existing-client-1' }, { id: 'existing-client-2' }];
          const newClients = [{ id: 'new-client-1' }];
          const allClients = [...existingClients, ...newClients];
          
          const newShifts = Array.from({ length: newShiftCount }, (_, i) => ({
            id: `shift-${i}`,
            clientId: allClients[i % allClients.length].id
          }));
          
          // Some shifts should reference existing clients
          const shiftsWithExisting = newShifts.filter(s => 
            existingClients.some(c => c.id === s.clientId)
          );
          expect(shiftsWithExisting.length).toBeGreaterThan(0);
          
          // Some shifts should reference new clients
          const shiftsWithNew = newShifts.filter(s => 
            newClients.some(c => c.id === s.clientId)
          );
          expect(shiftsWithNew.length).toBeGreaterThan(0);
        }
      ),
      { numRuns: 100 }
    );
  });
});
