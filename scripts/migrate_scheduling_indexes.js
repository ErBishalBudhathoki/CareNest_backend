/**
 * MongoDB Index Migration for Scheduling Engine
 * 
 * Run this script to create required indexes for the scheduling feature.
 * 
 * Usage:
 *   cd /Users/bishal/Developer/invoice/backend
 *   node scripts/migrate_scheduling_indexes.js
 * 
 * Or run directly in MongoDB shell:
 *   mongosh "your-connection-string" --eval "$(cat scripts/migrate_scheduling_indexes.js)"
 */

const { MongoClient } = require('mongodb');
require('dotenv').config();

const uri = process.env.MONGODB_URI;
const DB_NAME = process.env.DB_NAME || 'Invoice';

async function createSchedulingIndexes() {
    const client = new MongoClient(uri);

    try {
        await client.connect();
        console.log('Connected to MongoDB');

        const db = client.db(DB_NAME);

        // Create 2dsphere index on users.location for distance queries
        console.log('Creating 2dsphere index on users.location...');
        try {
            await db.collection('users').createIndex(
                { location: '2dsphere' },
                {
                    name: 'location_geo_idx',
                    sparse: true // Only index documents that have the location field
                }
            );
            console.log('✓ users.location index created');
        } catch (e) {
            if (e.code === 85) {
                console.log('✓ users.location index already exists');
            } else {
                throw e;
            }
        }

        // Create 2dsphere index on shifts.location
        console.log('Creating 2dsphere index on shifts.location...');
        try {
            await db.collection('shifts').createIndex(
                { location: '2dsphere' },
                {
                    name: 'shift_location_geo_idx',
                    sparse: true
                }
            );
            console.log('✓ shifts.location index created');
        } catch (e) {
            if (e.code === 85) {
                console.log('✓ shifts.location index already exists');
            } else {
                throw e;
            }
        }

        // Create compound index for conflict detection
        console.log('Creating conflict detection index on shifts...');
        try {
            await db.collection('shifts').createIndex(
                { employeeId: 1, startTime: 1, endTime: 1, status: 1 },
                { name: 'conflict_check_idx' }
            );
            console.log('✓ shifts.conflict_check_idx created');
        } catch (e) {
            if (e.code === 85) {
                console.log('✓ shifts.conflict_check_idx already exists');
            } else {
                throw e;
            }
        }

        // Create index for organization queries
        console.log('Creating organization index on shifts...');
        try {
            await db.collection('shifts').createIndex(
                { organizationId: 1, startTime: 1, status: 1 },
                { name: 'org_shifts_idx' }
            );
            console.log('✓ shifts.org_shifts_idx created');
        } catch (e) {
            if (e.code === 85) {
                console.log('✓ shifts.org_shifts_idx already exists');
            } else {
                throw e;
            }
        }

        // Create indexes for roster templates
        console.log('Creating roster template indexes...');
        try {
            await db.collection('rosterTemplates').createIndex(
                { organizationId: 1, isActive: 1 },
                { name: 'org_active_idx' }
            );
            console.log('✓ rosterTemplates.org_active_idx created');
        } catch (e) {
            if (e.code === 85) {
                console.log('✓ rosterTemplates.org_active_idx already exists');
            } else {
                throw e;
            }
        }

        console.log('\n✅ All scheduling indexes created successfully!');
        console.log('\nNext steps:');
        console.log('1. Users can add location via: db.users.updateOne({ email: "user@email.com" }, { $set: { location: { type: "Point", coordinates: [longitude, latitude] }, skills: ["skill1", "skill2"] } })');
        console.log('2. Restart the backend server to use the new routes');

    } catch (error) {
        console.error('Error creating indexes:', error);
        process.exit(1);
    } finally {
        await client.close();
        console.log('\nDisconnected from MongoDB');
    }
}

createSchedulingIndexes();
