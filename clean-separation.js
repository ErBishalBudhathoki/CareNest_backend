/**
 * Clean Separation: login vs users collection
 * 
 * login collection: ONLY authentication credentials
 * users collection: ONLY user profile data
 */

const mongoose = require('mongoose');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://bishalkc331:REDACTED_MONGODB_PASSWORD_2@morethaninvoicecluster.xptftb5.mongodb.net/Invoice?retryWrites=true&w=majority';

async function cleanSeparation() {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');

    const loginCollection = mongoose.connection.collection('login');
    const usersCollection = mongoose.connection.collection('users');

    // Get all users from login collection (source of truth)
    const users = await loginCollection.find({}).toArray();
    console.log(`📊 Found ${users.length} users to separate\n`);

    if (users.length === 0) {
      console.log('✅ No users to process');
      return;
    }

    let authSeparated = 0;
    let profilesSeparated = 0;

    for (const user of users) {
      console.log(`\n📝 Processing: ${user.email}`);
      console.log(`   ⏳ Before separation:`);
      console.log(`      login collection has ${Object.keys(user).length} fields`);

      // 1. Clean login collection - KEEP ONLY auth fields
      const cleanAuth = {
        email: user.email,
        password: user.password, // Required for authentication
        otp: user.otp || null,
        otpExpiry: user.otpExpiry || null,
        otpUsed: user.otpUsed || false,
        refreshTokens: user.refreshTokens || [],
        loginAttempts: user.loginAttempts || 0,
        lockUntil: user.lockUntil || null,
        securityQuestions: user.securityQuestions || [],
        lastPasswordChange: user.passwordUpdatedAt || null,
        lastLogin: user.lastLogin || null,
        updatedAt: new Date()
      };

      await loginCollection.replaceOne(
        { email: user.email },
        cleanAuth
      );
      console.log(`   🔐 Auth separated: ${Object.keys(cleanAuth).length} fields in 'login' collection`);
      authSeparated++;

      // 2. Clean users collection - KEEP ONLY profile fields (NO auth data!)
      const cleanProfile = {
        // Identity
        email: user.email,
        
        // Profile
        firstName: user.firstName,
        lastName: user.lastName,
        displayName: `${user.firstName} ${user.lastName}`.trim(),
        phone: user.phone || null,
        photo: user.photo || user.profilePic || user.filename || null,
        photoUrl: user.photoUrl || null,
        
        // Organization
        organizationId: user.organizationId,
        organizationCode: user.organizationCode || null,
        organizationName: user.organizationName || null,
        
        // Roles & Permissions
        role: user.role || 'user',
        roles: user.roles || (user.role ? [user.role] : ['user']),
        
        // Employment Details
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
        abn: user.abn || null, // Business field
        
        // Settings & Preferences
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

      await usersCollection.replaceOne(
        { email: user.email },
        cleanProfile
      );
      console.log(`   👤 Profile separated: ${Object.keys(cleanProfile).length} fields in 'users' collection`);
      profilesSeparated++;
    }

    console.log(`\n\n📈 Clean Separation Complete!`);
    console.log(`   Auth records cleaned: ${authSeparated}`);
    console.log(`   Profiles cleaned: ${profilesSeparated}`);

    // Verify separation
    console.log(`\n\n🔍 Verification:`);
    
    const authDoc = await loginCollection.findOne({ email: 'REDACTED_EMAIL' });
    const profileDoc = await usersCollection.findOne({ email: 'REDACTED_EMAIL' });

    console.log(`\n🔐 login collection fields (${Object.keys(authDoc || {}).length}):`);
    console.log(`   ${Object.keys(authDoc || {}).filter(k => !k.startsWith('_')).join(', ')}`);
    
    console.log(`\n👤 users collection fields (${Object.keys(profileDoc || {}).length}):`);
    console.log(`   ${Object.keys(profileDoc || {}).filter(k => !k.startsWith('_')).join(', ')}`);

    console.log(`\n✅ Collections are now properly separated!`);
    console.log(`\n📋 Collection Purposes:`);
    console.log(`   🔐 login: Authentication only (email, password, OTP, tokens)`);
    console.log(`   👤 users: Profile data only (name, role, org, settings)`);

  } catch (error) {
    console.error('❌ Separation failed:', error.message);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log('\n✅ Disconnected from MongoDB');
  }
}

cleanSeparation();
