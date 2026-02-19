#!/usr/bin/env node

/**
 * Google Cloud Secret Manager Upload Script
 * 
 * This script uploads the consolidated secrets from secrets.json to Google Cloud Secret Manager.
 * It creates/updates ONE secret per environment (max 6 secrets total):
 * 
 * Development (invoice-660f3):
 * - app-secrets-dev (all dev secrets as JSON)
 * 
 * Production (carenest-prod):
 * - app-secrets-prod (all prod secrets as JSON)
 * 
 * Usage:
 *   npm run secrets:upload:dev    # Upload dev secrets
 *   npm run secrets:upload:prod   # Upload prod secrets
 *   npm run secrets:upload:all    # Upload both
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
    secretName: 'app-secrets-dev',
    account: 'deverbishal331@gmail.com'
  },
  production: {
    projectId: 'carenest-prod',
    secretName: 'app-secrets-prod',
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
    log(`Creating new secret: ${secretName}...`, 'cyan');
    
    await execAsync(
      `gcloud secrets create ${secretName} \
        --replication-policy="automatic" \
        --project=${projectId}`
    );
    
    log(`✓ Secret created: ${secretName}`, 'green');
    return true;
  } catch (error) {
    log(`Error creating secret: ${error.message}`, 'red');
    return false;
  }
}

/**
 * Add a new version to an existing secret
 */
async function addSecretVersion(secretName, secretData, projectId) {
  try {
    log(`Adding new version to secret: ${secretName}...`, 'cyan');
    
    // Write secret data to temporary file
    const tempFile = path.join(__dirname, `.temp-secret-${Date.now()}.json`);
    fs.writeFileSync(tempFile, JSON.stringify(secretData, null, 2));
    
    try {
      await execAsync(
        `gcloud secrets versions add ${secretName} \
          --data-file="${tempFile}" \
          --project=${projectId}`
      );
      
      log(`✓ New version added to: ${secretName}`, 'green');
    } finally {
      // Clean up temp file
      if (fs.existsSync(tempFile)) {
        fs.unlinkSync(tempFile);
      }
    }
    
    return true;
  } catch (error) {
    log(`Error adding secret version: ${error.message}`, 'red');
    return false;
  }
}

/**
 * Upload secrets for a specific environment
 */
async function uploadSecretsForEnvironment(environment, secrets) {
  const config = ENVIRONMENTS[environment];
  
  if (!config) {
    log(`Error: Unknown environment "${environment}"`, 'red');
    return false;
  }
  
  logSection(`Uploading ${environment.toUpperCase()} Secrets`);
  
  log(`Project ID: ${config.projectId}`, 'cyan');
  log(`Secret Name: ${config.secretName}`, 'cyan');
  log(`Account: ${config.account}`, 'cyan');
  
  // Check gcloud authentication
  const isAuthenticated = await checkGcloudAuth(config.projectId);
  if (!isAuthenticated) {
    return false;
  }
  
  // Get environment secrets
  const envSecrets = secrets[environment];
  const secretCount = Object.keys(envSecrets).length;
  
  log(`\nSecret contains ${secretCount} keys`, 'blue');
  
  // Check if secret exists
  const exists = await secretExists(config.secretName, config.projectId);
  
  if (!exists) {
    // Create new secret
    const created = await createSecret(config.secretName, config.projectId);
    if (!created) {
      return false;
    }
  } else {
    log(`Secret already exists: ${config.secretName}`, 'yellow');
  }
  
  // Add new version with updated data
  const uploaded = await addSecretVersion(
    config.secretName,
    envSecrets,
    config.projectId
  );
  
  if (uploaded) {
    log(`\n✓ Successfully uploaded ${environment} secrets!`, 'green');
    log(`Secret: ${config.secretName}`, 'cyan');
    log(`Project: ${config.projectId}`, 'cyan');
    return true;
  }
  
  return false;
}

/**
 * List current secret versions
 */
async function listSecretVersions(environment) {
  const config = ENVIRONMENTS[environment];
  
  if (!config) {
    return;
  }
  
  try {
    logSection(`Current Versions - ${environment.toUpperCase()}`);
    
    const { stdout } = await execAsync(
      `gcloud secrets versions list ${config.secretName} \
        --project=${config.projectId} \
        --limit=5 \
        --format="table(name,state,createTime)"`
    );
    
    console.log(stdout);
  } catch (error) {
    log('No versions found or secret does not exist', 'yellow');
  }
}

/**
 * Grant access to the secret for Cloud Run service account
 */
async function grantSecretAccess(environment) {
  const config = ENVIRONMENTS[environment];
  
  try {
    log(`\nGranting access to Cloud Run service account...`, 'cyan');
    
    // Default compute service account for Cloud Run
    const serviceAccount = `${config.projectId}@appspot.gserviceaccount.com`;
    
    await execAsync(
      `gcloud secrets add-iam-policy-binding ${config.secretName} \
        --member="serviceAccount:${serviceAccount}" \
        --role="roles/secretmanager.secretAccessor" \
        --project=${config.projectId}`
    );
    
    log(`✓ Access granted to: ${serviceAccount}`, 'green');
  } catch (error) {
    log(`Warning: Could not grant access (might already exist): ${error.message}`, 'yellow');
  }
}

/**
 * Main function
 */
async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || 'help';
  
  logSection('Google Cloud Secret Manager Upload');
  
  if (command === 'help' || command === '--help' || command === '-h') {
    console.log('Usage:');
    console.log('  npm run secrets:upload:dev     # Upload development secrets');
    console.log('  npm run secrets:upload:prod    # Upload production secrets');
    console.log('  npm run secrets:upload:all     # Upload both environments');
    console.log('  npm run secrets:list:dev       # List dev secret versions');
    console.log('  npm run secrets:list:prod      # List prod secret versions');
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
      success = await uploadSecretsForEnvironment('development', secrets);
      if (success) {
        await grantSecretAccess('development');
        await listSecretVersions('development');
      }
      break;
      
    case 'prod':
    case 'production':
      success = await uploadSecretsForEnvironment('production', secrets);
      if (success) {
        await grantSecretAccess('production');
        await listSecretVersions('production');
      }
      break;
      
    case 'all':
      const devSuccess = await uploadSecretsForEnvironment('development', secrets);
      if (devSuccess) {
        await grantSecretAccess('development');
        await listSecretVersions('development');
      }
      
      const prodSuccess = await uploadSecretsForEnvironment('production', secrets);
      if (prodSuccess) {
        await grantSecretAccess('production');
        await listSecretVersions('production');
      }
      
      success = devSuccess && prodSuccess;
      break;
      
    case 'list-dev':
      await listSecretVersions('development');
      break;
      
    case 'list-prod':
      await listSecretVersions('production');
      break;
      
    default:
      log(`Unknown command: ${command}`, 'red');
      log('Run with "help" for usage information', 'yellow');
      success = false;
  }
  
  if (success) {
    logSection('Success!');
    log('Secrets have been uploaded to Google Cloud Secret Manager', 'green');
    log('\nNext steps:', 'bright');
    log('1. Update GitHub Actions workflows to use the consolidated secret', 'cyan');
    log('2. Deploy your application', 'cyan');
    log('3. Verify the application loads secrets correctly', 'cyan');
  } else {
    logSection('Upload Failed');
    log('Please check the errors above and try again', 'red');
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

module.exports = { uploadSecretsForEnvironment, loadSecrets };
