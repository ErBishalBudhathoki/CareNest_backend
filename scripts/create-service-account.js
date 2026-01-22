const fs = require('fs');
const path = require('path');

function formatPrivateKey(key) {
  if (!key) return undefined;

  // 1. Initial Cleanup
  key = key.trim();

  // Remove surrounding quotes if present
  if ((key.startsWith('"') && key.endsWith('"')) || (key.startsWith("'") && key.endsWith("'"))) {
    key = key.slice(1, -1).trim();
  }

  // Handle escaped newlines (common in JSON/Env vars)
  // Replace \\n with \n
  while (key.includes('\\\\n')) {
    key = key.replace(/\\\\n/g, '\\n');
  }
  // Replace \n with actual newline
  if (key.includes('\\n')) {
    key = key.replace(/\\n/g, '\n');
  }
  // Normalize Windows newlines
  key = key.replace(/\r\n/g, '\n');
  key = key.replace(/\\r/g, '');

  // 2. Aggressive Reformatting
  // This approach extracts the body, strips ALL whitespace from it, and reconstructs the key.
  // It handles:
  // - Space-separated keys
  // - Keys with mixed newlines/spaces
  // - Keys with broken headers

  const beginTag = '-----BEGIN PRIVATE KEY-----';
  const endTag = '-----END PRIVATE KEY-----';

  if (key.includes(beginTag) && key.includes(endTag)) {
    // Extract body
    let body = key;
    body = body.replace(beginTag, '');
    body = body.replace(endTag, '');

    // Strip all whitespace (spaces, tabs, newlines)
    body = body.replace(/\s+/g, '');

    // Split into 64-character lines (PEM standard)
    const lines = body.match(/.{1,64}/g) || [];

    // Reconstruct with proper line breaks
    return `${beginTag}\n${lines.join('\n')}\n${endTag}`;
  }

  return key;
}

let privateKey = formatPrivateKey(process.env.FIREBASE_PRIVATE_KEY);

if (!privateKey) {
  console.error('Error: FIREBASE_PRIVATE_KEY environment variable is missing or empty.');
  process.exit(1);
}

if (!privateKey.includes('-----BEGIN PRIVATE KEY-----') || !privateKey.includes('-----END PRIVATE KEY-----')) {
  console.error('Error: FIREBASE_PRIVATE_KEY is not a valid PEM key. Ensure it includes the BEGIN/END lines.');
  process.exit(1);
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
