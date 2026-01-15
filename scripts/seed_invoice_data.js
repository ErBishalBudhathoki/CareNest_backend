const { MongoClient, ObjectId } = require('mongodb');
const path = require('path');
const fs = require('fs');

// Try to load .env from backend directory
const envPath = path.resolve(__dirname, '../.env');
if (fs.existsSync(envPath)) {
    require('dotenv').config({ path: envPath });
} else {
    console.warn('Warning: backend/.env file not found at', envPath);
}

const uri = process.env.MONGODB_URI;
if (!uri) {
    console.error('Error: MONGODB_URI environment variable is not set.');
    process.exit(1);
}

const users = [
    {
        email: 'test1@tester.com',
        firstName: 'Test',
        lastName: 'User1',
        abn: '11223344556',
        organizationId: 'org_123',
        password: 'hashed_password_placeholder', // In a real scenario this should be hashed
        role: 'user'
    },
    {
        email: 'bishalkc331@gmail.com',
        firstName: 'Bishal',
        lastName: 'KC',
        abn: '99887766554',
        organizationId: 'org_123',
        password: 'hashed_password_placeholder',
        role: 'user'
    }
];

const clients = [
    {
        clientEmail: 'client1@test.com',
        clientFirstName: 'Client',
        clientLastName: 'One',
        organizationId: 'org_123'
    },
    {
        clientEmail: 'client2@test.com',
        clientFirstName: 'Client',
        clientLastName: 'Two',
        organizationId: 'org_123'
    }
];

// Helper to generate dates for last 7 days
function getRecentShiftDates(count = 5) {
    const dates = [];
    const today = new Date();
    for (let i = 0; i < count; i++) {
        const d = new Date(today);
        d.setDate(today.getDate() - i);
        dates.push(d.toISOString().split('T')[0]); // YYYY-MM-DD
    }
    return dates;
}

async function seed() {
    const client = new MongoClient(uri);

    try {
        await client.connect();
        console.log('Connected to MongoDB');
        const db = client.db('Invoice');

        // 1. Seed Users
        console.log('Seeding Users...');
        for (const user of users) {
            await db.collection('users').updateOne(
                { email: user.email },
                { $set: user },
                { upsert: true }
            );
        }

        // 2. Seed Clients
        console.log('Seeding Clients...');
        for (const clientData of clients) {
            await db.collection('clients').updateOne(
                { clientEmail: clientData.clientEmail },
                { $set: clientData },
                { upsert: true }
            );
        }

        // 3. Seed Assignments and Worked Time
        console.log('Seeding Assignments and Worked Time...');
        const userClientPairs = [
            { user: users[0].email, client: clients[0].clientEmail },
            { user: users[1].email, client: clients[1].clientEmail }
        ];

        for (const pair of userClientPairs) {
            // Create Assignment
            const schedule = getRecentShiftDates(3).map(date => ({
                date: date,
                startTime: '09:00 AM',
                endTime: '05:00 PM',
                break: '30'
            }));

            const assignmentResult = await db.collection('clientAssignments').updateOne(
                {
                    userEmail: pair.user,
                    clientEmail: pair.client,
                    isActive: true
                },
                {
                    $set: {
                        organizationId: 'org_123',
                        schedule: schedule,
                        updatedAt: new Date(),
                        // Legacy fields just in case
                        dateList: [],
                        startTimeList: [],
                        endTimeList: [],
                        breakList: []
                    },
                    $setOnInsert: {
                        createdAt: new Date(),
                        isActive: true
                    }
                },
                { upsert: true }
            );

            // Fetch the assignment ID (either updated or inserted)
            const assignment = await db.collection('clientAssignments').findOne({
                userEmail: pair.user,
                clientEmail: pair.client,
                isActive: true
            });

            // Create Worked Time Records for these shifts
            for (const shift of schedule) {
                await db.collection('workedTime').updateOne(
                    {
                        userEmail: pair.user,
                        clientEmail: pair.client,
                        shiftDate: shift.date,
                        shiftStartTime: shift.startTime
                    },
                    {
                        $set: {
                            timeWorked: '08:00:00', // 8 hours
                            shiftEndTime: shift.endTime,
                            shiftBreak: shift.break,
                            shiftIndex: 0, // Placeholder
                            assignedClientId: assignment._id,
                            shiftKey: `${shift.date}_${shift.startTime}`,
                            isActive: true,
                            updatedAt: new Date()
                        },
                        $setOnInsert: {
                            createdAt: new Date()
                        }
                    },
                    { upsert: true }
                );
            }
        }

        console.log('Seeding completed successfully!');

    } catch (error) {
        console.error('Seeding failed:', error);
    } finally {
        await client.close();
    }
}

seed();
