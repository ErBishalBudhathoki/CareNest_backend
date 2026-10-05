const admin = require('firebase-admin');

// firebase-admin v13+ dropped the legacy `admin.<service>()` namespace API from
// the package root. Only app lifecycle helpers are exported there now, so every
// call site inherited from v12 (admin.auth(), admin.messaging(), admin.appCheck(),
// admin.apps, admin.credential, ...) throws "is not a function" at runtime.
//
// Rather than rewriting ~50 call sites across 34 files, re-attach the v12-shaped
// surface here. This module is the single place every file imports `admin` from,
// so this restores the previous contract without touching call sites.
//
// Subpath modules are required lazily: firebase-admin/app-check transitively
// loads jwks-rsa, which is ESM-only and cannot be required inside Jest's CJS
// runtime. Deferring the require keeps test runs working.
function lazy(path, exportName) {
  return (...args) => require(path)[exportName](...args);
}

const LEGACY_NAMESPACE_SHIM = {
  apps: () => require('firebase-admin/app').getApps(),
  app: (name) => require('firebase-admin/app').getApp(name),
  auth: lazy('firebase-admin/auth', 'getAuth'),
  appCheck: lazy('firebase-admin/app-check', 'getAppCheck'),
  messaging: lazy('firebase-admin/messaging', 'getMessaging'),
  firestore: lazy('firebase-admin/firestore', 'getFirestore'),
  remoteConfig: lazy('firebase-admin/remote-config', 'getRemoteConfig'),
  storage: lazy('firebase-admin/storage', 'getStorage'),
  // `credential.cert` is the shape call sites use; v13+ exposes it as `cert`.
  credential: { cert: (...args) => admin.cert(...args) }
};

for (const [name, value] of Object.entries(LEGACY_NAMESPACE_SHIM)) {
  if (admin[name] === undefined) {
    Object.defineProperty(admin, name, {
      value,
      writable: true,
      configurable: true,
      enumerable: true
    });
  }
}

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
  if (admin.apps.length === 0) {
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
