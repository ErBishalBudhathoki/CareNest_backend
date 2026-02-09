#!/usr/bin/env node

/**
 * Google Cloud Secret Manager Cleanup Script
 * 
 * This script helps you safely delete old individual secrets after migrating
 * to the consolidated secrets approach.
 * 
 * IMPORTANT: Only run this AFTER verifying the new consolidated secrets work!
 * 
 * Usage:
 *   npm run secrets:cleanup:dev    # Clean up dev secrets
 *   npm run secrets:cleanup:prod   # Clean up prod secrets
 *   npm run secrets:cleanup:all    # Clean up both (dangerous!)
 */

const { exec } = require('child_process');
const util = require('util');
const readline = require('readline');

const execAsync = util.promisify(exec);

// Old individual secrets to delete
const OLD_SECRETS = {
  development: {
    projectId: 'invoice-660f3',
    secrets: [
      'dev-mongodb-uri',
      'dev-redis-url',
      'dev-jwt-secret',
      'dev-stripe-secret',
      'dev-stripe-webhook',
      'dev-smtp-password',
      'dev-app-password',
      'dev-r2-access-key',
      'dev-r2-secret',
      'dev-firebase-private-key',
      'dev-firebase-private-key-id'
    ]
  },
  production: {
    projectId: 'carenest-prod',
    secrets: [
      'prod-mongodb-uri',
      'prod-redis-url',
      'prod-jwt-secret',
      'prod-stripe-secret',
      'prod-stripe-webhook',
      'prod-smtp-password',
      'prod-app-password',
      'prod-r2-access-key',
      'prod-r2-secret',
      'prod-firebase-private-key',
      'prod-firebase-private-key-id'
    ]
  }
};

// Colors
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
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
 * Prompt user for confirmation
 */
