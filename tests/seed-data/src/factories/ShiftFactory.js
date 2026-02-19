/**
 * ShiftFactory - Factory for generating shift entities
 * 
 * Creates shifts with realistic times, durations, and assignments
 */

import EntityFactory from './EntityFactory.js';
import validationRules from '../validation/validationRules.js';

class ShiftFactory extends EntityFactory {
  constructor() {
    super('shift', validationRules.shift);
  }

  /**
   * Create a shift with optional overrides
   * @param {Object} overrides - Optional field overrides
   * @returns {Object} Generated shift
   */
  create(overrides = {}) {
    const startTime = this._generateShiftStartTime();
    const duration = this._randomPick([2, 3, 4, 6, 8, 10, 12]); // hours
    const endTime = new Date(startTime.getTime() + duration * 60 * 60 * 1000);

    const shift = {
      id: this._generateId(),
      clientId: this._generateId(),
      workerId: this._randomBoolean(0.8) ? this._generateId() : null,
      organizationId: this._generateId(),
      startTime,
      endTime,
      duration,
      status: this._randomPick(['unassigned', 'assigned', 'in-progress', 'completed', 'cancelled']),
      shiftType: this._randomPick(['regular', 'overnight', 'respite', 'emergency']),
      services: this._randomPickMultiple(
        ['personal-care', 'meal-prep', 'medication', 'transport', 'social-support', 'domestic-assistance'],
        this._randomInt(1, 4)
      ),
      location: {
        type: this._randomPick(['client-home', 'community', 'facility']),
        address: this.faker.location.streetAddress(),
        city: this.faker.location.city(),
        state: this._randomPick(['NSW', 'VIC', 'QLD', 'SA', 'WA', 'TAS', 'NT', 'ACT']),
        postcode: this.faker.location.zipCode('####')
      },
      notes: this.faker.lorem.sentence(),
      requirements: {
        qualifications: this._randomPickMultiple(
          ['first-aid', 'medication-admin', 'manual-handling', 'dementia-care'],
          this._randomInt(0, 3)
        ),
        experience: this._randomPick(['entry-level', 'intermediate', 'experienced', 'expert']),
        gender: this._randomPick(['any', 'male', 'female'])
      },
      billing: {
        hourlyRate: this._randomNumber(35, 65, 2),
        totalAmount: null,
        invoiced: false
      },
      createdAt: this._randomPastDate(1),
      updatedAt: new Date()
    };

    // Calculate total amount
    shift.billing.totalAmount = (shift.billing.hourlyRate * shift.duration).toFixed(2);

    const merged = this._mergeOverrides(shift, overrides);
    return this._markAsSeedData(merged);
  }

  /**
   * Create a shift with assigned worker
   * @param {string} workerId - Worker ID
   * @param {Object} overrides - Optional field overrides
   * @returns {Object} Generated shift
   */
  createWithWorker(workerId, overrides = {}) {
    return this.create({
      workerId,
      status: 'assigned',
      ...overrides
    });
  }

  /**
   * Create an unassigned shift
   * @param {Object} overrides - Optional field overrides
   * @returns {Object} Generated unassigned shift
   */
  createUnassigned(overrides = {}) {
    return this.create({
      workerId: null,
      status: 'unassigned',
      ...overrides
    });
  }

  /**
   * Generate realistic shift start time
   * @private
   * @returns {Date} Shift start time
   */
  _generateShiftStartTime() {
    const baseDate = this._randomDateBetween(
      new Date(),
      new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // Next 30 days
    );

    // Set to common shift start times (6am, 8am, 10am, 2pm, 6pm, 10pm)
    const startHours = this._randomPick([6, 8, 10, 14, 18, 22]);
    baseDate.setHours(startHours, 0, 0, 0);

    return baseDate;
  }
}

export default ShiftFactory;
