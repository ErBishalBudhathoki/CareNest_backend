const fs = require('fs');
const path = require('path');

function formatPrivateKey(key) {
  if (!key) return undefined;
  
  // Remove any surrounding quotes (common copy-paste error)
  if (key.startsWith('"') && key.endsWith('"')) {
    key = key.slice(1, -1);
  }

  // Debug: Log the first few chars to check what we're receiving (Safe to log header)
  // console.log('DEBUG: Raw key start:', JSON.stringify(key.substring(0, 50)));
  
  // Replace double escaped newlines (\\n) with single escaped newlines (\n)
  // Sometimes CI/CD pipelines double-escape them.
  // We do this loop to ensure we catch all levels of escaping if necessary, 
  // but typically one pass of replace all \\n with \n is enough for standard literal strings.
  // However, if the input is ALREADY a real newline, we don't want to break it.
  
  // If the key contains literal "\n" characters (2 chars), replace them with actual newline (1 char)
  if (key.includes('\\n')) {
     key = key.replace(/\\n/g, '\n');
  }

  return key;
}

const privateKey = formatPrivateKey(process.env.FIREBASE_PRIVATE_KEY);

if (!privateKey) {
  console.error('Error: FIREBASE_PRIVATE_KEY environment variable is missing or empty.');
  process.exit(1);
}

if (!privateKey.includes('-----BEGIN PRIVATE KEY-----')) {
  console.error('Error: FIREBASE_PRIVATE_KEY does not appear to be a valid PEM key (missing header).');
  // Don't exit, just warn, in case it's a weird format but valid for gcloud
}

const serviceAccount = {
  type: "service_account",
  project_id: process.env.FIREBASE_PROJECT_ID,
  private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
  private_key: privateKey,
  client_email: process.env.FIREBASE_CLIENT_EMAIL,
  client_id: process.env.FIREBASE_CLIENT_ID,
  auth_uri: "https://accounts.google.com/o/oauth2/auth",
  token_uri: "https://oauth2.googleapis.com/token",
  auth_provider_x509_cert_url: "https://www.googleapis.com/oauth2/v1/certs",
  client_x509_cert_url: process.env.FIREBASE_CLIENT_CERT_URL
};

const outputPath = path.join(__dirname, '..', 'service-account.json');
fs.writeFileSync(outputPath, JSON.stringify(serviceAccount, null, 2));
console.log(`Created service-account.json at ${outputPath}`);
