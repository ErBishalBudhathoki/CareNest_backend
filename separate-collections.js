/**
 * Proper Auth + User Profile Separation
 * 
 * login collection: Authentication credentials only
 * users collection: User profile data only
 */

const mongoose = require('mongoose');

// Connect to MongoDB
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://bishalkc331:REDACTED_MONGODB_PASSWORD_2@morethaninvoicecluster.xptftb5.mongodb.net/Invoice?retryWrites=true&w=majority';

async function separateCollections() {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');

    const loginCollection = mongoose.connection.collection('login');
    const usersCollection = mongoose.connection.collection('users');

    // Get all users from login collection
    const users = await loginCollection.find({}).toArray();
    console.log(`📊 Found ${users.length} users in 'login' collection\n`);

    if (users.length === 0) {
      console.log('✅ No users to migrate');
      return;
    }

    // Create users collection with profile data only
    let usersCreated = 0;
    let usersUpdated = 0;
    let authCreated = 0;

    for (const user of users) {
      console.log(`\n📝 Processing: ${user.email}`);

      // 1. Ensure auth data stays in login collection
      const authData = {
        email: user.email,
        password: user.password,
        otp: user.otp || null,
        otpExpiry: user.otpExpiry || null,
        otpUsed: user.otpUsed || false,
        refreshTokens: user.refreshTokens || [],
        loginAttempts: user.loginAttempts || 0,
        lockUntil: user.lockUntil || null,
        securityQuestions: user.securityQuestions || [],
        lastPasswordChange: user.passwordUpdatedAt || null
      };

      const existingAuth = await loginCollection.findOne({ email: user.email });
      if (existingAuth) {
        await loginCollection.updateOne(
          { email: user.email },
          { $set: authData }
        );
        console.log(`   🔐 Auth data updated in 'login' collection`);
        authCreated++;
      } else {
        await loginCollection.insertOne(authData);
        console.log(`   🔐 Auth data created in 'login' collection`);
        authCreated++;
      }

      // 2. Create user profile in users collection (NO auth fields)
      const profileData = {
        // Identity
        email: user.email,
        
        // Profile
        firstName: user.firstName,
        lastName: user.lastName,
        displayName: `${user.firstName} ${user.lastName}`.trim(),
        phone: user.phone || null,
        photo: user.photo || user.profilePic || null,
        
        // Organization
        organizationId: user.organizationId,
        organizationCode: user.organizationCode || null,
        organizationName: user.organizationName || null,
        
        // Roles & Permissions
        role: user.role || 'user',
        roles: user.roles || (user.role ? [user.role] : ['user']),
        
        // Employment
        clientId: user.clientId || null,
        jobRole: user.jobRole || null,
        employmentType: user.employmentType || null,
        classificationLevel: user.classificationLevel || null,
        payPoint: user.payPoint || null,
        stream: user.stream || null,
        
        // Rates & Pay
        payRate: user.payRate || 0,
        rates: user.rates || {},
        activeAllowances: user.activeAllowances || [],
        payType: user.payType || null,
        
        // Settings
        multiOrgEnabled: user.multiOrgEnabled || false,
        defaultOrganizationId: user.defaultOrganizationId || null,
        lastActiveOrganizationId: user.lastActiveOrganizationId || null,
        fcmToken: user.fcmToken || null,
        
        // Status
        isActive: user.isActive !== false,
        isEmailVerified: user.isEmailVerified || false,
        
        // Timestamps
        createdAt: user.createdAt || new Date(),
        updatedAt: new Date(),
        lastLogin: user.lastLogin || null
      };

      const existingProfile = await usersCollection.findOne({ email: user.email });
      if (existingProfile) {
        await usersCollection.updateOne(
          { email: user.email },
          { $set: profileData }
        );
        console.log(`   👤 Profile updated in 'users' collection`);
        usersUpdated++;
      } else {
        await usersCollection.insertOne(profileData);
        console.log(`   👤 Profile created in 'users' collection`);
        usersCreated++;
      }
    }

    console.log(`\n\n📈 Migration Complete!`);
    console.log(`   Auth records (login collection): ${authCreated}`);
    console.log(`   Profiles created (users collection): ${usersCreated}`);
    console.log(`   Profiles updated: ${usersUpdated}`);

    // 3. Show separation
    console.log(`\n\n📋 Collection Separation:`);
    console.log(`\n🔐 login collection (Auth only):`);
    const authFields = await loginCollection.findOne({ email: 'deverbishal331@gmail.com' });
    if (authFields) {
      console.log('   Fields:', Object.keys(authFields).filter(k => !k.startsWith('_')).join(', '));
    }

    console.log(`\n👤 users collection (Profile only):`);
    const profileFields = await usersCollection.findOne({ email: 'deverbishal331@gmail.com' });
    if (profileFields) {
      console.log('   Fields:', Object.keys(profileFields).filter(k => !k.startsWith('_')).join(', '));
    }

  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log('\n✅ Disconnected from MongoDB');
  }
}

separateCollections();
