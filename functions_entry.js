const functions = require('firebase-functions');
const app = require('./server');

// Create and export the HTTPS function
// This exposes the Express app as a Cloud Function named 'api'
// Deployed to australia-southeast1 (Sydney)
exports.api = functions.region('australia-southeast1').https.onRequest(app);
