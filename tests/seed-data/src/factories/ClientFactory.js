/**
 * ClientFactory - Factory for generating client entities
 * 
 * Creates clients with NDIS numbers, care requirements, and emergency contacts
 */

import EntityFactory from './EntityFactory.js';
import validationRules from '../validation/validationRules.js';

class ClientFactory extends EntityFactory {
  constructor() {
    super('client', validationRules.client);
  }

  /**
   * Create a client with optional overrides
   * @param {Object} overrides - Optional field overrides
   * @returns {Object} Generated client
   */
  create(overrides = {}) {
    const firstName = this.faker.person.firstName();
    const lastName = this.faker.person.lastName();
    const dateOfBirth = this._randomDateBetween(
      new Date('1930-01-01'),
      new Date('2010-12-31')
    );

    const client = {
      id: this._generateId(),
      firstName,
      lastName,
      email: this.faker.internet.email({ firstName, lastName }).toLowerCase(),
      phone: this.faker.phone.number(),
      dateOfBirth,
      gender: this._randomPick(['male', 'female', 'other', 'prefer-not-to-say']),
      ndisNumber: this._generateNDISNumber(),
      ndisStatus: this._randomPick(['active', 'pending', 'inactive', 'suspended']),
      address: {
        street: this.faker.location.streetAddress(),
        city: this.faker.location.city(),
        state: this._randomPick(['NSW', 'VIC', 'QLD', 'SA', 'WA', 'TAS', 'NT', 'ACT']),
        postcode: this.faker.location.zipCode('####'),
        country: 'Australia'
      },
      emergencyContact: {
        name: this.faker.person.fullName(),
        relationship: this._randomPick(['parent', 'guardian', 'spouse', 'sibling', 'friend']),
        phone: this.faker.phone.number(),
        email: this.faker.internet.email()
      },
      careRequirements: {
        mobilitySupport: this._randomBoolean(0.6),
        medicationManagement: this._randomBoolean(0.5),
        personalCare: this._randomBoolean(0.7),
        mealPreparation: this._randomBoolean(0.8),
        transportation: this._randomBoolean(0.6),
        socialSupport: this._randomBoolean(0.9)
      },
      medicalInfo: {
        allergies: this._randomPickMultiple(
          ['penicillin', 'peanuts', 'latex', 'shellfish', 'none'],
          this._randomInt(0, 2)
        ),
        conditions: this._randomPickMultiple(
          ['diabetes', 'hypertension', 'asthma', 'epilepsy', 'none'],
          this._randomInt(0, 3)
        ),
        medications: []
      },
      preferences: {
        language: this._randomPick(['English', 'Mandarin', 'Arabic', 'Vietnamese', 'Greek']),
        culturalConsiderations: this.faker.lorem.sentence(),
        dietaryRequirements: this._randomPickMultiple(
          ['vegetarian', 'vegan', 'halal', 'kosher', 'gluten-free', 'none'],
          this._randomInt(0, 2)
        )
      },
      status: this._randomPick(['active', 'inactive', 'on-hold']),
      organizationId: this._generateId(),
      createdAt: this._randomPastDate(3),
      updatedAt: new Date()
    };

    const merged = this._mergeOverrides(client, overrides);
    return this._markAsSeedData(merged);
  }

  /**
   * Generate a realistic NDIS number (9 digits)
   * @private
   * @returns {string} NDIS number
   */
  _generateNDISNumber() {
    return this.faker.string.numeric(9);
  }
}

export default ClientFactory;
