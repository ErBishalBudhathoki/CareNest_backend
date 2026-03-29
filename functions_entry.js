const { onRequest } = require('firebase-functions/v2/https');
const { setGlobalOptions } = require('firebase-functions/v2');
const app = require('./app'); // Import app directly from app.js instead of server.js to avoid side-effects
const connectMongoose = require('./config/mongoose'); // Import DB connection

// Connect to MongoDB
connectMongoose();

// Set global options for 2nd Gen functions
setGlobalOptions({ region: 'australia-southeast1' });

// Create and export the HTTPS function
// This exposes the Express app as a Cloud Function named 'api'
// Deployed to australia-southeast1 (Sydney)
// Configured with increased limits for file uploads while still allowing scale-to-zero
exports.api = onRequest(
  {
    timeoutSeconds: 300,       // 5 minutes for large file uploads
    memory: '512MiB',          // Sufficient memory for file processing
    minInstances: 0,           // Match Cloud Run scale-to-zero behavior
    maxInstances: 10,          // Allow scaling under load
    cors: true,                // Enable CORS for cross-origin requests
  },
  app
);
