#!/usr/bin/env node

/**
 * Google Cloud Secret Manager Restoration Script
 * 
 * This script reads the consolidated secrets from secrets.json and restores
 * them as INDIVIDUAL secrets in Google Cloud Secret Manager.
 * 
 * This is required when Cloud Run services still have legacy bindings to 
 * individual secrets (e.g. MONGODB_URI) instead of just using the 
 * consolidated APP_SECRETS.
 * 
 * Usage:
 *   npm run secrets:restore:dev    # Restore dev secrets
 *   npm run secrets:restore:prod   # Restore prod secrets
 */

const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const util = require('util');

const execAsync = util.promisify(exec);

// Configuration
const SECRETS_FILE = path.join(__dirname, 'secrets.json');
const ENVIRONMENTS = {
  development: {
    projectId: 'invoice-660f3',
    account: 'deverbishal331@gmail.com'
  },
  production: {
    projectId: 'carenest-prod',
    account: 'erbishalb331@gmail.com'
  }
};

// Color console output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function logSection(title) {
  console.log('\n' + '='.repeat(60));
  log(title, 'bright');
  console.log('='.repeat(60) + '\n');
}

/**
 * Load secrets from secrets.json
 */
function loadSecrets() {
  try {
    if (!fs.existsSync(SECRETS_FILE)) {
      throw new Error(`Secrets file not found: ${SECRETS_FILE}`);
    }

    const content = fs.readFileSync(SECRETS_FILE, 'utf8');
    const secrets = JSON.parse(content);

    if (!secrets.development || !secrets.production) {
      throw new Error('secrets.json must contain "development" and "production" keys');
    }

    return secrets;
  } catch (error) {
    log(`Error loading secrets: ${error.message}`, 'red');
    process.exit(1);
  }
}

/**
 * Check if gcloud CLI is installed and authenticated
 */
async function checkGcloudAuth(projectId) {
  try {
    // Check if gcloud is installed
    await execAsync('gcloud --version');
    
    // Check current project
    const { stdout } = await execAsync('gcloud config get-value project');
    const currentProject = stdout.trim();
    
    log(`Current gcloud project: ${currentProject}`, 'cyan');
    
    if (currentProject !== projectId) {
      log(`Warning: Current project (${currentProject}) differs from target (${projectId})`, 'yellow');
      log(`Switching to project ${projectId}...`, 'yellow');
      await execAsync(`gcloud config set project ${projectId}`);
    }
    
    return true;
  } catch (error) {
    log('Error: gcloud CLI not found or not authenticated', 'red');
    log('Please install gcloud CLI and run: gcloud auth login', 'yellow');
    return false;
  }
}

// Legacy secret name mapping (Cloud Run expects these specific names)
const LEGACY_NAME_MAPPING = {
  // Database
  'MONGODB_URI': 'dev-mongodb-uri',
  'MONGOD_URI': 'dev-mongodb-uri', // Handle alternative key name
  'REDIS_URL': 'dev-redis-url',
  
  // Auth
  'JWT_SECRET': 'dev-jwt-secret',
  
  // Payment
  'STRIPE_SECRET_KEY': 'dev-stripe-secret',
  'STRIPE_WEBHOOK_SECRET': 'dev-stripe-webhook',
  
  // Email
  'SMTP_PASSWORD': 'dev-smtp-password',
  'APP_PASSWORD': 'dev-app-password',
  
  // Storage
  'R2_ACCESS_KEY_ID': 'dev-r2-access-key',
  'R2_SECRET_ACCESS_KEY': 'dev-r2-secret',
  
  // Firebase
  'FIREBASE_PRIVATE_KEY': 'dev-firebase-private-key',
  'FIREBASE_PRIVATE_KEY_ID': 'dev-firebase-private-key-id'
};

// Production mapping (assumed pattern, adjust if needed)
const PROD_LEGACY_NAME_MAPPING = {
  'MONGODB_URI': 'prod-mongodb-uri',
  'MONGOD_URI': 'prod-mongodb-uri', // Handle alternative key name
  'REDIS_URL': 'prod-redis-url',
  'JWT_SECRET': 'prod-jwt-secret',
  'STRIPE_SECRET_KEY': 'prod-stripe-secret',
  'STRIPE_WEBHOOK_SECRET': 'prod-stripe-webhook',
  'SMTP_PASSWORD': 'prod-smtp-password',
  'APP_PASSWORD': 'prod-app-password',
  'R2_ACCESS_KEY_ID': 'prod-r2-access-key',
  'R2_SECRET_ACCESS_KEY': 'prod-r2-secret',
  'FIREBASE_PRIVATE_KEY': 'prod-firebase-private-key',
  'FIREBASE_PRIVATE_KEY_ID': 'prod-firebase-private-key-id'
};

/**
 * Check if a secret exists
 */
async function secretExists(secretName, projectId) {
  try {
    await execAsync(
      `gcloud secrets describe ${secretName} --project=${projectId}`,
      { stdio: 'pipe' }
    );
    return true;
  } catch (error) {
    return false;
  }
}

/**
 * Create a new secret in Secret Manager
 */
async function createSecret(secretName, projectId) {
  try {
    // log(`Creating new secret: ${secretName}...`, 'cyan');
    
    await execAsync(
      `gcloud secrets create ${secretName} \
        --replication-policy="automatic" \
        --project=${projectId}`
    );
    
    // log(`✓ Secret created: ${secretName}`, 'green');
    return true;
  } catch (error) {
    if (error.message.includes('already exists')) {
        return true; 
    }
    log(`Error creating secret ${secretName}: ${error.message}`, 'red');
    return false;
  }
}

