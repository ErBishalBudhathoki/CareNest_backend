const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
const path = require('path');
const fs = require('fs');
const logger = require('../config/logger');
const catchAsync = require('../utils/catchAsync');

let r2Client = null;

function getR2Client() {
  if (r2Client) return r2Client;
  if (
    !process.env.R2_ACCOUNT_ID ||
    !process.env.R2_ACCESS_KEY_ID ||
    !process.env.R2_SECRET_ACCESS_KEY
  ) {
    return null;
  }

  r2Client = new S3Client({
    region: 'auto',
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY
    }
  });

  return r2Client;
}

function isR2ApiHost(hostname) {
  return /\.r2\.cloudflarestorage\.com$/i.test(hostname);
}

function parseDownloadUrl(rawUrl) {
  try {
    return new URL(rawUrl);
  } catch {
    return null;
  }
}

function setDownloadHeaders(res, fileName, contentType, contentLength) {
  if (contentType) {
    res.setHeader('Content-Type', contentType);
  } else {
    res.setHeader('Content-Type', 'application/octet-stream');
  }
  if (contentLength != null) {
    res.setHeader('Content-Length', String(contentLength));
  }
  // Inline so images open naturally in browser/PDF viewers.
  res.setHeader(
    'Content-Disposition',
    `inline; filename="${fileName.replace(/"/g, '')}"`
  );
}

exports.downloadFile = catchAsync(async (req, res) => {
  const sourceUrl = String(req.query.url || '').trim();
  if (!sourceUrl) {
    return res.status(400).json({
      success: false,
      message: 'Missing required query parameter: url'
    });
  }

  const parsed = parseDownloadUrl(sourceUrl);
  if (!parsed || !['http:', 'https:'].includes(parsed.protocol)) {
    return res.status(400).json({
      success: false,
      message: 'Invalid download URL'
    });
  }

  const fileName = decodeURIComponent(path.basename(parsed.pathname || 'file')) || 'file';

  // Local uploads support.
  if (parsed.pathname.startsWith('/uploads/')) {
    const relativePath = parsed.pathname.replace(/^\/uploads\//, '');
    const localPath = path.join(__dirname, '..', 'uploads', relativePath);
    if (!localPath.startsWith(path.join(__dirname, '..', 'uploads'))) {
      return res.status(400).json({ success: false, message: 'Invalid file path' });
    }
    if (!fs.existsSync(localPath)) {
      return res.status(404).json({ success: false, message: 'File not found' });
    }
    return res.sendFile(localPath);
  }

  // Private R2 API endpoint support (requires server-side credentials).
  if (isR2ApiHost(parsed.hostname)) {
    const client = getR2Client();
    if (!client) {
      return res.status(500).json({
        success: false,
        message: 'R2 credentials are not configured on server'
      });
    }

    const key = parsed.pathname.replace(/^\/+/, '');
    if (!key) {
      return res.status(400).json({ success: false, message: 'Invalid R2 object key' });
    }

    const bucket = process.env.R2_BUCKET_NAME;
    if (!bucket) {
      return res.status(500).json({
        success: false,
        message: 'R2 bucket is not configured on server'
      });
    }

    try {
      const object = await client.send(
        new GetObjectCommand({
          Bucket: bucket,
          Key: key
        })
      );

      setDownloadHeaders(
        res,
        fileName,
        object.ContentType,
        object.ContentLength
      );

      if (!object.Body || typeof object.Body.pipe !== 'function') {
        return res.status(500).json({
          success: false,
          message: 'Unexpected R2 response stream'
        });
      }

      object.Body.pipe(res);
      return;
    } catch (error) {
      logger.error('Failed to fetch R2 object via files/download proxy', {
        error: error.message,
        bucket,
        key
      });
      return res.status(404).json({
        success: false,
        message: 'File not found or inaccessible'
      });
    }
  }

  return res.status(400).json({
    success: false,
    message: 'Unsupported file host for download proxy'
  });
});