function askQuestion(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise((resolve) => {
    rl.question(`${colors.yellow}${question}${colors.reset} `, (answer) => {
      rl.close();
      resolve(answer.toLowerCase().trim());
    });
  });
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
 * List all secrets in a project
 */
async function listAllSecrets(projectId) {
  try {
    const { stdout } = await execAsync(
      `gcloud secrets list --project=${projectId} --format="value(name)"`
    );
    return stdout.trim().split('\n').filter(s => s);
  } catch (error) {
    log(`Error listing secrets: ${error.message}`, 'red');
    return [];
  }
}

/**
 * Delete a secret
 */
async function deleteSecret(secretName, projectId, dryRun = false) {
  if (dryRun) {
    log(`[DRY RUN] Would delete: ${secretName}`, 'cyan');
    return true;
  }

  try {
    log(`Deleting: ${secretName}...`, 'cyan');
    await execAsync(
      `gcloud secrets delete ${secretName} --project=${projectId} --quiet`
    );
    log(`✓ Deleted: ${secretName}`, 'green');
    return true;
  } catch (error) {
    log(`✗ Failed to delete ${secretName}: ${error.message}`, 'red');
    return false;
  }
}

/**
 * Verify the new consolidated secret works
 */
async function verifyConsolidatedSecret(projectId, secretName) {
  try {
    log(`Verifying consolidated secret: ${secretName}...`, 'cyan');
    
    // Check secret exists
    const exists = await secretExists(secretName, projectId);
    if (!exists) {
      log(`✗ Consolidated secret ${secretName} does NOT exist!`, 'red');
      return false;
    }

    // Check it has a latest version
    const { stdout } = await execAsync(
      `gcloud secrets versions list ${secretName} --project=${projectId} --limit=1 --format="value(state)"`
    );
    
    if (stdout.trim().toUpperCase() !== 'ENABLED') {
      log(`✗ Latest version of ${secretName} is not enabled! Status: ${stdout.trim()}`, 'red');
      return false;
    }

    log(`✓ Consolidated secret ${secretName} verified`, 'green');
    return true;
  } catch (error) {
    log(`✗ Error verifying secret: ${error.message}`, 'red');
    return false;
  }
}

/**
 * Clean up secrets for an environment
 */
async function cleanupEnvironment(environment, dryRun = false) {
  const config = OLD_SECRETS[environment];
  
  if (!config) {
    log(`Unknown environment: ${environment}`, 'red');
    return false;
  }

  logSection(`Cleanup ${environment.toUpperCase()} Secrets ${dryRun ? '(DRY RUN)' : ''}`);
  
  log(`Project: ${config.projectId}`, 'cyan');
  log(`Secrets to delete: ${config.secrets.length}`, 'cyan');

  // Step 1: Verify consolidated secret exists and works
  const consolidatedSecretName = environment === 'development' ? 'app-secrets-dev' : 'app-secrets-prod';
  
  log('\nStep 1: Verifying consolidated secret...', 'bright');
  const verified = await verifyConsolidatedSecret(config.projectId, consolidatedSecretName);
  
  if (!verified) {
    log('\n⚠️  Consolidated secret verification FAILED!', 'red');
    log('DO NOT proceed with cleanup. Fix the consolidated secret first.', 'red');
    return false;
  }

  // Step 2: List existing old secrets
  log('\nStep 2: Finding old secrets to delete...', 'bright');
  const allSecrets = await listAllSecrets(config.projectId);
  const secretsToDelete = config.secrets.filter(s => allSecrets.includes(s));
  
  if (secretsToDelete.length === 0) {
    log('No old secrets found to delete!', 'yellow');
    return true;
  }

  log(`Found ${secretsToDelete.length} old secrets to delete:`, 'cyan');
  secretsToDelete.forEach(s => log(`  - ${s}`, 'cyan'));

  // Step 3: Confirm deletion
  if (!dryRun) {
    log('\n⚠️  WARNING: This will PERMANENTLY delete these secrets!', 'yellow');
    log('Make sure your application is running correctly with consolidated secrets.', 'yellow');
    
    const answer = await askQuestion('\nAre you sure you want to delete these secrets? (yes/no): ');
    
    if (answer !== 'yes') {
      log('\nCancelled. No secrets were deleted.', 'yellow');
      return false;
    }
  }

  // Step 4: Delete secrets
  log('\nStep 3: Deleting secrets...', 'bright');
  let successCount = 0;
  let failCount = 0;

  for (const secretName of secretsToDelete) {
    const success = await deleteSecret(secretName, config.projectId, dryRun);
    if (success) {
      successCount++;
    } else {
      failCount++;
    }
  }

  // Summary
  log('\n' + '='.repeat(60), 'bright');
  if (dryRun) {
    log(`DRY RUN Complete: Would delete ${successCount} secrets`, 'cyan');
  } else {
    log(`Successfully deleted: ${successCount}`, 'green');
    if (failCount > 0) {
      log(`Failed to delete: ${failCount}`, 'red');
    }
  }
  log('='.repeat(60), 'bright');

  return failCount === 0;
}

/**
 * Show pre-cleanup checklist
 */
function showChecklist(environment) {
  logSection('Pre-Cleanup Checklist');
  
  log('Before deleting old secrets, verify:', 'bright');
  console.log('');
  
  const checks = [
    '1. Consolidated secret uploaded successfully',
    '2. Application deployed with new workflow',
    '3. Application is running in Cloud Run',
    '4. Application logs show secrets loaded correctly',
    '5. All functionality tested and working',
    '6. No errors in Cloud Run logs'
  ];

  checks.forEach(check => {
    log(`  ${check}`, 'cyan');
  });

  console.log('');
  log('Verification commands:', 'bright');
  
  if (environment === 'development' || environment === 'all') {
    console.log('');
    log('Development:', 'yellow');
    log('  gcloud secrets describe app-secrets-dev --project=invoice-660f3', 'cyan');
    log('  gcloud logs tail --filter="SecretLoader" --project=invoice-660f3', 'cyan');
  }
  
  if (environment === 'production' || environment === 'all') {
    console.log('');
    log('Production:', 'yellow');
    log('  gcloud secrets describe app-secrets-prod --project=carenest-prod', 'cyan');
    log('  gcloud logs tail --filter="SecretLoader" --project=carenest-prod', 'cyan');
  }

  console.log('');
}

/**
 * Main function
 */
async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || 'help';
  const isDryRun = args.includes('--dry-run') || args.includes('-n');

  logSection('Google Cloud Secret Manager Cleanup');

  if (command === 'help' || command === '--help' || command === '-h') {
    console.log('Usage:');
    console.log('  npm run secrets:cleanup:dev           # Clean up development secrets');
    console.log('  npm run secrets:cleanup:prod          # Clean up production secrets');
    console.log('  npm run secrets:cleanup:all           # Clean up both (dangerous!)');
    console.log('');
    console.log('Options:');
    console.log('  --dry-run, -n                         # Show what would be deleted without deleting');
    console.log('');
    console.log('Examples:');
    console.log('  npm run secrets:cleanup:dev -- --dry-run    # Preview dev cleanup');
    console.log('  npm run secrets:cleanup:prod                # Actually delete prod secrets');
    console.log('');
    return;
  }

  // Show checklist first
  const env = command === 'dev' ? 'development' : command === 'prod' ? 'production' : 'all';
  showChecklist(env);

  // Ask for confirmation to proceed
  const proceedAnswer = await askQuestion('Have you completed the checklist above? (yes/no): ');
  if (proceedAnswer !== 'yes') {
    log('\nPlease complete the checklist before running cleanup.', 'yellow');
    log('You can run with --dry-run to see what would be deleted.', 'cyan');
    return;
  }

  let success = true;

  switch (command) {
    case 'dev':
    case 'development':
      success = await cleanupEnvironment('development', isDryRun);
      break;

    case 'prod':
    case 'production':
      log('\n⚠️  PRODUCTION CLEANUP - EXTRA CAUTION REQUIRED!', 'red');
      const confirmProd = await askQuestion('Type "DELETE PRODUCTION SECRETS" to confirm: ');
      
      if (confirmProd.trim() !== 'delete production secrets') {
        log('\nCancelled. No production secrets were deleted.', 'yellow');
        log(`You typed: "${confirmProd}"`, 'cyan');
        return;
      }
      
      success = await cleanupEnvironment('production', isDryRun);
      break;

    case 'all':
      log('\n⚠️  DELETING SECRETS FROM BOTH ENVIRONMENTS!', 'red');
      const confirmAll = await askQuestion('Type "DELETE ALL SECRETS" to confirm: ');
      
      if (confirmAll.trim() !== 'delete all secrets') {
        log('\nCancelled. No secrets were deleted.', 'yellow');
        log(`You typed: "${confirmAll}"`, 'cyan');
        return;
      }

      const devSuccess = await cleanupEnvironment('development', isDryRun);
      const prodSuccess = await cleanupEnvironment('production', isDryRun);
      success = devSuccess && prodSuccess;
      break;

    default:
      log(`Unknown command: ${command}`, 'red');
      log('Run with "help" for usage information', 'yellow');
      success = false;
  }

  if (success) {
    logSection('Cleanup Complete!');
    if (isDryRun) {
      log('This was a dry run. No secrets were actually deleted.', 'cyan');
      log('Run without --dry-run to actually delete the secrets.', 'cyan');
    } else {
      log('Old secrets have been deleted successfully!', 'green');
      log('Your application now uses only consolidated secrets.', 'green');
      log('\nCost savings: ~$11.52/year → $0/year', 'bright');
    }
  } else {
    logSection('Cleanup Failed');
    log('Some secrets could not be deleted. Check the errors above.', 'red');
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

module.exports = { cleanupEnvironment, verifyConsolidatedSecret };
