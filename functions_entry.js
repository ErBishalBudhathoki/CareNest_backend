const functions = require('firebase-functions');
const app = require('./server');

// Create and export the HTTPS function
// This exposes the Express app as a Cloud Function named 'api'
exports.api = functions.https.onRequest(app);
