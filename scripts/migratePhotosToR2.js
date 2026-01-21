const { MongoClient } = require('mongodb');
const { S3Client } = require('@aws-sdk/client-s3');
const { Upload } = require('@aws-sdk/lib-storage');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env.development') });

// Configuration
const MONGO_URI = process.env.MONGODB_URI;
const DB_NAME = "Invoice";
const COLLECTION_NAME = "login";

// R2 Configuration
const r2Client = new S3Client({
    region: 'auto',
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
});

const BUCKET_NAME = process.env.R2_BUCKET_NAME; // Using the single bucket
const PUBLIC_DOMAIN = process.env.R2_PUBLIC_DOMAIN;

async function migratePhotos() {
    console.log('Starting migration from MongoDB to R2...');
    
    const client = new MongoClient(MONGO_URI, { tls: true, family: 4 });
    
    try {
        await client.connect();
        console.log('Connected to MongoDB');
        
        const db = client.db(DB_NAME);
        const collection = db.collection(COLLECTION_NAME);
        
        // Find users with photoData but NO photoUrl (or we can migrate everyone to be safe)
        // Let's find users with photoData
        const users = await collection.find({ 
            photoData: { $exists: true, $ne: null },
            // Optional: skip if already has photoUrl? 
            // photoUrl: { $exists: false } 
        }).toArray();
        
        console.log(`Found ${users.length} users with photo blobs to migrate.`);
        
        let successCount = 0;
        let errorCount = 0;
        
        for (const user of users) {
            try {
                if (!user.photoData) continue;
                
                console.log(`Migrating user: ${user.email}`);
                
                // Decode base64
                const buffer = Buffer.from(user.photoData, 'base64');
                
                // Generate filename
                const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
                const ext = user.filename ? path.extname(user.filename) : '.jpg';
                const key = `profileImage/migrated-${user._id}-${uniqueSuffix}${ext}`;
                
                // Upload to R2
                const upload = new Upload({
                    client: r2Client,
                    params: {
                        Bucket: BUCKET_NAME,
                        Key: key,
                        Body: buffer,
                        ContentType: 'image/jpeg', // Assumption, or detect from buffer
                    },
                });
                
                await upload.done();
                
                // Construct URL
                let photoUrl;
                if (PUBLIC_DOMAIN) {
                    photoUrl = `${PUBLIC_DOMAIN}/${key}`;
                    if (!photoUrl.startsWith('http')) photoUrl = `https://${photoUrl}`;
                } else {
                    // Fallback to R2 dev URL if no public domain (though user has one)
                    photoUrl = `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${BUCKET_NAME}/${key}`;
                }
                
                // Update MongoDB
                await collection.updateOne(
                    { _id: user._id },
                    { 
                        $set: { photoUrl: photoUrl },
                        $unset: { photoData: "" } // Remove blob
                    }
                );
                
                console.log(`✅ Migrated ${user.email} -> ${photoUrl}`);
                successCount++;
                
            } catch (err) {
                console.error(`❌ Failed to migrate ${user.email}:`, err);
                errorCount++;
            }
        }
        
        console.log('-----------------------------------');
        console.log(`Migration Complete.`);
        console.log(`Success: ${successCount}`);
        console.log(`Errors: ${errorCount}`);
        
    } catch (err) {
        console.error('Migration failed:', err);
    } finally {
        await client.close();
    }
}

migratePhotos();
