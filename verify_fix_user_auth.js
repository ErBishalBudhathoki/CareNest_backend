/**
 * Verify and Fix User Authorization for Expense Creation
 * 
 * This script connects to the development MongoDB Atlas instance
 * (same as the deployed Cloud Functions) and verifies/fixes the user's
 * organization association.
 */

require('dotenv').config();
const { MongoClient } = require('mongodb');

const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = process.env.DB_NAME || 'Invoice';

async function verifyAndFixUserAuth() {
    const client = new MongoClient(MONGODB_URI, {
        tls: true,
        family: 4
    });

    try {
        console.log('🔌 Connecting to MongoDB Atlas (dev)...');
        console.log(`📍 Database: ${DB_NAME}`);
        await client.connect();
        console.log('✅ Connected successfully!\n');

        const db = client.db(DB_NAME);
        const usersCollection = db.collection('users');

        // Test credentials from the expense creation request
        const testEmail = 'test1@tester.com';
        const expectedOrgId = '6846b040808f01d85897bbd8';

        console.log('=== USER VERIFICATION ===');
        console.log(`Email: ${testEmail}`);
        console.log(`Expected organizationId: ${expectedOrgId}\n`);

        // Step 1: Find all users with this email
        console.log('🔍 Searching for users...');
        const users = await usersCollection.find({ email: testEmail }).toArray();

        if (users.length === 0) {
            console.log('❌ ERROR: No users found with email:', testEmail);
            console.log('⚠️  This user needs to be created first!\n');
            return;
        }

        console.log(`✅ Found ${users.length} user(s) with email: ${testEmail}\n`);

        // Step 2: Examine each user
        for (let i = 0; i < users.length; i++) {
            const user = users[i];
            console.log(`--- User #${i + 1} ---`);
            console.log(`_id: ${user._id}`);
            console.log(`email: ${user.email}`);
            console.log(`organizationId: ${user.organizationId}`);
            console.log(`firstName: ${user.firstName}`);
            console.log(`lastName: ${user.lastName}`);
            console.log(`role: ${user.role}`);
            console.log(`roles: ${JSON.stringify(user.roles)}`);
            console.log(`isActive: ${user.isActive}\n`);
        }

        // Step 3: Check if any user has the correct organizationId
        const userWithCorrectOrg = users.find(u => u.organizationId === expectedOrgId);

        if (userWithCorrectOrg) {
            console.log('✅ VERIFICATION PASSED!');
            console.log(`User ${testEmail} is correctly associated with organization ${expectedOrgId}\n`);

            // Verify the exact query that the backend uses
            console.log('🔍 Testing backend query pattern...');
            const backendQuery = await usersCollection.findOne({
                email: testEmail,
                organizationId: expectedOrgId
            });

            if (backendQuery) {
                console.log('✅ Backend query successful! User authorization should work.\n');
            } else {
                console.log('❌ Backend query failed! This indicates a data type mismatch.\n');
                console.log('Debugging info:');
                console.log(`Query organizationId type: ${typeof expectedOrgId}`);
                console.log(`User organizationId type: ${typeof userWithCorrectOrg.organizationId}`);
                console.log(`Values match: ${userWithCorrectOrg.organizationId === expectedOrgId}\n`);
            }
        } else {
            console.log('❌ VERIFICATION FAILED!');
            console.log(`User ${testEmail} does NOT have organizationId: ${expectedOrgId}\n`);

            // Step 4: Offer to fix
            const primaryUser = users[0];
            const currentOrgId = primaryUser.organizationId;

            console.log('🔧 FIX REQUIRED:');
            console.log(`Current organizationId: "${currentOrgId}"`);
            console.log(`Required organizationId: "${expectedOrgId}"\n`);

            console.log('Updating user...');
            const updateResult = await usersCollection.updateOne(
                { _id: primaryUser._id },
                {
                    $set: {
                        organizationId: expectedOrgId,
                        updatedAt: new Date()
                    }
                }
            );

            console.log(`✅ Update result: ${updateResult.modifiedCount} document(s) modified\n`);

            // Verify the fix
            const verifyUser = await usersCollection.findOne({
                email: testEmail,
                organizationId: expectedOrgId
            });

            if (verifyUser) {
                console.log('✅ FIX VERIFIED! User is now correctly associated with the organization.');
                console.log(`User _id: ${verifyUser._id}`);
                console.log(`organizationId: ${verifyUser.organizationId}\n`);
            } else {
                console.log('❌ FIX FAILED! User still not correctly associated.\n');
            }
        }

        // Step 5: Additional checks
        console.log('=== ADDITIONAL CHECKS ===');

        // Check organization exists
        const orgsCollection = db.collection('organizations');
        const org = await orgsCollection.findOne({ _id: expectedOrgId });

        if (org) {
            console.log(`✅ Organization ${expectedOrgId} exists`);
            console.log(`   Name: ${org.name || 'N/A'}\n`);
        } else {
            console.log(`⚠️  Organization ${expectedOrgId} NOT found in database`);
            console.log('   This might cause other issues!\n');
        }

        console.log('=== SUMMARY ===');
        console.log('✅ Script completed successfully!');
        console.log('🔄 Try creating the expense again in the app.\n');

    } catch (error) {
        console.error('❌ Error:', error.message);
        console.error('Stack:', error.stack);
    } finally {
        await client.close();
        console.log('🔌 MongoDB connection closed.');
    }
}

// Run the script
verifyAndFixUserAuth().catch(console.error);
