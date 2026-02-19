#!/usr/bin/env node

import { faker } from '@faker-js/faker';
import { MongoClient } from 'mongodb';

const MONGO_URI = 'mongodb+srv://erbishalb331:REDACTED_MONGODB_PASSWORD@carenest.mzabftn.mongodb.net/Invoice?retryWrites=true&w=majority';

async function generateBusinessData() {
  const client = new MongoClient(MONGO_URI);
  
  try {
    await client.connect();
    const db = client.db();
    
    console.log('Generating business seed data...\n');
    
    const orgs = [
      { id: '697f1fd6191a1decde9344e9', code: 'DEV01', name: 'CareNest Development' },
      { id: 'org-care-001', code: 'CARE01', name: 'Sunshine Disability Services' },
      { id: 'org-ndis-001', code: 'NDIS01', name: 'NDIS Support Solutions' },
      { id: 'org-aged-001', code: 'AGED01', name: 'Aged Care Plus' }
    ];

    // Get existing users to link data
    const workers = await db.collection('login').find({ role: 'worker' }).toArray();
    const clients = await db.collection('login').find({ role: 'client' }).toArray();
    
    console.log(`Found ${workers.length} workers, ${clients.length} clients`);
    
    // Generate Shifts
    const shifts = [];
    for (let i = 0; i < 200; i++) {
      const org = faker.helpers.arrayElement(orgs);
      const clientUser = clients.find(c => c.organizationId === org.id) || faker.helpers.arrayElement(clients);
      const workerUser = workers.find(w => w.organizationId === org.id) || faker.helpers.arrayElement(workers);
      
      const startTime = faker.date.recent({ days: 30 });
      const duration = faker.helpers.arrayElement([2, 4, 6, 8]);
      const endTime = new Date(startTime.getTime() + duration * 60 * 60 * 1000);
      
      shifts.push({
        clientId: clientUser?._id?.toString() || faker.string.uuid(),
        workerId: workerUser?._id?.toString() || faker.string.uuid(),
        organizationId: org.id,
        startTime,
        endTime,
        duration,
        status: faker.helpers.arrayElement(['completed', 'completed', 'completed', 'scheduled', 'in-progress']),
        shiftType: faker.helpers.arrayElement(['regular', 'overnight', 'respite']),
        services: faker.helpers.arrayElements(['personal-care', 'meal-prep', 'medication', 'transport', 'domestic-assistance'], { min: 1, max: 3 }),
        location: {
          street: faker.location.streetAddress(),
          city: faker.location.city(),
          state: faker.helpers.arrayElement(['NSW', 'VIC', 'QLD', 'SA', 'WA']),
          postcode: faker.location.zipCode('####')
        },
        notes: faker.lorem.sentence(),
        billing: {
          hourlyRate: faker.number.int({ min: 35, max: 65 }),
          totalAmount: duration * faker.number.int({ min: 35, max: 65 }),
          invoiced: faker.datatype.boolean()
        },
        createdAt: faker.date.recent({ days: 60 }),
        updatedAt: new Date(),
        isSeedData: true
      });
    }
    
    // Generate Invoices
    const invoices = [];
    for (let i = 0; i < 100; i++) {
      const org = faker.helpers.arrayElement(orgs);
      const clientUser = clients.find(c => c.organizationId === org.id) || faker.helpers.arrayElement(clients);
      
      const issueDate = faker.date.recent({ days: 90 });
      const dueDate = new Date(issueDate);
      dueDate.setDate(dueDate.getDate() + 30);
      
      const lineItems = [];
      const itemCount = faker.number.int({ min: 1, max: 5 });
      let subtotal = 0;
      
      for (let j = 0; j < itemCount; j++) {
        const hours = faker.number.int({ min: 1, max: 20 });
        const rate = faker.number.int({ min: 35, max: 65 });
        const total = hours * rate;
        subtotal += total;
        
        lineItems.push({
          description: faker.helpers.arrayElement(['Personal Care', 'Support Work', 'Domestic Assistance', 'Meal Preparation', 'Transportation']),
          quantity: hours,
          unit: 'hours',
          rate,
          total
        });
      }
      
      const gst = subtotal * 0.1;
      
      invoices.push({
        clientId: clientUser?._id?.toString() || faker.string.uuid(),
        organizationId: org.id,
        invoiceNumber: `INV-${org.code}-${String(i + 1).padStart(4, '0')}`,
        issueDate,
        dueDate,
        status: faker.helpers.arrayElement(['paid', 'paid', 'sent', 'overdue']),
        lineItems,
        subtotal,
        gst,
        totalAmount: subtotal + gst,
        amountPaid: faker.helpers.arrayElement([0, subtotal + gst, (subtotal + gst) * 0.5]),
        amountDue: subtotal + gst,
        paymentTerms: 'Net 30',
        notes: faker.lorem.sentence(),
        createdAt: issueDate,
        updatedAt: new Date(),
        isSeedData: true
      });
    }

    // Generate Timesheets
    const timesheets = [];
    for (let i = 0; i < 150; i++) {
      const org = faker.helpers.arrayElement(orgs);
      const workerUser = workers.find(w => w.organizationId === org.id) || faker.helpers.arrayElement(workers);
      
      const clockIn = faker.date.recent({ days: 14 });
      const totalHours = faker.number.float({ min: 2, max: 12, fractionDigits: 2 });
      const clockOut = new Date(clockIn.getTime() + totalHours * 60 * 60 * 1000);
      
      timesheets.push({
        workerId: workerUser?._id?.toString() || faker.string.uuid(),
        organizationId: org.id,
        clockIn,
        clockOut,
        totalHours,
        breakDuration: faker.helpers.arrayElement([0, 0.5, 1]),
        status: faker.helpers.arrayElement(['approved', 'approved', 'pending']),
        approvedBy: faker.helpers.arrayElement(orgs).id,
        notes: faker.lorem.sentence(),
        location: {
          latitude: faker.location.latitude({ min: -40, max: -10 }),
          longitude: faker.location.longitude({ min: 110, max: 155 })
        },
        createdAt: faker.date.recent({ days: 30 }),
        updatedAt: new Date(),
        isSeedData: true
      });
    }

    // Generate Expenses
    const expenses = [];
    for (let i = 0; i < 80; i++) {
      const org = faker.helpers.arrayElement(orgs);
      const workerUser = workers.find(w => w.organizationId === org.id) || faker.helpers.arrayElement(workers);
      
      expenses.push({
        workerId: workerUser?._id?.toString() || faker.string.uuid(),
        organizationId: org.id,
        category: faker.helpers.arrayElement(['travel', 'meals', 'supplies', 'equipment', 'training']),
        amount: faker.number.float({ min: 10, max: 500, fractionDigits: 2 }),
        date: faker.date.recent({ days: 30 }),
        description: faker.lorem.sentence(),
        receiptUrl: faker.datatype.boolean() ? faker.image.url() : null,
        status: faker.helpers.arrayElement(['approved', 'approved', 'pending', 'reimbursed']),
        approvedBy: faker.helpers.arrayElement(orgs).id,
        notes: faker.lorem.sentence(),
        createdAt: faker.date.recent({ days: 30 }),
        updatedAt: new Date(),
        isSeedData: true
      });
    }

    // Insert all data
    console.log('Inserting shifts...');
    await db.collection('shifts').insertMany(shifts);
    console.log(`✓ Inserted ${shifts.length} shifts`);

    console.log('Inserting invoices...');
    await db.collection('invoices').insertMany(invoices);
    console.log(`✓ Inserted ${invoices.length} invoices`);

    console.log('Inserting timesheets...');
    await db.collection('timesheets').insertMany(timesheets);
    console.log(`✓ Inserted ${timesheets.length} timesheets`);

    console.log('Inserting expenses...');
    await db.collection('expenses').insertMany(expenses);
    console.log(`✓ Inserted ${expenses.length} expenses`);

    // Count totals
    const shiftCount = await db.collection('shifts').countDocuments();
    const invoiceCount = await db.collection('invoices').countDocuments();
    const timesheetCount = await db.collection('timesheets').countDocuments();
    const expenseCount = await db.collection('expenses').countDocuments();
    const loginCount = await db.collection('login').countDocuments();
    const usersCount = await db.collection('users').countDocuments();

    console.log('\n=== TOTAL SEED DATA ===');
    console.log(`Users (login): ${loginCount}`);
    console.log(`Users (profile): ${usersCount}`);
    console.log(`Shifts: ${shiftCount}`);
    console.log(`Invoices: ${invoiceCount}`);
    console.log(`Timesheets: ${timesheetCount}`);
    console.log(`Expenses: ${expenseCount}`);
    
  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await client.close();
  }
}

generateBusinessData();
