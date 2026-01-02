/**
 * Set up password for admin user so they can log in to the Flutter app
 */

require('dotenv').config();
const { MongoClient } = require('mongodb');
const bcrypt = require('bcryptjs');
const { createLogger } = require('./utils/logger');
const logger = createLogger('AdminSetup');

async function setupAdminPassword() {
  let client;
  
  try {
    logger.info('Setting up password for admin user...');
    
    // Connect to MongoDB
    client = new MongoClient(process.env.MONGODB_URI, { tls: true, family: 4 });
    await client.connect();
    
    const db = client.db('Invoice');
    
    // Check if admin user exists
    const adminUser = await db.collection('login').findOne({
      email: 'admin@test.com',
      role: 'admin'
    });
    
    if (!adminUser) {
      logger.info('Admin user not found in login collection during password setup');
      return;
    }
    
    logger.info('Found admin user during password setup', {
      email: adminUser.email
    });
    
    if (adminUser.password) {
      logger.info('Admin user already has a password, skipping setup');
      return;
    }
    
    // Create a simple password for testing
    const password = 'admin123';
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);
    
    // Update the admin user with password and additional required fields
    const updateResult = await db.collection('login').updateOne(
      { email: 'admin@test.com' },
      {
        $set: {
          password: hashedPassword,
          name: 'Admin User',
          firstName: 'Admin',
          lastName: 'User',
          isActive: true,
          updatedAt: new Date()
        }
      }
    );
    
    if (updateResult.modifiedCount > 0) {
      logger.info('Successfully set up admin user password', {
        email: 'admin@test.com',
        message: 'Admin user can now log in to the Flutter app and receive timer notifications'
      });
    } else {
      logger.error('Failed to update admin user password');
    }
    
  } catch (error) {
    logger.error('Setup failed', {
      error: error.message,
      stack: error.stack
    });
  } finally {
    if (client) {
      await client.close();
    }
  }
}

setupAdminPassword();