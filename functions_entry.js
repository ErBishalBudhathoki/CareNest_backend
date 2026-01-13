const { onRequest } = require('firebase-functions/v2/https');
const { setGlobalOptions } = require('firebase-functions/v2');
const app = require('./server');
const { keepAliveService } = require('./utils/keepAlive');

// Set global options for 2nd Gen functions
setGlobalOptions({ region: 'australia-southeast1' });

// Initialize keep-alive service if in production
if (process.env.NODE_ENV === 'production') {
  // Use the Firebase Hosting URL or Cloud Function URL
  // Ideally set BACKEND_URL in environment variables
  keepAliveService.initialize();
}

// Create and export the HTTPS function
// This exposes the Express app as a Cloud Function named 'api'
// Deployed to australia-southeast1 (Sydney)
exports.api = onRequest(app);
