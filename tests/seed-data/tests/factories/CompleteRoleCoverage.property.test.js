import { describe, test, expect, beforeEach } from '@jest/globals';
import fc from 'fast-check';
import UserFactory from '../../src/factories/UserFactory.js';

/**
 * Property-Based Tests for Complete Role Coverage
 * 
 * Feature: e2e-testing-seed-data
 * Property 6: Complete Role Coverage
 * Validates: Requirements 2.1
 * 
 * Property: For any user generation request, the resulting set of users should 
 * include at least one user of each defined role type (admin, worker, client, 
 * family, manager).
 */

describe('UserFactory - Complete Role Coverage', () => {
  let userFactory;

  // All defined role types in the system
  const ALL_ROLES = ['admin', 'worker', 'client', 'family', 'manager', 'supervisor'];

  beforeEach(() => {
    userFactory = new UserFactory();
  });

  /**
   * Property 6: Complete Role Coverage
   * 
   * When generating users for all roles, each role should be represented
   */
  test('Property 6: user generation covers all defined roles', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: ALL_ROLES.length, max: ALL_ROLES.length * 3 }),
        async (totalUsers) => {
          // Generate users ensuring all roles are covered
          const users = [];
          const rolesGenerated = new Set();

          // First, generate one user for each role
          for (const role of ALL_ROLES) {
            const user = userFactory.createWithRole(role);
            users.push(user);
            rolesGenerated.add(user.role);
          }

          // Then generate additional random users
          const remainingCount = totalUsers - ALL_ROLES.length;
          for (let i = 0; i < remainingCount; i++) {
            const randomRole = ALL_ROLES[Math.floor(Math.random() * ALL_ROLES.length)];
            const user = userFactory.createWithRole(randomRole);
            users.push(user);
            rolesGenerated.add(user.role);
          }

          // Verify all roles are present
          expect(rolesGenerated.size).toBe(ALL_ROLES.length);
          for (const role of ALL_ROLES) {
            expect(rolesGenerated.has(role)).toBe(true);
          }

          // Verify each role has at least one user
          for (const role of ALL_ROLES) {
            const usersWithRole = users.filter(u => u.role === role);
            expect(usersWithRole.length).toBeGreaterThanOrEqual(1);
          }

          // Verify total count
          expect(users.length).toBe(totalUsers);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 6: Each role type can be generated successfully
   */
  test('Property 6: each defined role can be generated individually', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...ALL_ROLES),
        async (role) => {
          // Generate user with specific role
          const user = userFactory.createWithRole(role);

          // Verify role is set correctly
          expect(user.role).toBe(role);

          // Verify user has all required fields
          expect(user.email).toBeDefined();
          expect(user.password).toBeDefined();
          expect(user.firstName).toBeDefined();
          expect(user.lastName).toBeDefined();

          // Verify user is valid
          expect(user.id).toBeDefined();
          expect(user.createdAt).toBeDefined();
          expect(user.isSeedData).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 6: Batch generation can cover all roles
   */
  test('Property 6: batch generation can produce all role types', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 20, max: 50 }),
        async (count) => {
          // Generate batch of users with random roles
          const users = [];
          for (let i = 0; i < count; i++) {
            const role = ALL_ROLES[i % ALL_ROLES.length];
            const user = userFactory.createWithRole(role);
            users.push(user);
          }

          // Collect all roles generated
          const rolesGenerated = new Set(users.map(u => u.role));

          // All roles should be present
          expect(rolesGenerated.size).toBe(ALL_ROLES.length);
          for (const role of ALL_ROLES) {
            expect(rolesGenerated.has(role)).toBe(true);
          }

          // Each user should have a valid role
          for (const user of users) {
            expect(ALL_ROLES).toContain(user.role);
          }
        }
      ),
      { numRuns: 50 }
    );
  });

  /**
   * Property 6: Role distribution can be controlled
   */
  test('Property 6: role distribution matches generation pattern', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          admin: fc.integer({ min: 1, max: 5 }),
          worker: fc.integer({ min: 5, max: 20 }),
          client: fc.integer({ min: 3, max: 15 }),
          family: fc.integer({ min: 1, max: 10 }),
          manager: fc.integer({ min: 1, max: 5 }),
          supervisor: fc.integer({ min: 1, max: 5 })
        }),
        async (roleCounts) => {
          // Generate users according to specified counts
          const users = [];
          for (const [role, count] of Object.entries(roleCounts)) {
            for (let i = 0; i < count; i++) {
              const user = userFactory.createWithRole(role);
              users.push(user);
            }
          }

          // Verify counts match
          for (const [role, expectedCount] of Object.entries(roleCounts)) {
            const actualCount = users.filter(u => u.role === role).length;
            expect(actualCount).toBe(expectedCount);
          }

          // Verify all roles are present
          const rolesGenerated = new Set(users.map(u => u.role));
          expect(rolesGenerated.size).toBe(ALL_ROLES.length);
        }
      ),
      { numRuns: 50 }
    );
  });

  /**
   * Property 6: Factory supports all role types
   */
  test('Property 6: factory has methods for all role types', () => {
    // Verify factory has createWithRole method
    expect(typeof userFactory.createWithRole).toBe('function');

    // Verify factory can create each role type
    for (const role of ALL_ROLES) {
      const user = userFactory.createWithRole(role);
      expect(user).toBeDefined();
      expect(user.role).toBe(role);
    }
  });

  /**
   * Property 6: Role coverage is maintained across multiple generations
   */
  test('Property 6: multiple generation cycles maintain role coverage', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 3, max: 10 }),
        async (cycles) => {
          const allRolesPerCycle = [];

          // Generate users in multiple cycles
          for (let cycle = 0; cycle < cycles; cycle++) {
            const rolesInCycle = new Set();
            
            // Generate one user per role in this cycle
            for (const role of ALL_ROLES) {
              const user = userFactory.createWithRole(role);
              rolesInCycle.add(user.role);
            }

            allRolesPerCycle.push(rolesInCycle);
          }

          // Verify each cycle has all roles
          for (let i = 0; i < cycles; i++) {
            expect(allRolesPerCycle[i].size).toBe(ALL_ROLES.length);
            for (const role of ALL_ROLES) {
              expect(allRolesPerCycle[i].has(role)).toBe(true);
            }
          }
        }
      ),
      { numRuns: 50 }
    );
  });

  /**
   * Property 6: Invalid roles are rejected
   */
  test('Property 6: factory rejects invalid role types', () => {
    const invalidRoles = ['invalid', 'unknown', 'test', '', null, undefined];

    for (const invalidRole of invalidRoles) {
      expect(() => {
        userFactory.createWithRole(invalidRole);
      }).toThrow();
    }
  });

  /**
   * Property 6: Role-specific factory methods work correctly
   */
  test('Property 6: role-specific factory methods create correct roles', () => {
    // Test createWorker
    if (typeof userFactory.createWorker === 'function') {
      const worker = userFactory.createWorker();
      expect(worker.role).toBe('worker');
    }

    // Test createAdmin
    if (typeof userFactory.createAdmin === 'function') {
      const admin = userFactory.createAdmin();
      expect(admin.role).toBe('admin');
    }

    // Test createClient
    if (typeof userFactory.createClient === 'function') {
      const client = userFactory.createClient();
      expect(client.role).toBe('client');
    }
  });
});
