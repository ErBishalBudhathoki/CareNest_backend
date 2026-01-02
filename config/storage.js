const { S3Client } = require('@aws-sdk/client-s3');
const multer = require('multer');
const multerS3 = require('multer-s3');
const path = require('path');
const fs = require('fs');

// Ensure uploads directory exists for local fallback
const uploadDir = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

const isR2Configured = process.env.R2_ACCOUNT_ID &&
                       process.env.R2_ACCESS_KEY_ID &&
                       process.env.R2_SECRET_ACCESS_KEY &&
                       process.env.R2_BUCKET_NAME;

const fileFilter = (req, file, cb) => {
    // Check file type - allow images and PDF files
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/heif', 'image/heic', 'application/pdf'];
    
    console.log(`File upload attempt - Original name: ${file.originalname}, MIME type: ${file.mimetype}, Field name: ${file.fieldname}`);
    
    // Check MIME type first
    if (allowedTypes.includes(file.mimetype)) {
        console.log(`File accepted based on MIME type: ${file.mimetype}`);
        cb(null, true);
        return;
    }
    
    // Fallback: Check file extension for cases where MIME type detection fails
    const fileExtension = path.extname(file.originalname).toLowerCase();
    const allowedExtensions = ['.jpg', '.jpeg', '.png', '.heif', '.heic', '.pdf'];
    
    if (allowedExtensions.includes(fileExtension)) {
        console.log(`File accepted based on extension: ${fileExtension} (MIME type was: ${file.mimetype})`);
        cb(null, true);
    } else {
        console.log(`File rejected - MIME type: ${file.mimetype}, Extension: ${fileExtension}`);
        cb(new Error(`Invalid file type. Only JPEG, PNG, HEIF images and PDF files are allowed. Received: ${file.mimetype} with extension ${fileExtension}`));
    }
};

const limits = {
    fileSize: 10 * 1024 * 1024 // 10MB limit
};

let upload;
let s3Client;

if (isR2Configured) {
    console.log('Using Cloudflare R2 for storage');
    s3Client = new S3Client({
        region: 'auto',
        endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
        credentials: {
            accessKeyId: process.env.R2_ACCESS_KEY_ID,
            secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
        },
    });

    upload = multer({
        storage: multerS3({
            s3: s3Client,
            bucket: process.env.R2_BUCKET_NAME,
            contentType: multerS3.AUTO_CONTENT_TYPE,
            key: function (req, file, cb) {
                const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
                let folder = 'others';
                if (file.fieldname === 'logo') folder = 'logos';
                if (file.fieldname === 'receipt') folder = 'receipts';
                // For profile photos, store in 'profileImage' folder
                if (file.fieldname === 'photo') folder = 'profileImage';
                
                cb(null, `${folder}/${file.fieldname}-${uniqueSuffix}${path.extname(file.originalname)}`);
            }
        }),
        fileFilter: fileFilter,
        limits: limits
    });
} else {
    console.log('R2 credentials not found, falling back to local disk storage');
    // Fallback to disk storage
    const storage = multer.diskStorage({
        destination: "./uploads",
        filename: (req, file, cb) => {
            const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
            cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
        }
    });
    upload = multer({ 
        storage: storage,
        fileFilter: fileFilter,
        limits: limits
    });
}

module.exports = { upload, isR2Configured, s3Client };
