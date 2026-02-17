/**
 * TimesheetFactory - Factory for generating timesheet entities
 * 
 * Creates timesheets with realistic clock in/out times and break durations
 */

import EntityFactory from './EntityFactory.js';
import validationRules from '../validation/validationRules.js';

class TimesheetFactory extends EntityFactory {
  constructor() {
    super('timesheet', validationRules.timesheet);
  }

  create(overrides = {}) {
    const clockIn = this._generateClockInTime();
    const totalHours = this._randomNumber(2, 12, 2);
    const breakDuration = this._randomPick([0, 0.25, 0.5, 0.75, 1]);
    const clockOut = new Date(clockIn.getTime() + (totalHours + breakDuration) * 60 * 60 * 1000);

    const timesheet = {
      id: this._generateId(),
      workerId: this._generateId(),
      shiftId: this._generateId(),
      organizationId: this._generateId(),
      clockIn,
      clockOut,
      totalHours,
      breakDuration,
      status: this._randomPick(['pending', 'approved', 'rejected']),
      approvedBy: null,
      notes: this.faker.lorem.sentence(),
      location: {
        latitude: this.faker.location.latitude({ min: -34, max: -28 }),
        longitude: this.faker.location.longitude({ min: 150, max: 154 })
      },
      createdAt: this._randomPastDate(1),
      updatedAt: new Date(),
      isSeedData: true
    };

    const merged = this._mergeOverrides(timesheet, overrides);
    return this._markAsSeedData(merged);
  }

  createWithShift(shiftId, workerId, overrides = {}) {
    return this.create({
      shiftId,
      workerId,
      ...overrides
    });
  }

  createApproved(workerId, approverId, overrides = {}) {
    return this.create({
      workerId,
      status: 'approved',
      approvedBy: approverId,
      ...overrides
    });
  }

  _generateClockInTime() {
    const baseDate = this._randomDateBetween(
      new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
      new Date()
    );
    const startHour = this._randomPick([6, 7, 8, 9, 10, 14, 18, 22]);
    baseDate.setHours(startHour, this._randomInt(0, 59), 0, 0);
    return baseDate;
  }
}

export default TimesheetFactory;
