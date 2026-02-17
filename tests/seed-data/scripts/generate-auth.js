#!/usr/bin/env node

import bcrypt from 'bcryptjs';
import { faker } from '@faker-js/faker';
import { MongoClient } from 'mongodb';

const MONGO_URI = 'mongodb+srv://bishalkc331:REDACTED_MONGODB_PASSWORD_2@morethaninvoicecluster.xptftb5.mongodb.net/Invoice?retryWrites=true&w=majority';

async function generateAuthUsers() {
  const client = new MongoClient(MONGO_URI);
  
  try {
    await client.connect();
    const db = client.db();
    
    console.log('Generating auth users...');
    
    const authUsers = [];
    const roles = ['admin', 'worker', 'client', 'user'];
    
    for (let i = 0; i < 50; i++) {
      const firstName = faker.person.firstName();
      const lastName = faker.person.lastName();
      const email = `test${i + 1}@carenest.dev`;
      
      authUsers.push({
        email,
        password: bcrypt.hashSync('TestPass123!', 12),
        firstName,
        lastName,
        role: faker.helpers.arrayElement(roles),
        roles: [faker.helpers.arrayElement(roles), 'user'],
        organizationId: 'test-org-001',
        organizationCode: 'TEST01',
        isActive: true,
        jobRole: faker.person.jobTitle(),
        phone: faker.phone.number('+61 4## ### ###'),
        profilePic: faker.image.avatar(),
        createdAt: new Date(),
        updatedAt: new Date(),
        isSeedData: true
      });
    }
    
    // Also create a known test user
    authUsers.push({
      email: 'test@carenest.dev',
      password: bcrypt.hashSync('TestPassword123!', 12),
      firstName: 'Test',
      lastName: 'User',
      role: 'admin',
      roles: ['admin', 'user'],
      organizationId: 'test-org-001',
      organizationCode: 'TEST01',
      isActive: true,
      jobRole: 'Administrator',
      phone: '+61 412 345 678',
      profilePic: faker.image.avatar(),
      createdAt: new Date(),
      updatedAt: new Date(),
      isSeedData: true
    });
    
    const result = await db.collection('login').insertMany(authUsers);
    console.log(`✓ Inserted ${result.insertedCount} auth users into login collection`);
    
    // List all users
    const users = await db.collection('login').find({}).limit(5).toArray();
    console.log('\nSample users:');
    users.forEach(u => console.log(`  - ${u.email} (${u.role})`));
    
  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await client.close();
  }
}

generateAuthUsers();
