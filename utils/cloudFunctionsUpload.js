/**
 * Cloud Functions compatible file upload handler
 * Uses busboy directly with req.rawBody for Firebase/GCP Cloud Functions
 */

const Busboy = require('busboy');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const path = require('path');
const fs = require('fs');
const { Readable } = require('stream');

// Ensure uploads directory exists for local fallback
const uploadDir = path.join(__dirname, '../uploads');
if (process.env.SERVERLESS !== 'true' && !fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

// Check if R2 is configured
const isR2Configured = () => {
    return process.env.R2_ACCOUNT_ID &&
        process.env.R2_ACCESS_KEY_ID &&
        process.env.R2_SECRET_ACCESS_KEY &&
        process.env.R2_BUCKET_NAME;
};

// Get S3 client for R2
let s3Client = null;
const getS3Client = () => {
    if (!s3Client && isR2Configured()) {
        s3Client = new S3Client({
            region: 'auto',
            endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
            credentials: {
                accessKeyId: process.env.R2_ACCESS_KEY_ID,
                secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
            },
        });
    }
    return s3Client;
};

// Allowed file types
const allowedMimeTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/heif', 'image/heic', 'application/pdf'];
const allowedExtensions = ['.jpg', '.jpeg', '.png', '.heif', '.heic', '.pdf'];
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

/**
 * Parse multipart form data using busboy with rawBody support
 * Works in Firebase Cloud Functions where req.rawBody contains the buffered body
 */
function parseMultipartForm(req) {
    return new Promise((resolve, reject) => {
        const contentType = req.headers['content-type'];
        if (!contentType || !contentType.includes('multipart/form-data')) {
            return reject(new Error('Content-Type must be multipart/form-data'));
        }

        const busboy = Busboy({
            headers: req.headers,
            limits: {
                fileSize: MAX_FILE_SIZE,
                files: 1
            }
        });

        const result = {
            file: null,
            fields: {}
        };

        busboy.on('file', (fieldname, fileStream, info) => {
            const { filename, encoding, mimeType } = info;
            console.log(`📁 Parsing file: ${filename}, field: ${fieldname}, mime: ${mimeType}`);

            // Validate file type
            const fileExtension = path.extname(filename).toLowerCase();
            const isValidMime = allowedMimeTypes.includes(mimeType);
            const isValidExt = allowedExtensions.includes(fileExtension);

            if (!isValidMime && !isValidExt) {
                console.log(`❌ File rejected - MIME: ${mimeType}, Extension: ${fileExtension}`);
                fileStream.resume(); // Drain the stream
                return reject(new Error(`Invalid file type. Only JPEG, PNG, HEIF images and PDF files are allowed.`));
            }

            const chunks = [];
            let fileSize = 0;

            fileStream.on('data', (chunk) => {
                fileSize += chunk.length;
                if (fileSize > MAX_FILE_SIZE) {
                    fileStream.destroy(new Error('File size exceeds 10MB limit'));
                    return;
                }
                chunks.push(chunk);
            });

            fileStream.on('end', () => {
                result.file = {
                    fieldname,
                    originalname: filename,
                    encoding,
                    mimetype: mimeType,
                    buffer: Buffer.concat(chunks),
                    size: fileSize
                };
                console.log(`✅ File parsed: ${filename}, size: ${fileSize} bytes`);
            });

            fileStream.on('error', (err) => {
                console.error('❌ File stream error:', err);
                reject(err);
            });
        });

        busboy.on('field', (name, value) => {
            result.fields[name] = value;
        });

        busboy.on('finish', () => {
            console.log('✅ Busboy parsing finished');
            resolve(result);
        });

        busboy.on('error', (err) => {
            console.error('❌ Busboy error:', err);
            reject(err);
        });

        // Firebase Cloud Functions stores the raw body in req.rawBody
        // Regular Express stores it in req.body or needs piping
        if (req.rawBody) {
            console.log('📦 Using req.rawBody (Cloud Functions mode)');
            busboy.end(req.rawBody);
        } else if (req.body && Buffer.isBuffer(req.body)) {
            console.log('📦 Using req.body buffer');
            busboy.end(req.body);
        } else {
            console.log('📦 Using stream piping (standard mode)');
            req.pipe(busboy);
        }
    });
}

/**
 * Upload file buffer to Cloudflare R2
 */
async function uploadToR2(fileBuffer, originalFilename, fieldname) {
    const client = getS3Client();
    if (!client) {
        throw new Error('R2 is not configured');
    }

    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    let folder = 'others';
    if (fieldname === 'logo') folder = 'logos';
    if (fieldname === 'receipt') folder = 'receipts';
    if (fieldname === 'certification') folder = 'certifications';
    if (fieldname === 'photo') folder = 'profileImage';

    const extension = path.extname(originalFilename);
    const key = `${folder}/${fieldname}-${uniqueSuffix}${extension}`;

    console.log(`☁️ Uploading to R2: ${key}`);

    const command = new PutObjectCommand({
        Bucket: process.env.R2_BUCKET_NAME,
        Key: key,
        Body: fileBuffer,
        ContentType: getMimeType(extension)
    });

    await client.send(command);

    // Build public URL
    let publicUrl;
    if (process.env.R2_PUBLIC_DOMAIN) {
        publicUrl = `https://${process.env.R2_PUBLIC_DOMAIN.replace(/^https?:\/\//, '')}/${key}`;
    } else {
        publicUrl = `https://${process.env.R2_BUCKET_NAME}.${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${key}`;
    }

    console.log(`✅ Uploaded to R2: ${publicUrl}`);

    return {
        key,
        location: publicUrl
    };
}

/**
 * Save file to local disk (fallback)
 */
async function saveToLocalDisk(fileBuffer, originalFilename, fieldname) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const extension = path.extname(originalFilename);
    const filename = `${fieldname}-${uniqueSuffix}${extension}`;
    const filepath = path.join(uploadDir, filename);

    await fs.promises.writeFile(filepath, fileBuffer);
    console.log(`💾 Saved to local disk: ${filepath}`);

    return {
        filename,
        path: filepath
    };
}

