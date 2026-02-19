const catchAsync = require('../utils/catchAsync');

class UploadController {
  uploadLogo = catchAsync(async (req, res) => {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No file uploaded'
      });
    }

    // Construct the file URL
    // If using R2/S3 (handled by multer-s3 in storage.js), req.file.location or req.file.key will be populated
    // If using local storage, req.file.filename will be populated
    
    let fileUrl;
    
    if (req.file.location) {
      // S3/R2 direct URL
      fileUrl = req.file.location;
    } else if (req.file.key) {
      // S3/R2 key - construct URL if location is missing (depends on multer-s3 version/config)
      // But storage.js logs key, so let's assume standard behavior or fallback
      // Ideally storage.js should return location. 
      // If we look at storage.js, it sets 'key'.
      // Usually multer-s3 adds 'location' to file object.
      fileUrl = req.file.location || req.file.key; 
    } else {
      // Local storage
      const protocol = req.protocol;
      const host = req.get('host');
      fileUrl = `${protocol}://${host}/uploads/${req.file.filename}`;
    }

    res.status(200).json({
      success: true,
      message: 'Logo uploaded successfully',
      fileUrl: fileUrl,
      data: {
        fileUrl: fileUrl
      }
    });
  });
}

module.exports = new UploadController();
