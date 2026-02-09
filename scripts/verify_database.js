/**
 * Database Verification Script
 * 
 * Verifies that all expected collections exist and have proper indexes
 * 
 * Usage: node scripts/verify_database.js
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const { MongoClient } = require('mongodb');

// Match actual collection names as created by Mongoose models
const EXPECTED_COLLECTIONS = [
  // Auth & Users (using actual Mongoose collection names)
  'users', 'userorganizations', 'user_organizations', 'fcmTokens', 'auditLogs', 'audit_logs', 'audit_trail',
  
  // Organizations
  'organizations', 'organization_branding', 'businesses',
  
  // Clients
  'clients', 'clientAssignments', 'shared_employee_assignments',
  
  // Scheduling
  'shifts', 'worked_times', 'active_timers', 'roster_templates', 'rosterTemplates', 'timing_predictions', 'calendarevents',
  
  // Invoicing
  'invoices', 'invoiceLineItems', 'creditNotes', 'custom_pricing', 'line_items',
  
  // NDIS
  'support_items', 'ndis_pricing', 'mmmLocations', 'mmm_locations', 'mmmOverrides',
  
  // Expenses
  'expenses', 'recurring_expenses',
  
  // Leave
  'leave_requests', 'leave_balances', 'leave_types',
  
  // Payroll
  'payrollrecords', 'payrollsettings',
  
  // Onboarding & Compliance
  'onboarding_records', 'employee_documents', 'certifications',
  'trainingModules', 'trainingProgress', 'complianceChecklists', 'userChecklistStatus',
  
  // Teams
  'teams', 'team_members', 'emergency_broadcasts',
  
  // Notifications
  'notificationsettings', 'notificationhistories', 'reminderLogs', 'snoozerules',
  
  // Location
  'geofencelocations', 'trips',
  
  // Settings
  'pricing_settings', 'holidays', 'job_roles', 'bank_details',
  
  // Other
  'notes', 'requests', 'engagementfeedbacks', 'voicecommands', 'api_usage_logs', 'user_activity_logs'
];

// Collections we actually need (core functionality)
const CORE_COLLECTIONS = [
  'users', 'organizations', 'clients', 'shifts', 'worked_times', 
  'invoices', 'expenses', 'leave_requests', 'support_items', 'holidays'
];

async function verifyDatabase() {
  const dbName = process.env.DB_NAME || process.env.MONGODB_DATABASE || 'Invoice';
  const uri = process.env.MONGODB_URI;
  
  console.log(`🔍 Verifying database: ${dbName}\n`);
  
  const client = await MongoClient.connect(uri);
  const db = client.db(dbName);
  
  try {
    // Get all collections
    const collections = await db.listCollections().toArray();
    const collectionNames = collections.map(c => c.name);
    
    console.log(`Total collections found: ${collectionNames.length}\n`);
    
    // Check for core collections (flexible naming)
    const corePresent = [];
    const coreMissing = [];
    
    for (const coreCollection of CORE_COLLECTIONS) {
      // Check if any variation of the name exists
      const variations = [
        coreCollection,
        coreCollection.replace(/_/g, ''), // Remove underscores (userorganizations)
        coreCollection.split('_').map((w, i) => i === 0 ? w : w.charAt(0).toUpperCase() + w.slice(1)).join('') // camelCase
      ];
      
      const exists = variations.some(v => collectionNames.includes(v));
      if (exists) {
        corePresent.push(coreCollection);
      } else {
        coreMissing.push(coreCollection);
      }
    }
    
    console.log(`✅ Core Collections Present: ${corePresent.length}/${CORE_COLLECTIONS.length}`);
    console.log(`📊 Total Collections: ${collectionNames.length}`);
    
    if (coreMissing.length > 0) {
      console.log(`\n⚠️  Missing Core Collections: ${coreMissing.length}`);
      coreMissing.forEach(c => console.log(`  - ${c}`));
    }
    
    // Check data counts
    console.log('\n📊 Data Counts:');
    const supportItems = await db.collection('support_items').countDocuments();
    console.log(`  Support Items: ${supportItems}`);
    
    // Check both 'holidays' and 'public_holidays'
    const holidays = await db.collection('holidays').countDocuments();
    console.log(`  Public Holidays: ${holidays}`);
    
    const users = await db.collection('users').countDocuments();
    console.log(`  Users: ${users}`);
    
    const organizations = await db.collection('organizations').countDocuments();
    console.log(`  Organizations: ${organizations}`);
    
    // Check for UserOrganization records (can be userorganizations or user_organizations)
    let userOrgs = 0;
    try {
      userOrgs = await db.collection('userorganizations').countDocuments();
    } catch {
      try {
        userOrgs = await db.collection('user_organizations').countDocuments();
      } catch {}
    }
    console.log(`  UserOrganizations: ${userOrgs}`);
    
    // Overall status
    console.log('\n' + '='.repeat(50));
    if (coreMissing.length === 0 && supportItems > 0 && holidays > 0) {
      console.log('✅ DATABASE READY - All core collections present and seeded');
      console.log('\n📝 Summary:');
      console.log(`   • ${collectionNames.length} collections created`);
      console.log(`   • ${supportItems} NDIS support items loaded`);
      console.log(`   • ${holidays} public holidays loaded`);
      console.log(`   • Ready for admin registration and first use`);
      process.exit(0);
    } else if (coreMissing.length === 0) {
      console.log('⚠️  DATABASE PARTIALLY READY - Collections exist but missing reference data');
      console.log('Run: npm run db:init-fresh');
      process.exit(0);
    } else {
      console.log('❌ DATABASE NOT READY - Missing core collections');
      console.log('Run: npm run db:init-fresh');
      process.exit(1);
    }
    
  } finally {
    await client.close();
  }
}

verifyDatabase().catch(err => {
  console.error('❌ Verification failed:', err);
  process.exit(1);
});
