const fs = require('fs');
const path = require('path');

function formatPrivateKey(key) {
  if (!key) return undefined;
  
  key = key.trim();

  if ((key.startsWith('"') && key.endsWith('"')) || (key.startsWith("'") && key.endsWith("'"))) {
    key = key.slice(1, -1).trim();
  }

  while (key.includes('\\\\n')) {
    key = key.replace(/\\\\n/g, '\\n');
  }

  if (key.includes('\\n')) {
    key = key.replace(/\\n/g, '\n');
  }

  key = key.replace(/\r\n/g, '\n');
  key = key.replace(/\\r/g, '');

  // Fix for keys pasted with spaces instead of newlines
  const beginTag = '-----BEGIN PRIVATE KEY-----';
  const endTag = '-----END PRIVATE KEY-----';
  
  if (key.includes(beginTag) && key.includes(endTag) && !key.includes('\n')) {
    console.warn('Warning: Private key appears to be space-separated. Attempting to format...');
    key = key.replace(beginTag, beginTag + '\n');
    key = key.replace(endTag, '\n' + endTag);
    
    // Attempt to remove spaces from the body
    const parts = key.split(beginTag + '\n');
    if (parts.length > 1) {
      const bodyAndEnd = parts[1];
      const bodyParts = bodyAndEnd.split('\n' + endTag);
      if (bodyParts.length > 0) {
        let body = bodyParts[0];
        // Remove all spaces in the body
        body = body.replace(/ /g, '');
        key = beginTag + '\n' + body + '\n' + endTag;
      }
    }
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
