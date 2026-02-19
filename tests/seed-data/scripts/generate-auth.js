#!/usr/bin/env node 

import bcrypt from 'bcryptjs';
import { faker } from '@faker-js/faker';
import { MongoClient } from 'mongodb';

const MONGO_URI = process.env.MONGODB_URI || process.env.TEST_MONGODB_URI || 'mongodb://localhost:27017/invoice_test';

async function generateSeedData() {
  const client = new MongoClient(MONGO_URI);
  
  try {
    await client.connect();
    const db = client.db();
    
    console.log('Generating comprehensive seed data...\n');
    
    // Clear existing seed data
    console.log('Clearing existing seed data...');
    await db.collection('login').deleteMany({ isSeedData: true });
    await db.collection('users').deleteMany({ isSeedData: true });
    console.log('✓ Cleared existing seed data');
    
    // Define organizations
    const orgs = [
      { id: '697f1fd6191a1decde9344e9', code: 'DEV01', name: 'CareNest Development' },
      { id: 'org-care-001', code: 'CARE01', name: 'Sunshine Disability Services' },
      { id: 'org-ndis-001', code: 'NDIS01', name: 'NDIS Support Solutions' },
      { id: 'org-aged-001', code: 'AGED01', name: 'Aged Care Plus' }
    ];

    const allLoginUsers = [];
    const allProfileUsers = [];
    
    // Generate users for each organization
    for (const org of orgs) {
      console.log(`Generating users for ${org.name}...`);
      
      // === 1 ADMIN (Organization Owner) ===
      const adminEmail = `admin@${org.code.toLowerCase()}.app`;
      allLoginUsers.push({
        email: adminEmail,
        password: bcrypt.hashSync('Admin123!', 12),
        firstName: faker.person.firstName(),
        lastName: faker.person.lastName(),
        role: 'admin',
        roles: ['admin', 'user'],
        organizationId: org.id,
        organizationCode: org.code,
        isActive: true,
        jobRole: 'Organization Administrator',
        phone: faker.phone.number('+61 4## ### ###'),
        profilePic: faker.image.avatar(),
        createdAt: new Date(),
        updatedAt: new Date(),
        isSeedData: true
      });
      allProfileUsers.push({
        email: adminEmail,
        firstName: allLoginUsers[allLoginUsers.length - 1].firstName,
        lastName: allLoginUsers[allLoginUsers.length - 1].lastName,
        role: 'admin',
        roles: ['admin', 'user'],
        organizationId: org.id,
        organizationCode: org.code,
        isActive: true,
        jobRole: 'Organization Administrator',
        phone: faker.phone.number('+61 4## ### ###'),
        profilePic: faker.image.avatar(),
        createdAt: new Date(),
        updatedAt: new Date(),
        isSeedData: true
      });

      // === 5 WORKERS (Employees) ===
      for (let w = 0; w < 5; w++) {
        const firstName = faker.person.firstName();
        const lastName = faker.person.lastName();
        const workerEmail = `worker${w + 1}@${org.code.toLowerCase()}.app`;
        
        allLoginUsers.push({
          email: workerEmail,
          password: bcrypt.hashSync('Worker123!', 12),
          firstName,
          lastName,
          role: 'worker',
          roles: ['worker', 'user'],
          organizationId: org.id,
          organizationCode: org.code,
          isActive: true,
          jobRole: faker.helpers.arrayElement(['Support Worker', 'Care Worker', 'Team Leader', 'Coordinator', 'Case Manager']),
          phone: faker.phone.number('+61 4## ### ###'),
          profilePic: faker.image.avatar(),
          createdAt: new Date(),
          updatedAt: new Date(),
          isSeedData: true
        });
        allProfileUsers.push({
          email: workerEmail,
          firstName,
          lastName,
          role: 'worker',
          roles: ['worker', 'user'],
          organizationId: org.id,
          organizationCode: org.code,
          isActive: true,
          jobRole: allLoginUsers[allLoginUsers.length - 1].jobRole,
          phone: faker.phone.number('+61 4## ### ###'),
          profilePic: faker.image.avatar(),
          createdAt: new Date(),
          updatedAt: new Date(),
          isSeedData: true
        });
      }

      // === 10 CLIENTS ===
      for (let c = 0; c < 10; c++) {
        const firstName = faker.person.firstName();
        const lastName = faker.person.lastName();
        const clientEmail = `client${c + 1}@${org.code.toLowerCase()}.app`;
        
        allLoginUsers.push({
          email: clientEmail,
          password: bcrypt.hashSync('Client123!', 12),
          firstName,
          lastName,
          role: 'client',
          roles: ['client', 'user'],
          organizationId: org.id,
          organizationCode: org.code,
          isActive: true,
          jobRole: 'Client',
          phone: faker.phone.number('+61 4## ### ###'),
          profilePic: faker.image.avatar(),
          ndisNumber: c < 5 ? `9${faker.string.numeric(8)}` : null,
          createdAt: new Date(),
          updatedAt: new Date(),
          isSeedData: true
        });
        allProfileUsers.push({
          email: clientEmail,
          firstName,
          lastName,
          role: 'client',
          roles: ['client', 'user'],
          organizationId: org.id,
          organizationCode: org.code,
          isActive: true,
          jobRole: 'Client',
          phone: faker.phone.number('+61 4## ### ###'),
          profilePic: faker.image.avatar(),
          ndisNumber: c < 5 ? `9${faker.string.numeric(8)}` : null,
          address: {
            street: faker.location.streetAddress(),
            city: faker.location.city(),
            state: faker.helpers.arrayElement(['NSW', 'VIC', 'QLD', 'SA', 'WA']),
            postcode: faker.location.zipCode('####'),
            country: 'Australia'
          },
          createdAt: new Date(),
          updatedAt: new Date(),
          isSeedData: true
        });
      }

      // === FAMILY CONTACTS (for clients) ===
      for (let f = 0; f < 3; f++) {
        const firstName = faker.person.firstName();
        const lastName = faker.person.lastName();
        const familyEmail = `family${f + 1}@${org.code.toLowerCase()}.app`;
        
        allLoginUsers.push({
          email: familyEmail,
          password: bcrypt.hashSync('Family123!', 12),
          firstName,
          lastName,
          role: 'family',
          roles: ['family', 'user'],
          organizationId: org.id,
          organizationCode: org.code,
          isActive: true,
          jobRole: 'Family Contact',
          phone: faker.phone.number('+61 4## ### ###'),
          profilePic: faker.image.avatar(),
          createdAt: new Date(),
          updatedAt: new Date(),
          isSeedData: true
        });
        allProfileUsers.push({
          email: familyEmail,
          firstName,
          lastName,
          role: 'family',
          roles: ['family', 'user'],
          organizationId: org.id,
          organizationCode: org.code,
          isActive: true,
          jobRole: 'Family Contact',
          phone: faker.phone.number('+61 4## ### ###'),
          profilePic: faker.image.avatar(),
          createdAt: new Date(),
          updatedAt: new Date(),
          isSeedData: true
        });
      }
    }

    // Insert all users
    console.log('\nInserting users into database...');
    await db.collection('login').insertMany(allLoginUsers);
    await db.collection('users').insertMany(allProfileUsers);
    
    console.log(`✓ Inserted ${allLoginUsers.length} users into login collection`);
    console.log(`✓ Inserted ${allProfileUsers.length} users into users collection`);
    
    // Count totals
    const loginCount = await db.collection('login').countDocuments();
    const usersCount = await db.collection('users').countDocuments();
    
    console.log('\n=== SEED DATA SUMMARY ===');
    console.log(`Total Organizations: ${orgs.length}`);
    console.log(`Total Users: ${loginCount}`);
    console.log(`  - Admins: ${orgs.length}`);
    console.log(`  - Workers: ${orgs.length * 5}`);
    console.log(`  - Clients: ${orgs.length * 10}`);
    console.log(`  - Family: ${orgs.length * 3}`);
    
    console.log('\n=== TEST CREDENTIALS ===');
    console.log('\nOrganization 1 (DEV01 - CareNest Development):');
    console.log('  Admin: admin@dev01.app / Admin123!');
    console.log('  Workers: worker1@dev01.app - worker5@dev01.app / Worker123!');
    console.log('  Clients: client1@dev01.app - client10@dev01.app / Client123!');
    console.log('  Family: family1@dev01.app - family3@dev01.app / Family123!');
    
    console.log('\nOrganization 2 (CARE01 - Sunshine Disability Services):');
    console.log('  Admin: admin@care01.app / Admin123!');
    console.log('  Workers: worker1@care01.app - worker5@care01.app / Worker123!');
    console.log('  Clients: client1@care01.app - client10@care01.app / Client123!');
    
  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await client.close();
  }
}

generateSeedData();
