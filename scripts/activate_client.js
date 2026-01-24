const { MongoClient } = require('mongodb');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/invoice-app';

async function activateClient() {
    const clientEmail = process.argv[2];
    const password = process.argv[3];

    if (!clientEmail || !password) {
        console.error('Usage: node scripts/activate_client.js <email> <password>');
        process.exit(1);
    }

    const client = new MongoClient(mongoUri);

    try {
        await client.connect();
        const db = client.db();
        console.log('Connected to DB');

        // 1. Check if client exists
        const clientRecord = await db.collection('clients').findOne({ clientEmail: clientEmail });
        if (!clientRecord) {
            console.error('Error: Client not found in "clients" collection.');
            process.exit(1);
        }

        // 2. Check if already activated
        const existingLogin = await db.collection('login').findOne({ email: clientEmail });
        if (existingLogin) {
            console.error('Error: Client already has a login account.');
            process.exit(1);
        }

        // 3. Create Login Record
        const salt = crypto.randomBytes(16).toString('hex');
        const hashedPassword = bcrypt.hashSync(password, 10);

        const newLogin = {
            email: clientEmail,
            password: hashedPassword,
            salt: salt,
            firstName: clientRecord.clientFirstName,
            lastName: clientRecord.clientLastName,
            organizationId: clientRecord.organizationId,
            role: 'client',
            clientId: clientRecord._id, // Link to client record
            createdAt: new Date(),
            lastLogin: null,
            isActive: true
        };

        await db.collection('login').insertOne(newLogin);
        console.log(`Success: Client account activated for ${clientEmail}`);
        console.log(`Role: client`);
        console.log(`Organization ID: ${clientRecord.organizationId}`);

    } catch (error) {
        console.error('Error:', error);
    } finally {
        await client.close();
    }
}

activateClient();
