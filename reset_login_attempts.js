#!/usr/bin/env node

/**
 * Script to reset login attempts and account lockouts for a specific user.
 * 
 * Usage: node backend/reset_login_attempts.js <email>
 */

const { MongoClient } = require('mongodb');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const uri = process.env.MONGODB_URI;
const dbName = process.env.DB_NAME || process.env.MONGODB_DATABASE || 'Invoice';

async function resetLoginAttempts() {
  const emailArg = process.argv[2];
  if (!emailArg) {
    console.error('Usage: node backend/reset_login_attempts.js <email>');
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
    console.log(`Connected to MongoDB. Target Database: ${dbName}`);
    
    const db = client.db(dbName);
    
    console.log(`Searching for user: ${email}`);

    // COLLECTIONS TO CHECK
    const collections = ['login', 'users'];
    let totalUpdated = 0;

    for (const colName of collections) {
      const collection = db.collection(colName);
      
      // Reset logic: clear attempts and lockouts
      const result = await collection.updateOne(
        { email },
        { 
          $set: { 
            loginAttempts: 0,
            lockUntil: null,
            lockedUntil: null, // Handle both naming variations
            lastFailedLogin: null,
            isLocked: false
          }
        }
      );

      if (result.matchedCount > 0) {
        console.log(`✅ Successfully reset login attempts in '${colName}' collection`);
        totalUpdated += result.modifiedCount;
      } else {
        console.log(`ℹ️  User not found in '${colName}' collection`);
      }
    }

    if (totalUpdated === 0) {
      console.warn(`\n⚠️  WARNING: No records were updated for ${email}.`);
      console.warn(`Please verify the email address or check the database directly.`);
    } else {
      console.log(`\n🎉 Reset complete! User ${email} should be able to log in now.`);
    }
    
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  } finally {
    await client.close();
  }
}

resetLoginAttempts();