/**
 * Get MIME type from extension
 */
function getMimeType(ext) {
    const mimeTypes = {
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.png': 'image/png',
        '.heif': 'image/heif',
        '.heic': 'image/heic',
        '.pdf': 'application/pdf'
    };
    return mimeTypes[ext.toLowerCase()] || 'application/octet-stream';
}

/**
 * Handle file upload - works with both Cloud Functions and regular Express
 */
async function handleFileUpload(req, fieldname = 'receipt') {
    console.log('🚀 Starting Cloud Functions compatible upload...');

    // Parse the multipart form
    const formData = await parseMultipartForm(req);

    if (!formData.file) {
        throw new Error('No file uploaded');
    }

    if (formData.file.fieldname !== fieldname) {
        console.log(`⚠️ Expected field '${fieldname}' but got '${formData.file.fieldname}'`);
    }

    let result;

    if (isR2Configured()) {
        console.log('☁️ Uploading to Cloudflare R2...');
        const r2Result = await uploadToR2(
            formData.file.buffer,
            formData.file.originalname,
            formData.file.fieldname
        );

        result = {
            success: true,
            fileUrl: r2Result.location,
            filename: r2Result.key,
            originalName: formData.file.originalname,
            size: formData.file.size,
            storage: 'r2'
        };
    } else {
        console.log('💾 Saving to local disk (R2 not configured)...');
        const localResult = await saveToLocalDisk(
            formData.file.buffer,
            formData.file.originalname,
            formData.file.fieldname
        );

        result = {
            success: true,
            fileUrl: `/uploads/${localResult.filename}`,
            filename: localResult.filename,
            originalName: formData.file.originalname,
            size: formData.file.size,
            storage: 'local'
        };
    }

    return {
        ...result,
        fields: formData.fields
    };
}

module.exports = {
    handleFileUpload,
    parseMultipartForm,
    uploadToR2,
    saveToLocalDisk,
    isR2Configured
};
