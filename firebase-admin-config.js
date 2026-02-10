const admin = require('firebase-admin');

function formatPrivateKey(key) {
  if (!key) return undefined;
  let cleaned = String(key).trim();
  if ((cleaned.startsWith('"') && cleaned.endsWith('"')) || (cleaned.startsWith("'") && cleaned.endsWith("'"))) {
    cleaned = cleaned.slice(1, -1).trim();
  }
  cleaned = cleaned.replace(/\\n/g, '\n').replace(/\n/g, '\n');
  cleaned = cleaned.replace(/\r\n/g, '\n').replace(/\r/g, '');
  return cleaned;
}

let initError;

try {
  if (!admin.apps.length) {
    if (process.env.FIREBASE_PRIVATE_KEY) {
      const serviceAccount = {
        type: 'service_account',
        project_id: process.env.FIREBASE_PROJECT_ID,
        private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
        private_key: formatPrivateKey(process.env.FIREBASE_PRIVATE_KEY),
        client_email: process.env.FIREBASE_CLIENT_EMAIL,
        client_id: process.env.FIREBASE_CLIENT_ID,
        auth_uri: process.env.FIREBASE_AUTH_URI || 'https://accounts.google.com/o/oauth2/auth',
        token_uri: process.env.FIREBASE_TOKEN_URI || 'https://oauth2.googleapis.com/token',
        auth_provider_x509_cert_url: process.env.FIREBASE_AUTH_CERT_URL || 'https://www.googleapis.com/oauth2/v1/certs',
        client_x509_cert_url: process.env.FIREBASE_CLIENT_CERT_URL,
        universe_domain: process.env.FIREBASE_UNIVERSE_DOMAIN || 'googleapis.com'
      };

      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
      });
    } else {
      admin.initializeApp();
    }
  }
} catch (error) {
  initError = error;
  console.error('Firebase Admin SDK initialization failed:', error.message);
}

let messaging;
if (!initError) {
  try {
    messaging = admin.messaging();
  } catch (error) {
    initError = error;
    console.error('Firebase messaging init failed:', error.message);
  }
}

if (!messaging) {
  messaging = {
    send: async () => {
      throw new Error('Firebase Admin SDK is not initialized');
    },
    sendEachForMulticast: async () => {
      throw new Error('Firebase Admin SDK is not initialized');
    },
    sendMulticast: async () => {
      throw new Error('Firebase Admin SDK is not initialized');
    }
  };
}

module.exports = { admin, messaging };

