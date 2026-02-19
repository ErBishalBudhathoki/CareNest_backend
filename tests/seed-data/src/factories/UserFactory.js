/**
 * UserFactory - Factory for generating user entities
 * 
 * Creates users with different roles: admin, worker, client, family, manager, supervisor
 */

import EntityFactory from './EntityFactory.js';
import validationRules from '../validation/validationRules.js';

const VALID_ROLES = ['admin', 'worker', 'client', 'family', 'manager', 'supervisor'];

const ROLE_PERMISSIONS = {
  admin: [
    'users:read', 'users:write', 'users:delete',
    'clients:read', 'clients:write', 'clients:delete',
    'shifts:read', 'shifts:write', 'shifts:delete',
    'invoices:read', 'invoices:write', 'invoices:delete',
    'reports:read', 'reports:write',
    'settings:read', 'settings:write',
    'organization:manage'
  ].sort(),
  manager: [
    'users:read', 'users:write',
    'clients:read', 'clients:write',
    'shifts:read', 'shifts:write',
    'invoices:read', 'invoices:write',
    'reports:read', 'reports:write',
    'timesheets:approve',
    'expenses:approve'
  ].sort(),
  supervisor: [
    'users:read',
    'clients:read', 'clients:write',
    'shifts:read', 'shifts:write',
    'reports:read',
    'timesheets:approve',
    'workers:manage'
  ].sort(),
  worker: [
    'shifts:read',
    'clients:read',
    'timesheets:write',
    'expenses:write',
    'profile:write'
  ].sort(),
  client: [
    'profile:read', 'profile:write',
    'appointments:read',
    'invoices:read',
    'care-plan:read',
    'messages:read', 'messages:write'
  ].sort(),
  family: [
    'client:read',
    'appointments:read',
    'care-plan:read',
    'messages:read', 'messages:write',
    'tracking:read'
  ].sort()
};

class UserFactory extends EntityFactory {
  constructor() {
    super('user', validationRules.user);
  }

  /**
   * Create a user with optional overrides
   * @param {Object} overrides - Optional field overrides
   * @returns {Object} Generated user
   */
  create(overrides = {}) {
    const firstName = this.faker.person.firstName();
    const lastName = this.faker.person.lastName();
    const email = this.faker.internet.email({ firstName, lastName }).toLowerCase();
    const role = overrides.role || this._randomPick(VALID_ROLES);
    const permissions = [...(ROLE_PERMISSIONS[role] || [])];
    
    const user = {
      id: this._generateId(),
      email,
      password: this._generateSecurePassword(),
      firstName,
      lastName,
      phone: this.faker.phone.number(),
      role,
      permissions,
      isActive: this._randomBoolean(0.9),
      profileImage: this.faker.image.avatar(),
      dateOfBirth: this._randomPastDate(50),
      address: {
        street: this.faker.location.streetAddress(),
        city: this.faker.location.city(),
        state: this._randomPick(['NSW', 'VIC', 'QLD', 'SA', 'WA', 'TAS', 'NT', 'ACT']),
        postcode: this.faker.location.zipCode('####'),
        country: 'Australia'
      },
      emergencyContact: {
        name: this.faker.person.fullName(),
        relationship: this._randomPick(['spouse', 'parent', 'sibling', 'friend', 'other']),
        phone: this.faker.phone.number()
      },
      preferences: {
        language: 'en',
        timezone: 'Australia/Sydney',
        notifications: {
          email: this._randomBoolean(0.8),
          sms: this._randomBoolean(0.6),
          push: this._randomBoolean(0.9)
        }
      },
      createdAt: this._randomPastDate(2),
      updatedAt: new Date()
    };

    const merged = this._mergeOverrides(user, overrides);
    return this._markAsSeedData(merged);
  }

  /**
   * Create a user with specific role
   * @param {string} role - User role
   * @param {Object} overrides - Optional field overrides
   * @returns {Object} Generated user
   */
  createWithRole(role, overrides = {}) {
    if (!VALID_ROLES.includes(role)) {
      throw new Error(`Invalid role: ${role}. Valid roles are: ${VALID_ROLES.join(', ')}`);
    }
    return this.create({ role, ...overrides });
  }

  /**
   * Create a worker user
   * @param {Object} overrides - Optional field overrides
   * @returns {Object} Generated worker user
   */
  createWorker(overrides = {}) {
    return this.createWithRole('worker', overrides);
  }

  /**
   * Create an admin user
   * @param {Object} overrides - Optional field overrides
   * @returns {Object} Generated admin user
   */
  createAdmin(overrides = {}) {
    return this.createWithRole('admin', overrides);
  }

  /**
   * Create a client user
   * @param {Object} overrides - Optional field overrides
   * @returns {Object} Generated client user
   */
  createClient(overrides = {}) {
    return this.createWithRole('client', overrides);
  }

  /**
   * Create a family member user
   * @param {Object} overrides - Optional field overrides
   * @returns {Object} Generated family user
   */
  createFamily(overrides = {}) {
    return this.createWithRole('family', overrides);
  }

  /**
   * Create a manager user
   * @param {Object} overrides - Optional field overrides
   * @returns {Object} Generated manager user
   */
  createManager(overrides = {}) {
    return this.createWithRole('manager', overrides);
  }

  /**
   * Create a supervisor user
   * @param {Object} overrides - Optional field overrides
   * @returns {Object} Generated supervisor user
   */
  createSupervisor(overrides = {}) {
    return this.createWithRole('supervisor', overrides);
  }

  /**
   * Create users for all roles
   * @param {number} countPerRole - Number of users per role (default: 1)
   * @returns {Array} Array of users covering all roles
   */
  createAllRoles(countPerRole = 1) {
    const roles = ['admin', 'worker', 'client', 'family', 'manager', 'supervisor'];
    const users = [];

    for (const role of roles) {
      for (let i = 0; i < countPerRole; i++) {
        users.push(this.createWithRole(role));
      }
    }

    return users;
  }

  /**
   * Generate a secure password
   * @private
   * @returns {string} Secure password
   */
  _generateSecurePassword() {
    // Generate password with at least one letter and one number
    const password = this.faker.internet.password({
      length: this._randomInt(12, 20),
      memorable: false,
      pattern: /[a-zA-Z0-9]/
    });

    // Ensure it has at least one letter and one number
    if (!/[a-zA-Z]/.test(password) || !/\d/.test(password)) {
      return this._generateSecurePassword(); // Retry
    }

    return password;
  }
}

export default UserFactory;
