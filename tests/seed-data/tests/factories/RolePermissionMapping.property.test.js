import { describe, test, expect, beforeEach } from '@jest/globals';
import fc from 'fast-check';
import UserFactory from '../../src/factories/UserFactory.js';

/**
 * Property-Based Tests for Role-Permission Mapping
 * 
 * Feature: e2e-testing-seed-data
 * Property 7: Role-Permission Mapping
 * Validates: Requirements 2.2
 * 
 * Property: For any generated user with a specific role, the assigned permissions 
 * should exactly match the expected permissions for that role according to the 
 * role-permission mapping.
 */

describe('UserFactory - Role-Permission Mapping', () => {
  let userFactory;

  // Define expected permissions for each role
  const ROLE_PERMISSIONS = {
    admin: [
      'users:read', 'users:write', 'users:delete',
      'clients:read', 'clients:write', 'clients:delete',
      'shifts:read', 'shifts:write', 'shifts:delete',
      'invoices:read', 'invoices:write', 'invoices:delete',
      'reports:read', 'reports:write',
      'settings:read', 'settings:write',
      'organization:manage'
    ],
    manager: [
      'users:read', 'users:write',
      'clients:read', 'clients:write',
      'shifts:read', 'shifts:write',
      'invoices:read', 'invoices:write',
      'reports:read', 'reports:write',
      'timesheets:approve',
      'expenses:approve'
    ],
    supervisor: [
      'users:read',
      'clients:read', 'clients:write',
      'shifts:read', 'shifts:write',
      'reports:read',
      'timesheets:approve',
      'workers:manage'
    ],
    worker: [
      'shifts:read',
      'clients:read',
      'timesheets:write',
      'expenses:write',
      'profile:write'
    ],
    client: [
      'profile:read', 'profile:write',
      'appointments:read',
      'invoices:read',
      'care-plan:read',
      'messages:read', 'messages:write'
    ],
    family: [
      'client:read',
      'appointments:read',
      'care-plan:read',
      'messages:read', 'messages:write',
      'tracking:read'
    ]
  };

  beforeEach(() => {
    userFactory = new UserFactory();
  });

  /**
   * Property 7: Role-Permission Mapping
   * 
   * Each role should have exactly the permissions defined for that role
   */
  test('Property 7: generated users have correct permissions for their role', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom('admin', 'manager', 'supervisor', 'worker', 'client', 'family'),
        async (role) => {
          // Generate user with specific role
          const user = userFactory.createWithRole(role);

          // Verify role is set
          expect(user.role).toBe(role);

          // Verify permissions are set
          expect(user.permissions).toBeDefined();
          expect(Array.isArray(user.permissions)).toBe(true);

          // Get expected permissions for this role
          const expectedPermissions = ROLE_PERMISSIONS[role];
          expect(expectedPermissions).toBeDefined();

          // Verify permissions match exactly
          expect(user.permissions.length).toBe(expectedPermissions.length);
          
          // Check all expected permissions are present
          for (const permission of expectedPermissions) {
            expect(user.permissions).toContain(permission);
          }

          // Check no unexpected permissions are present
          for (const permission of user.permissions) {
            expect(expectedPermissions).toContain(permission);
          }

          // Verify permissions are sorted (for consistency)
          const sortedPermissions = [...user.permissions].sort();
          expect(user.permissions).toEqual(sortedPermissions);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 7: Admin role has most permissions
   */
  test('Property 7: admin role has comprehensive permissions', () => {
    const admin = userFactory.createWithRole('admin');
    
    expect(admin.permissions).toBeDefined();
    expect(admin.permissions.length).toBeGreaterThan(0);

    // Admin should have more permissions than other roles
    const worker = userFactory.createWithRole('worker');
    const client = userFactory.createWithRole('client');
    
    expect(admin.permissions.length).toBeGreaterThan(worker.permissions.length);
    expect(admin.permissions.length).toBeGreaterThan(client.permissions.length);

    // Admin should have organization management permission
    expect(admin.permissions).toContain('organization:manage');
  });

  /**
   * Property 7: Worker role has limited permissions
   */
  test('Property 7: worker role has appropriate limited permissions', () => {
    const worker = userFactory.createWithRole('worker');
    
    expect(worker.permissions).toBeDefined();
    expect(worker.permissions.length).toBeGreaterThan(0);

    // Worker should have read access to shifts and clients
    expect(worker.permissions).toContain('shifts:read');
    expect(worker.permissions).toContain('clients:read');

    // Worker should be able to write timesheets and expenses
    expect(worker.permissions).toContain('timesheets:write');
    expect(worker.permissions).toContain('expenses:write');

    // Worker should NOT have delete permissions
    expect(worker.permissions.some(p => p.includes(':delete'))).toBe(false);

    // Worker should NOT have organization management
    expect(worker.permissions).not.toContain('organization:manage');
  });

  /**
   * Property 7: Client role has portal-specific permissions
   */
  test('Property 7: client role has portal-specific permissions', () => {
    const client = userFactory.createWithRole('client');
    
    expect(client.permissions).toBeDefined();
    expect(client.permissions.length).toBeGreaterThan(0);

    // Client should have profile access
    expect(client.permissions).toContain('profile:read');
    expect(client.permissions).toContain('profile:write');

    // Client should have read access to their data
    expect(client.permissions).toContain('appointments:read');
    expect(client.permissions).toContain('invoices:read');
    expect(client.permissions).toContain('care-plan:read');

    // Client should have messaging permissions
    expect(client.permissions).toContain('messages:read');
    expect(client.permissions).toContain('messages:write');

    // Client should NOT have admin permissions
    expect(client.permissions.some(p => p.includes('users:'))).toBe(false);
    expect(client.permissions).not.toContain('organization:manage');
  });

  /**
   * Property 7: Manager role has approval permissions
   */
  test('Property 7: manager role has approval permissions', () => {
    const manager = userFactory.createWithRole('manager');
    
    expect(manager.permissions).toBeDefined();
    expect(manager.permissions.length).toBeGreaterThan(0);

    // Manager should have approval permissions
    expect(manager.permissions).toContain('timesheets:approve');
    expect(manager.permissions).toContain('expenses:approve');

    // Manager should have read/write access to core entities
    expect(manager.permissions).toContain('users:read');
    expect(manager.permissions).toContain('users:write');
    expect(manager.permissions).toContain('clients:read');
    expect(manager.permissions).toContain('clients:write');

    // Manager should have report access
    expect(manager.permissions).toContain('reports:read');
    expect(manager.permissions).toContain('reports:write');
  });

  /**
   * Property 7: Permissions are consistent across multiple generations
   */
  test('Property 7: permissions are consistent for same role', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom('admin', 'manager', 'supervisor', 'worker', 'client', 'family'),
        fc.integer({ min: 5, max: 15 }),
        async (role, count) => {
          // Generate multiple users with same role
          const users = [];
          for (let i = 0; i < count; i++) {
            const user = userFactory.createWithRole(role);
            users.push(user);
          }

          // All users should have identical permissions
          const firstUserPermissions = users[0].permissions.sort();
          for (let i = 1; i < users.length; i++) {
            const currentPermissions = users[i].permissions.sort();
            expect(currentPermissions).toEqual(firstUserPermissions);
          }
        }
      ),
      { numRuns: 50 }
    );
  });

  /**
   * Property 7: Permission format is consistent
   */
  test('Property 7: all permissions follow resource:action format', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom('admin', 'manager', 'supervisor', 'worker', 'client', 'family'),
        async (role) => {
          const user = userFactory.createWithRole(role);

          // Check each permission follows format
          for (const permission of user.permissions) {
            expect(typeof permission).toBe('string');
            expect(permission.length).toBeGreaterThan(0);
            
            // Should contain colon separator
            expect(permission).toContain(':');
            
            // Should have resource and action parts
            const parts = permission.split(':');
            expect(parts.length).toBe(2);
            expect(parts[0].length).toBeGreaterThan(0);
            expect(parts[1].length).toBeGreaterThan(0);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 7: No duplicate permissions
   */
  test('Property 7: users have no duplicate permissions', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom('admin', 'manager', 'supervisor', 'worker', 'client', 'family'),
        async (role) => {
          const user = userFactory.createWithRole(role);

          // Check for duplicates
          const uniquePermissions = new Set(user.permissions);
          expect(uniquePermissions.size).toBe(user.permissions.length);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 7: Hierarchical permission structure
   */
  test('Property 7: admin has superset of manager permissions', () => {
    const admin = userFactory.createWithRole('admin');
    const manager = userFactory.createWithRole('manager');

    for (const permission of manager.permissions) {
      const [resource] = permission.split(':');
      const hasEquivalent = admin.permissions.some(p => {
        return p.startsWith(resource + ':');
      });
      if (!hasEquivalent) {
        expect(['timesheets', 'expenses']).toContain(resource);
      }
    }

    expect(admin.permissions.length).toBeGreaterThanOrEqual(manager.permissions.length);
  });

  /**
   * Property 7: Role-specific permissions are mutually exclusive where appropriate
   */
  test('Property 7: client and worker have distinct permission sets', () => {
    const client = userFactory.createWithRole('client');
    const worker = userFactory.createWithRole('worker');

    // Client should not have worker-specific permissions
    expect(client.permissions).not.toContain('timesheets:write');
    expect(client.permissions).not.toContain('expenses:write');

    // Worker should not have client portal permissions
    expect(worker.permissions).not.toContain('care-plan:read');
    
    // Some permissions might overlap (like messages), but core permissions should differ
    const clientOnlyPermissions = client.permissions.filter(p => !worker.permissions.includes(p));
    const workerOnlyPermissions = worker.permissions.filter(p => !client.permissions.includes(p));
    
    expect(clientOnlyPermissions.length).toBeGreaterThan(0);
    expect(workerOnlyPermissions.length).toBeGreaterThan(0);
  });
});
