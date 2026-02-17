/**
 * ExpenseFactory - Factory for generating expense entities
 * 
 * Creates expenses with realistic categories and amounts
 */

import EntityFactory from './EntityFactory.js';
import validationRules from '../validation/validationRules.js';

class ExpenseFactory extends EntityFactory {
  constructor() {
    super('expense', validationRules.expense);
  }

  create(overrides = {}) {
    const category = this._randomPick(['travel', 'meals', 'supplies', 'equipment', 'training', 'other']);
    const amount = this._generateAmountForCategory(category);

    const expense = {
      id: this._generateId(),
      workerId: this._generateId(),
      organizationId: this._generateId(),
      category,
      amount,
      date: this._randomPastDate(30),
      description: this._generateDescription(category),
      receiptUrl: this._randomBoolean(0.8) ? this.faker.image.url() : null,
      status: this._randomPick(['pending', 'approved', 'rejected', 'reimbursed']),
      approvedBy: null,
      approvedAt: null,
      notes: this.faker.lorem.sentence(),
      createdAt: this._randomPastDate(1),
      updatedAt: new Date(),
      isSeedData: true
    };

    const merged = this._mergeOverrides(expense, overrides);
    return this._markAsSeedData(merged);
  }

  createApproved(workerId, approverId, overrides = {}) {
    return this.create({
      workerId,
      status: 'approved',
      approvedBy: approverId,
      approvedAt: this._randomPastDate(1),
      ...overrides
    });
  }

  createWithReceipt(workerId, overrides = {}) {
    return this.create({
      workerId,
      receiptUrl: this.faker.image.url(),
      ...overrides
    });
  }

  _generateAmountForCategory(category) {
    const ranges = {
      travel: { min: 10, max: 500 },
      meals: { min: 10, max: 100 },
      supplies: { min: 5, max: 200 },
      equipment: { min: 50, max: 2000 },
      training: { min: 100, max: 3000 },
      other: { min: 5, max: 500 }
    };
    const range = ranges[category] || ranges.other;
    return this._randomNumber(range.min, range.max, 2);
  }

  _generateDescription(category) {
    const descriptions = {
      travel: [
        'Travel to client location',
        'Mileage reimbursement',
        'Public transport ticket',
        'Parking fee',
        'Fuel costs'
      ],
      meals: [
        'Client lunch meeting',
        'Team training lunch',
        'Work meal during overtime',
        'Client dinner'
      ],
      supplies: [
        'Office supplies',
        'Cleaning supplies',
        'Medical supplies',
        'Stationery'
      ],
      equipment: [
        'Safety equipment',
        'Work laptop accessory',
        'Communication device',
        'Protective gear'
      ],
      training: [
        'Professional development course',
        'Certification renewal',
        'Conference attendance',
        'Online training subscription'
      ],
      other: [
        'Miscellaneous expense',
        'Client activity cost',
        'Work-related expense'
      ]
    };
    const categoryDescriptions = descriptions[category] || descriptions.other;
    return this._randomPick(categoryDescriptions);
  }
}

export default ExpenseFactory;
