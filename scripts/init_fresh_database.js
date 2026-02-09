/**
 * Fresh Database Initialization Script
 * 
 * This script initializes a completely fresh database with:
 * - All 60+ collections with proper indexes
 * - Essential reference data (NDIS support items, public holidays, etc.)
 * - Database name from environment variable
 * 
 * Usage: node scripts/init_fresh_database.js
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const mongoose = require('mongoose');
const { MongoClient } = require('mongodb');
const fs = require('fs');
const csv = require('csv-parser');

// Models (ensure all are imported for collection creation)
const User = require('../models/User');
const UserOrganization = require('../models/UserOrganization');
const Organization = require('../models/Organization');
const OrganizationBranding = require('../models/OrganizationBranding');
const Business = require('../models/Business');
const Client = require('../models/Client');
const ClientAssignment = require('../models/ClientAssignment');
const SharedEmployeeAssignment = require('../models/SharedEmployeeAssignment');
const Shift = require('../models/Shift');
const WorkedTime = require('../models/WorkedTime');
const ActiveTimer = require('../models/ActiveTimer');
const RosterTemplate = require('../models/RosterTemplate');
const Invoice = require('../models/Invoice');
const InvoiceLineItem = require('../models/InvoiceLineItem');
const CreditNote = require('../models/CreditNote');
const CustomPricing = require('../models/CustomPricing');
const SupportItem = require('../models/SupportItem');
const Expense = require('../models/Expense');
const RecurringExpense = require('../models/RecurringExpense');
const LeaveRequest = require('../models/LeaveRequest');
const LeaveBalance = require('../models/LeaveBalance');
const PayrollRecord = require('../models/PayrollRecord');
const PayrollSetting = require('../models/PayrollSetting');
const OnboardingRecord = require('../models/OnboardingRecord');
const EmployeeDocument = require('../models/EmployeeDocument');
const Certification = require('../models/Certification');
const TrainingModule = require('../models/TrainingModule');
const TrainingProgress = require('../models/TrainingProgress');
const ComplianceChecklist = require('../models/ComplianceChecklist');
const UserChecklistStatus = require('../models/UserChecklistStatus');
const Team = require('../models/Team');
const TeamMember = require('../models/TeamMember');
const EmergencyBroadcast = require('../models/EmergencyBroadcast');
const NotificationSetting = require('../models/NotificationSetting');
const NotificationHistory = require('../models/NotificationHistory');
const ReminderLog = require('../models/ReminderLog');
const SnoozeRule = require('../models/SnoozeRule');
const GeofenceLocation = require('../models/GeofenceLocation');
const MmmLocation = require('../models/MmmLocation');
const MmmOverride = require('../models/MmmOverride');
const Trip = require('../models/Trip');
const PricingSettings = require('../models/PricingSettings');
const PublicHoliday = require('../models/PublicHoliday');
const Note = require('../models/Note');
const Request = require('../models/Request');
const EngagementFeedback = require('../models/EngagementFeedback');
const VoiceCommand = require('../models/VoiceCommand');
const TimingPrediction = require('../models/TimingPrediction');
const AuditLog = require('../models/AuditLog');
const AuditTrail = require('../models/AuditTrail');
const FcmToken = require('../models/FcmToken');
const CalendarEvent = require('../models/CalendarEvent');

const logger = console;

// Collection definitions for non-model collections
const ADDITIONAL_COLLECTIONS = [
  'line_items',
  'ndis_pricing',
  'mmm_locations',
  'job_roles',
  'leave_types',
  'bank_details',
  'api_usage_logs',
  'user_activity_logs'
];

class FreshDatabaseInitializer {
  constructor() {
    this.dbName = process.env.DB_NAME || process.env.MONGODB_DATABASE || 'Invoice';
    this.mongoUri = process.env.MONGODB_URI;
    this.client = null;
    this.db = null;
  }

  async connect() {
    logger.info('🔗 Connecting to MongoDB...');
    logger.info(`📦 Database: ${this.dbName}`);
    
    // Connect using Mongoose (for models)
    await mongoose.connect(this.mongoUri, {
      dbName: this.dbName,
      serverSelectionTimeoutMS: 5000
    });
    
    // Also get native MongoDB client for direct operations
    this.client = await MongoClient.connect(this.mongoUri);
    this.db = this.client.db(this.dbName);
    
    logger.info('✅ Connected to MongoDB');
  }

  async createCollections() {
    logger.info('\n📁 Creating collections with indexes...');
    
    const models = [
      User, UserOrganization, Organization, OrganizationBranding, Business,
      Client, ClientAssignment, SharedEmployeeAssignment,
      Shift, WorkedTime, ActiveTimer, RosterTemplate,
      Invoice, InvoiceLineItem, CreditNote, CustomPricing, SupportItem,
      Expense, RecurringExpense,
      LeaveRequest, LeaveBalance,
      PayrollRecord, PayrollSetting,
      OnboardingRecord, EmployeeDocument, Certification,
      TrainingModule, TrainingProgress, ComplianceChecklist, UserChecklistStatus,
      Team, TeamMember, EmergencyBroadcast,
      NotificationSetting, NotificationHistory, ReminderLog, SnoozeRule,
      GeofenceLocation, MmmLocation, MmmOverride, Trip,
      PricingSettings, PublicHoliday,
      Note, Request, EngagementFeedback,
      VoiceCommand, TimingPrediction,
      AuditLog, AuditTrail, FcmToken, CalendarEvent
    ];

    let created = 0;
    for (const Model of models) {
      try {
        const collectionName = Model.collection?.name || Model.modelName || 'unknown';
        // Create collection if it doesn't exist
        await Model.createCollection();
        // Ensure indexes are created
        await Model.ensureIndexes();
        created++;
        logger.info(`  ✅ ${collectionName}`);
      } catch (error) {
        const collectionName = Model.collection?.name || Model.modelName || 'unknown';
        if (error.code === 48) { // Collection already exists
          logger.info(`  ⏭️  ${collectionName} (already exists)`);
        } else {
          logger.error(`  ❌ ${collectionName}: ${error.message}`);
        }
      }
    }

    // Create additional non-model collections
    for (const collectionName of ADDITIONAL_COLLECTIONS) {
      try {
        await this.db.createCollection(collectionName);
        logger.info(`  ✅ ${collectionName}`);
        created++;
      } catch (error) {
        if (error.code === 48) {
          logger.info(`  ⏭️  ${collectionName} (already exists)`);
        } else {
          logger.error(`  ❌ ${collectionName}: ${error.message}`);
        }
      }
    }

    logger.info(`\n✅ Collection creation complete (${created} collections processed)\n`);
  }

  async seedNDISItems() {
    logger.info('📊 Seeding NDIS support items...');
    
    const ndisFile = path.join(__dirname, '../../NDIS.csv');
    
    if (!fs.existsSync(ndisFile)) {
      logger.warn('⚠️  NDIS.csv not found, skipping NDIS support items seed');
      return;
    }

    const existingCount = await SupportItem.countDocuments();
    if (existingCount > 0) {
      logger.info(`⏭️  NDIS support items already exist (${existingCount} items), skipping`);
      return;
    }

    const items = [];
    
    return new Promise((resolve, reject) => {
      fs.createReadStream(ndisFile)
        .pipe(csv())
        .on('data', (row) => {
          // Handle both CSV formats (with spaces and without)
          const supportItemNumber = row['Support Item Number'] || row.Support_Item_Number || row.supportItemNumber;
          const supportItemName = row['Support Item Name'] || row.Support_Item_Name || row.supportItemName;
          const unit = row['Unit'] || row.unit;
          
          // Get NSW price as default (or first available state price)
          const priceStr = row['NSW'] || row['VIC'] || row['QLD'] || row.Price || row.price || '0';
          const price = priceStr ? parseFloat(priceStr.replace(/[^0-9.]/g, '')) : 0;

          if (supportItemNumber && supportItemName) {
            items.push({
              supportItemNumber,
              supportItemName,
              price,
              unit: unit || 'H',
              description: supportItemName,
              isActive: true
            });
          }
        })
        .on('end', async () => {
          try {
            if (items.length > 0) {
              await SupportItem.insertMany(items, { ordered: false });
              logger.info(`✅ Seeded ${items.length} NDIS support items`);
            } else {
              logger.warn('⚠️  No NDIS items parsed from CSV');
            }
            resolve();
          } catch (error) {
            if (error.code === 11000) {
              // Duplicate key errors are ok (some items already exist)
              logger.info(`✅ Seeded NDIS support items (some duplicates skipped)`);
              resolve();
            } else {
              logger.error(`❌ Error seeding NDIS items: ${error.message}`);
              reject(error);
            }
          }
        })
        .on('error', reject);
    });
  }

  async seedPublicHolidays() {
    logger.info('📅 Seeding Australian public holidays...');
    
    const existingCount = await PublicHoliday.countDocuments();
    if (existingCount > 0) {
      logger.info(`⏭️  Public holidays already exist (${existingCount} holidays), skipping`);
      return;
    }

    // Helper function to get day name
    const getDayName = (date) => {
      const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      return days[date.getDay()];
    };

    // Australian public holidays for 2025-2026
    const holidays = [
      // 2025
      { date: new Date('2025-01-01'), name: "New Year's Day", state: 'ALL', country: 'AU' },
      { date: new Date('2025-01-27'), name: 'Australia Day', state: 'ALL', country: 'AU' },
      { date: new Date('2025-04-18'), name: 'Good Friday', state: 'ALL', country: 'AU' },
      { date: new Date('2025-04-19'), name: 'Saturday before Easter Sunday', state: 'ALL', country: 'AU' },
      { date: new Date('2025-04-21'), name: 'Easter Monday', state: 'ALL', country: 'AU' },
      { date: new Date('2025-04-25'), name: 'Anzac Day', state: 'ALL', country: 'AU' },
      { date: new Date('2025-06-09'), name: "Queen's Birthday", state: 'ALL', country: 'AU' },
      { date: new Date('2025-12-25'), name: 'Christmas Day', state: 'ALL', country: 'AU' },
      { date: new Date('2025-12-26'), name: 'Boxing Day', state: 'ALL', country: 'AU' },
      // 2026
      { date: new Date('2026-01-01'), name: "New Year's Day", state: 'ALL', country: 'AU' },
      { date: new Date('2026-01-26'), name: 'Australia Day', state: 'ALL', country: 'AU' },
      { date: new Date('2026-04-03'), name: 'Good Friday', state: 'ALL', country: 'AU' },
      { date: new Date('2026-04-04'), name: 'Saturday before Easter Sunday', state: 'ALL', country: 'AU' },
      { date: new Date('2026-04-06'), name: 'Easter Monday', state: 'ALL', country: 'AU' },
      { date: new Date('2026-04-25'), name: 'Anzac Day', state: 'ALL', country: 'AU' },
      { date: new Date('2026-06-08'), name: "Queen's Birthday", state: 'ALL', country: 'AU' },
      { date: new Date('2026-12-25'), name: 'Christmas Day', state: 'ALL', country: 'AU' },
      { date: new Date('2026-12-26'), name: 'Boxing Day', state: 'ALL', country: 'AU' },
    ].map(h => ({
      ...h,
      day: getDayName(h.date)
    }));

    await PublicHoliday.insertMany(holidays);
    logger.info(`✅ Seeded ${holidays.length} public holidays`);
  }

  async seedJobRoles() {
    logger.info('👔 Seeding job roles...');
    
    const existingCount = await this.db.collection('job_roles').countDocuments();
    if (existingCount > 0) {
      logger.info(`⏭️  Job roles already exist (${existingCount} roles), skipping`);
      return;
    }

    const jobRoles = [
      { code: 'SW', name: 'Support Worker', category: 'Care' },
      { code: 'RN', name: 'Registered Nurse', category: 'Healthcare' },
      { code: 'EN', name: 'Enrolled Nurse', category: 'Healthcare' },
      { code: 'OT', name: 'Occupational Therapist', category: 'Allied Health' },
      { code: 'PT', name: 'Physiotherapist', category: 'Allied Health' },
      { code: 'SP', name: 'Speech Pathologist', category: 'Allied Health' },
      { code: 'PSY', name: 'Psychologist', category: 'Allied Health' },
      { code: 'CM', name: 'Case Manager', category: 'Management' },
      { code: 'SC', name: 'Support Coordinator', category: 'Coordination' },
      { code: 'ADM', name: 'Administrator', category: 'Admin' },
    ];

    await this.db.collection('job_roles').insertMany(jobRoles);
    logger.info(`✅ Seeded ${jobRoles.length} job roles`);
  }

  async seedLeaveTypes() {
    logger.info('🏖️  Seeding leave types...');
    
    const existingCount = await this.db.collection('leave_types').countDocuments();
    if (existingCount > 0) {
      logger.info(`⏭️  Leave types already exist (${existingCount} types), skipping`);
      return;
    }

    const leaveTypes = [
      { code: 'ANNUAL', name: 'Annual Leave', accrualRate: 152, maxBalance: 304 },
      { code: 'SICK', name: 'Sick Leave', accrualRate: 76, maxBalance: 152 },
      { code: 'PERSONAL', name: 'Personal/Carer Leave', accrualRate: 76, maxBalance: 152 },
      { code: 'LONG_SERVICE', name: 'Long Service Leave', accrualRate: 0, maxBalance: 0 },
      { code: 'UNPAID', name: 'Unpaid Leave', accrualRate: 0, maxBalance: 0 },
      { code: 'COMPASSIONATE', name: 'Compassionate Leave', accrualRate: 0, maxBalance: 16 },
    ];

    await this.db.collection('leave_types').insertMany(leaveTypes);
    logger.info(`✅ Seeded ${leaveTypes.length} leave types`);
  }

  async createPerformanceIndexes() {
    logger.info('⚡ Creating performance indexes...');
    
    const indexes = [
      // Users - organization queries
      { collection: 'users', index: { organizationId: 1, isActive: 1 } },
      { collection: 'users', index: { email: 1, organizationId: 1 } },
      
      // UserOrganizations - relationship queries
      { collection: 'user_organizations', index: { userId: 1, organizationId: 1 }, unique: true },
      { collection: 'user_organizations', index: { organizationId: 1, role: 1, isActive: 1 } },
      
      // Clients - organization queries
      { collection: 'clients', index: { organizationId: 1, isActive: 1 } },
      { collection: 'clients', index: { clientEmail: 1, organizationId: 1 } },
      
      // Shifts - scheduling queries
      { collection: 'shifts', index: { organizationId: 1, startTime: -1, status: 1 } },
      { collection: 'shifts', index: { employeeId: 1, startTime: -1 } },
      { collection: 'shifts', index: { clientId: 1, startTime: -1 } },
      
      // Worked times - reporting queries
      { collection: 'worked_times', index: { organizationId: 1, workDate: -1 } },
      { collection: 'worked_times', index: { userEmail: 1, clientEmail: 1, workDate: -1 } },
      
      // Invoices - financial queries
      { collection: 'invoices', index: { organizationId: 1, 'workflow.status': 1 } },
      { collection: 'invoices', index: { organizationId: 1, 'payment.status': 1 } },
      { collection: 'invoices', index: { organizationId: 1, 'financialSummary.dueDate': 1 } },
      { collection: 'invoices', index: { clientEmail: 1, 'workflow.status': 1 } },
      
      // Expenses - approval queries
      { collection: 'expenses', index: { organizationId: 1, approvalStatus: 1 } },
      { collection: 'expenses', index: { organizationId: 1, expenseDate: -1 } },
      
      // Leave requests - approval queries
      { collection: 'leave_requests', index: { organizationId: 1, status: 1 } },
      { collection: 'leave_requests', index: { userId: 1, startDate: -1 } },
      
      // Audit logs - compliance queries
      { collection: 'audit_logs', index: { organizationId: 1, timestamp: -1 } },
      { collection: 'audit_logs', index: { entityType: 1, entityId: 1 } },
    ];

    let created = 0;
    for (const { collection, index, unique = false } of indexes) {
      try {
        await this.db.collection(collection).createIndex(index, { unique, background: true });
        created++;
        logger.info(`  ✅ ${collection}: ${JSON.stringify(index)}`);
      } catch (error) {
        if (error.code === 85 || error.code === 86) {
          logger.info(`  ⏭️  ${collection}: index already exists`);
        } else {
          logger.error(`  ❌ ${collection}: ${error.message}`);
        }
      }
    }

    logger.info(`✅ Created ${created} performance indexes\n`);
  }

  async verify() {
    logger.info('🔍 Verifying database setup...\n');
    
    const collections = await this.db.listCollections().toArray();
    logger.info(`Total collections: ${collections.length}`);
    
    // Use direct database queries instead of models for verification
    const supportItemsCount = await this.db.collection('support_items').countDocuments();
    logger.info(`NDIS support items: ${supportItemsCount}`);
    
    const holidaysCount = await this.db.collection('holidays').countDocuments();
    logger.info(`Public holidays: ${holidaysCount}`);
    
    const jobRolesCount = await this.db.collection('job_roles').countDocuments();
    logger.info(`Job roles: ${jobRolesCount}`);
    
    const leaveTypesCount = await this.db.collection('leave_types').countDocuments();
    logger.info(`Leave types: ${leaveTypesCount}`);
    
    logger.info('\n✅ Database verification complete');
  }

  async close() {
    if (this.client) {
      await this.client.close();
    }
    if (mongoose.connection) {
      await mongoose.connection.close();
    }
    logger.info('🔌 Disconnected from MongoDB');
  }

  async run() {
    try {
      logger.info('🚀 Starting fresh database initialization...\n');
      
      await this.connect();
      await this.createCollections();
      await this.seedNDISItems();
      await this.seedPublicHolidays();
      await this.seedJobRoles();
      await this.seedLeaveTypes();
      await this.createPerformanceIndexes();
      await this.verify();
      
      logger.info('\n🎉 Fresh database initialization complete!');
      logger.info('✅ Your database is ready for first-time use.\n');
      
      process.exit(0);
    } catch (error) {
      logger.error('❌ Initialization failed:', error);
      process.exit(1);
    } finally {
      await this.close();
    }
  }
}

// Run if called directly
if (require.main === module) {
  const initializer = new FreshDatabaseInitializer();
  initializer.run();
}

module.exports = FreshDatabaseInitializer;
