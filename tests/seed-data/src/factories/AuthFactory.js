/**
 * AuthFactory - Factory for generating authentication data
 * 
 * Creates users in the login collection with proper hashed passwords
 */

import bcrypt from 'bcryptjs';
import { faker } from '@faker-js/faker';
import { ObjectId } from 'mongodb';

class AuthFactory {
  constructor() {
    this.faker = faker;
  }

  create(overrides = {}) {
    const firstName = this.faker.person.firstName();
    const lastName = this.faker.person.lastName();
    const email = overrides.email || this.faker.internet.email({ firstName, lastName }).toLowerCase();
    const password = overrides.password || 'TestPass123!';
    
    const user = {
      _id: new ObjectId(),
      email,
      password: bcrypt.hashSync(password, 12),
      firstName,
      lastName,
      role: overrides.role || 'user',
      roles: overrides.roles || [overrides.role || 'user'],
      organizationId: overrides.organizationId || new ObjectId().toString(),
      organizationCode: overrides.organizationCode || this.faker.string.alphanumeric(6).toUpperCase(),
      isActive: overrides.isActive !== undefined ? overrides.isActive : true,
      jobRole: this.faker.person.jobTitle(),
      phone: this.faker.phone.number('+61 4## ### ###'),
      profilePic: this.faker.image.avatar(),
      createdAt: new Date(),
      updatedAt: new Date(),
      isSeedData: true
    };

    return user;
  }

  createAdmin(overrides = {}) {
    return this.create({
      role: 'admin',
      roles: ['admin', 'user'],
      ...overrides
    });
  }

  createWorker(overrides = {}) {
    return this.create({
      role: 'worker',
      roles: ['worker', 'user'],
      ...overrides
    });
  }

  createClient(overrides = {}) {
    return this.create({
      role: 'client',
      roles: ['client', 'user'],
      ...overrides
    });
  }

  createBatch(count, overrides = {}) {
    const users = [];
    for (let i = 0; i < count; i++) {
      users.push(this.create(overrides));
    }
    return users;
  }
}

export default AuthFactory;
