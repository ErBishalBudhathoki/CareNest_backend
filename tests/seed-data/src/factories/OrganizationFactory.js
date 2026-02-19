/**
 * OrganizationFactory - Factory for generating organization entities
 */

import EntityFactory from './EntityFactory.js';
import validationRules from '../validation/validationRules.js';

class OrganizationFactory extends EntityFactory {
  constructor() {
    super('organization', validationRules.organization);
  }

  create(overrides = {}) {
    const name = this.faker.company.name();
    
    const organization = {
      id: this._generateId(),
      name,
      email: this.faker.internet.email({ firstName: name.toLowerCase().replace(/\s+/g, ''), provider: 'example.com' }),
      phone: this.faker.phone.number(),
      address: {
        street: this.faker.location.streetAddress(),
        city: this.faker.location.city(),
        state: this._randomPick(['NSW', 'VIC', 'QLD', 'SA', 'WA', 'TAS', 'NT', 'ACT']),
        postcode: this.faker.location.zipCode('####'),
        country: 'Australia'
      },
      website: this.faker.internet.url(),
      industry: this._randomPick(['healthcare', 'disability-support', 'aged-care', 'community-services']),
      active: this._randomBoolean(0.9),
      createdAt: this._randomPastDate(2),
      updatedAt: new Date()
    };

    const merged = this._mergeOverrides(organization, overrides);
    return this._markAsSeedData(merged);
  }
}

export default OrganizationFactory;
