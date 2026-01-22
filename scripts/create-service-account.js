const fs = require('fs');
const path = require('path');

/**
 * Formats a private key from environment variable to proper PEM format.
 * Handles various escape patterns that can occur when passing keys through
 * GitHub Actions secrets and environment variables.
 */
function formatPrivateKey(key) {
  if (!key) return undefined;

  console.log('[DEBUG] Private key length before processing:', key.length);

  // 1. Initial Cleanup
  key = key.trim();

  // Remove surrounding quotes if present
  if ((key.startsWith('"') && key.endsWith('"')) || (key.startsWith("'") && key.endsWith("'"))) {
    key = key.slice(1, -1).trim();
    console.log('[DEBUG] Removed surrounding quotes');
  }

  // 2. Handle various newline escape patterns
  // Pattern: literal backslash + n (most common in GitHub secrets)
  const literalBackslashN = /\\n/g;
  if (literalBackslashN.test(key)) {
    console.log('[DEBUG] Found literal \\n patterns, replacing with actual newlines');
    key = key.replace(literalBackslashN, '\n');
  }

  // Pattern: double backslash + n (double-escaped)
  const doubleBackslashN = /\\\\n/g;
  if (doubleBackslashN.test(key)) {
    console.log('[DEBUG] Found double-escaped \\\\n patterns, replacing');
    key = key.replace(doubleBackslashN, '\n');
  }

  // Normalize Windows newlines
  key = key.replace(/\r\n/g, '\n');
  key = key.replace(/\r/g, '');

  // 3. PEM Key Reconstruction
  const beginTag = '-----BEGIN PRIVATE KEY-----';
  const endTag = '-----END PRIVATE KEY-----';

  console.log('[DEBUG] Key contains BEGIN tag:', key.includes(beginTag));
  console.log('[DEBUG] Key contains END tag:', key.includes(endTag));

  if (key.includes(beginTag) && key.includes(endTag)) {
    // Extract the body between the tags
    const beginIndex = key.indexOf(beginTag) + beginTag.length;
    const endIndex = key.indexOf(endTag);
    let body = key.substring(beginIndex, endIndex);

    // Strip all whitespace from body (spaces, tabs, newlines)
    body = body.replace(/\s+/g, '');

    console.log('[DEBUG] Extracted body length:', body.length);

    // Validate body is base64
    if (!/^[A-Za-z0-9+/=]+$/.test(body)) {
      console.error('[ERROR] Key body contains invalid characters (not base64)');
      console.error('[DEBUG] First 50 chars of body:', body.substring(0, 50));
    }

    // Split into 64-character lines (PEM standard format)
    const lines = body.match(/.{1,64}/g) || [];

    console.log('[DEBUG] Split into', lines.length, 'lines of 64 chars');

    // Reconstruct the properly formatted PEM key
    const formattedKey = `${beginTag}\n${lines.join('\n')}\n${endTag}\n`;

    console.log('[DEBUG] Final formatted key length:', formattedKey.length);
    return formattedKey;
  }

  // If we couldn't find the tags, return as-is (will fail validation later)
  console.log('[DEBUG] Could not find PEM tags, returning key as-is');
  return key;
}

// Process the private key
let privateKey = formatPrivateKey(process.env.FIREBASE_PRIVATE_KEY);

if (!privateKey) {
  console.error('Error: FIREBASE_PRIVATE_KEY environment variable is missing or empty.');
  process.exit(1);
}

if (!privateKey.includes('-----BEGIN PRIVATE KEY-----') || !privateKey.includes('-----END PRIVATE KEY-----')) {
  console.error('Error: FIREBASE_PRIVATE_KEY is not a valid PEM key. Ensure it includes the BEGIN/END lines.');
  process.exit(1);
}

// Build the service account object
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

// Write the service account JSON file
const outputPath = path.join(__dirname, '..', 'service-account.json');
const jsonContent = JSON.stringify(serviceAccount, null, 2);
fs.writeFileSync(outputPath, jsonContent);
console.log(`Created service-account.json at ${outputPath}`);

// Verify the output file exists and has content
const stats = fs.statSync(outputPath);
console.log(`[DEBUG] Output file size: ${stats.size} bytes`);

// Debug: Show the structure of the JSON (without revealing sensitive data)
console.log('[DEBUG] JSON structure check:');
console.log('  - type:', serviceAccount.type);
console.log('  - project_id length:', serviceAccount.project_id ? serviceAccount.project_id.length : 0);
console.log('  - private_key starts with:', privateKey.substring(0, 27));
console.log('  - private_key ends with:', privateKey.substring(privateKey.length - 26));
console.log('  - private_key newline count:', (privateKey.match(/\n/g) || []).length);

// Additional debug: Check the JSON file content for proper escaping
const writtenContent = fs.readFileSync(outputPath, 'utf8');
const privateKeyInJson = writtenContent.match(/"private_key":\s*"([^"]+)"/);
if (privateKeyInJson) {
  const escapedKey = privateKeyInJson[1];
  console.log('[DEBUG] private_key in JSON starts with:', escapedKey.substring(0, 40));
  console.log('[DEBUG] private_key in JSON contains \\n escapes:', escapedKey.includes('\\n'));
  console.log('[DEBUG] private_key in JSON escape count:', (escapedKey.match(/\\n/g) || []).length);
}