/**
 * Add a new version to an existing secret
 */
async function addSecretVersion(secretName, secretValue, projectId) {
  try {
    // Write secret data to temporary file to avoid command line length limits/escaping issues
    const tempFile = path.join(__dirname, `.temp-${secretName}-${Date.now()}.txt`);
    fs.writeFileSync(tempFile, String(secretValue));
    
    try {
      await execAsync(
        `gcloud secrets versions add ${secretName} \
          --data-file="${tempFile}" \
          --project=${projectId}`
      );
      
      process.stdout.write('.'); // Progress indicator
    } finally {
      // Clean up temp file
      if (fs.existsSync(tempFile)) {
        fs.unlinkSync(tempFile);
      }
    }
    
    return true;
  } catch (error) {
    log(`\nError adding version for ${secretName}: ${error.message}`, 'red');
    return false;
  }
}

/**
 * Grant access to the secret for Cloud Run service account
 */
async function grantSecretAccess(secretName, projectId) {
  try {
    // Default compute service account for Cloud Run
    const serviceAccount = `${projectId}@appspot.gserviceaccount.com`;
    
    await execAsync(
      `gcloud secrets add-iam-policy-binding ${secretName} \
        --member="serviceAccount:${serviceAccount}" \
        --role="roles/secretmanager.secretAccessor" \
        --project=${projectId}`
    );
    
    return true;
  } catch (error) {
    log(`\nWarning: Could not grant access for ${secretName}: ${error.message}`, 'yellow');
    return false;
  }
}

/**
 * Restore secrets for a specific environment
 */
async function restoreSecretsForEnvironment(environment, secrets) {
  const config = ENVIRONMENTS[environment];
  
  if (!config) {
    log(`Error: Unknown environment "${environment}"`, 'red');
    return false;
  }
  
  logSection(`Restoring INDIVIDUAL ${environment.toUpperCase()} Secrets`);
  
  log(`Project ID: ${config.projectId}`, 'cyan');
  log(`Account: ${config.account}`, 'cyan');
  
  // Check gcloud authentication
  const isAuthenticated = await checkGcloudAuth(config.projectId);
  if (!isAuthenticated) {
    return false;
  }
  
  // Get environment secrets
  const envSecrets = secrets[environment];
  const secretKeys = Object.keys(envSecrets);
  const secretCount = secretKeys.length;
  
  // Determine which mapping to use
  const mapping = environment === 'development' ? LEGACY_NAME_MAPPING : PROD_LEGACY_NAME_MAPPING;
  
  log(`\nFound ${secretCount} secrets in secrets.json.`, 'blue');
  log(`Restoring ONLY the ${Object.keys(mapping).length} legacy secrets required by Cloud Run...`, 'blue');
  
  let successCount = 0;
  let failCount = 0;
  let skippedCount = 0;

  for (const key of secretKeys) {
    const value = envSecrets[key];
    
    // Check if this secret has a legacy mapping
    const legacyName = mapping[key];
    
    if (!legacyName) {
        // Not a legacy secret, skip it
        continue;
    }
    
    log(`Restoring ${key} -> ${legacyName}...`, 'cyan');

    // 1. Create Secret (if not exists)
    const created = await createSecret(legacyName, config.projectId);
    if (!created) {
        failCount++;
        continue;
    }

    // 2. Add Version
    if (value === '' || value === null || value === undefined) {
        log(`Skipping empty secret: ${key}`, 'yellow');
        skippedCount++; 
        continue;
    }

    const versionAdded = await addSecretVersion(legacyName, value, config.projectId);
    if (!versionAdded) {
        failCount++;
        continue;
    }

    // 3. Grant Access
    await grantSecretAccess(legacyName, config.projectId);
    
    successCount++;
  }
  
  log(`\n\nResults:`, 'bright');
  log(`✓ Successfully restored: ${successCount}`, 'green');
  if (skippedCount > 0) log(`- Skipped (empty): ${skippedCount}`, 'yellow');
  if (failCount > 0) {
    log(`✗ Failed: ${failCount}`, 'red');
  }

  return failCount === 0;
}

/**
 * Main function
 */
async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || 'help';
  
  logSection('Google Cloud Secret Manager Restoration Tool');
  
  if (command === 'help' || command === '--help' || command === '-h') {
    console.log('Usage:');
    console.log('  npm run secrets:restore:dev     # Restore individual development secrets');
    console.log('  npm run secrets:restore:prod    # Restore individual production secrets');
    console.log('');
    return;
  }
  
  // Load secrets
  const secrets = loadSecrets();
  log('✓ Loaded secrets.json', 'green');
  
  let success = true;
  
  switch (command) {
    case 'dev':
    case 'development':
      success = await restoreSecretsForEnvironment('development', secrets);
      break;
      
    case 'prod':
    case 'production':
      success = await restoreSecretsForEnvironment('production', secrets);
      break;
      
    default:
      log(`Unknown command: ${command}`, 'red');
      log('Run with "help" for usage information', 'yellow');
      success = false;
  }
  
  if (success) {
    logSection('Success!');
    log('Individual secrets have been restored to Google Cloud Secret Manager.', 'green');
    log('Cloud Run services with legacy bindings should now deploy correctly.', 'green');
  } else {
    logSection('Restoration Completed with Errors');
    log('Some secrets failed to upload. Check the logs above.', 'yellow');
    process.exit(1);
  }
}

// Run the script
if (require.main === module) {
  main().catch(error => {
    log(`\nFatal error: ${error.message}`, 'red');
    console.error(error);
    process.exit(1);
  });
}
