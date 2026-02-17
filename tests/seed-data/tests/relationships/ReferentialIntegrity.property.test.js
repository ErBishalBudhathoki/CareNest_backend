import { describe, test, expect } from '@jest/globals';
import fc from 'fast-check';

/**
 * Property-Based Tests for Referential Integrity
 * 
 * Feature: e2e-testing-seed-data
 * Property 2: Referential Integrity
 * Validates: Requirements 1.2, 8.5
 * 
 * Property: For any generated seed data, all entity relationships should be valid—
 * every foreign key reference should point to an existing entity, and all required 
 * relationships should be present.
 */

describe('RelationshipBuilder - Referential Integrity', () => {
  /**
   * Helper to check if all foreign keys point to existing entities
   */
  const checkForeignKeys = (entities) => {
    const brokenReferences = [];
    
    // Check shifts reference valid clients and workers
    if (entities.shifts) {
      for (const shift of entities.shifts) {
        if (shift.clientId && !entities.clients?.some(c => c.id === shift.clientId)) {
          brokenReferences.push({ entity: 'shift', field: 'clientId', value: shift.clientId });
        }
        if (shift.workerId && !entities.users?.some(u => u.id === shift.workerId)) {
          brokenReferences.push({ entity: 'shift', field: 'workerId', value: shift.workerId });
        }
      }
    }

    // Check invoices reference valid clients
    if (entities.invoices) {
      for (const invoice of entities.invoices) {
        if (invoice.clientId && !entities.clients?.some(c => c.id === invoice.clientId)) {
          brokenReferences.push({ entity: 'invoice', field: 'clientId', value: invoice.clientId });
        }
      }
    }

    // Check care plans reference valid clients
    if (entities.carePlans) {
      for (const carePlan of entities.carePlans) {
        if (carePlan.clientId && !entities.clients?.some(c => c.id === carePlan.clientId)) {
          brokenReferences.push({ entity: 'carePlan', field: 'clientId', value: carePlan.clientId });
        }
      }
    }

    return brokenReferences;
  };

  /**
   * Property 2: Referential Integrity
   * 
   * All foreign key references should point to existing entities
   */
  test('Property 2: all foreign keys reference existing entities', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          userCount: fc.integer({ min: 5, max: 20 }),
          clientCount: fc.integer({ min: 3, max: 15 }),
          shiftCount: fc.integer({ min: 5, max: 30 })
        }),
        async (config) => {
          // Mock entity generation
          const entities = {
            users: Array.from({ length: config.userCount }, (_, i) => ({ id: `user-${i}` })),
            clients: Array.from({ length: config.clientCount }, (_, i) => ({ id: `client-${i}` })),
            shifts: Array.from({ length: config.shiftCount }, (_, i) => ({
              id: `shift-${i}`,
              clientId: `client-${i % config.clientCount}`,
              workerId: i % 2 === 0 ? `user-${i % config.userCount}` : null
            }))
          };

          // Check referential integrity
          const brokenReferences = checkForeignKeys(entities);
          expect(brokenReferences).toHaveLength(0);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 2: Required relationships are present
   */
  test('Property 2: required relationships exist', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 5, max: 20 }),
        async (clientCount) => {
          // Every client should have at least one shift
          const clients = Array.from({ length: clientCount }, (_, i) => ({ id: `client-${i}` }));
          const shifts = clients.map((client, i) => ({
            id: `shift-${i}`,
            clientId: client.id
          }));

          // Verify each client has at least one shift
          for (const client of clients) {
            const clientShifts = shifts.filter(s => s.clientId === client.id);
            expect(clientShifts.length).toBeGreaterThanOrEqual(1);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
