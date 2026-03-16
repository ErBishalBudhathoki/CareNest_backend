#!/usr/bin/env node

/**
 * Script to reset login attempts for a specific user.
 * 
 * Usage: node backend/reset_login_attempt.js <email>
 */

const { MongoClient } = require('mongodb');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const uri = process.env.MONGODB_URI;
const dbName = process.env.DB_NAME || process.env.MONGODB_DATABASE || 'Invoice';

async function resetAttempt() {
  const emailArg = process.argv[2];
  if (!emailArg) {
    console.error('Usage: node backend/reset_login_attempt.js <email>');
    process.exit(1);
  }

  const email = emailArg.toLowerCase().trim();

  if (!uri) {
    console.error('Error: MONGODB_URI not found in .env');
    process.exit(1);
  }

  const client = new MongoClient(uri, { tls: true, family: 4 });
  
  try {
    await client.connect();
    console.log(`Connected to MongoDB. Database: ${dbName}`);
    
    const db = client.db(dbName);
    
    // Check in both collections
    const collections = ['login', 'users'];
    let found = false;

    for (const colName of collections) {
      const collection = db.collection(colName);
      const result = await collection.updateOne(
        { email },
        {
          $set: {
            loginAttempts: 0,
            lockUntil: null,
            lockedUntil: null,
            lastFailedLogin: null
          }
        }
      );

      if (result.matchedCount > 0) {
        console.log(`✅ Success: Reset attempts for ${email} in '${colName}'`);
        found = true;
      }
    }

    if (!found) {
      console.log(`❌ Error: User ${email} not found in database.`);
    }

  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  } finally {
    await client.close();
  }
}

resetAttempt();