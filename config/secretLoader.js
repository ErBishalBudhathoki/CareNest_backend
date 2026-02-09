const { SecretManagerServiceClient } = require('@google-cloud/secret-manager');
const fs = require('fs');
const path = require('path');

/**
 * Google Cloud Secret Manager Loader
 * 
 * This utility loads consolidated secrets from either:
 * 1. Google Cloud Secret Manager (in production/Cloud Run)
 * 2. Local secrets.json file (in development)
 * 3. Process environment variables (fallback)
 * 
 * It consolidates all secrets into a single Secret Manager secret per environment,
 * reducing costs while maintaining security.
 */
class SecretLoader {
  constructor() {
    this.client = null;
    this.secrets = {};
    this.loaded = false;
    this.environment = process.env.NODE_ENV || 'development';
    this.isCloudRun = !!process.env.K_SERVICE; // Cloud Run sets this variable
  }

  /**
   * Initialize the Secret Manager client (only in Cloud Run)
   */
  initializeClient() {
    if (!this.client && this.isCloudRun) {
      try {
        this.client = new SecretManagerServiceClient();
        console.log('[SecretLoader] Secret Manager client initialized');
      } catch (error) {
        console.warn('[SecretLoader] Failed to initialize Secret Manager client:', error.message);
        this.client = null;
      }
    }
  }

  /**
   * Load secrets from Google Cloud Secret Manager
   */
  async loadFromSecretManager() {
    this.initializeClient();
    
    if (!this.client) {
      return null;
    }

    try {
      // Determine project ID and secret name based on environment
      const config = this.getSecretManagerConfig();
      
      if (!config) {
        console.warn('[SecretLoader] No Secret Manager config for environment:', this.environment);
        return null;
      }

      const secretName = `projects/${config.projectId}/secrets/${config.secretName}/versions/latest`;
      
      console.log(`[SecretLoader] Fetching secret: ${secretName}`);
      
      // Access the secret
      const [version] = await this.client.accessSecretVersion({ name: secretName });
      
      // Parse the secret payload
      const payload = version.payload.data.toString('utf8');
      const secrets = JSON.parse(payload);
      
      console.log(`[SecretLoader] ✓ Loaded ${Object.keys(secrets).length} secrets from Secret Manager`);
      
      return secrets;
    } catch (error) {
      console.error('[SecretLoader] Error loading from Secret Manager:', error.message);
      return null;
    }
  }

  /**
   * Load secrets from local secrets.json file
   */
  loadFromLocalFile() {
    try {
      const secretsFile = path.join(__dirname, '..', 'secrets.json');
      
      if (!fs.existsSync(secretsFile)) {
        console.warn('[SecretLoader] secrets.json not found at:', secretsFile);
        return null;
      }

      const content = fs.readFileSync(secretsFile, 'utf8');
      const allSecrets = JSON.parse(content);
      
      // Get secrets for current environment
      const envSecrets = allSecrets[this.environment] || allSecrets['development'];
      
      if (!envSecrets) {
        console.warn('[SecretLoader] No secrets found for environment:', this.environment);
        return null;
      }

      console.log(`[SecretLoader] ✓ Loaded ${Object.keys(envSecrets).length} secrets from local file`);
      
      return envSecrets;
    } catch (error) {
      console.error('[SecretLoader] Error loading from local file:', error.message);
      return null;
    }
  }

  /**
   * Load secrets from process.env (fallback)
   */
  loadFromEnvironment() {
    console.log('[SecretLoader] Using secrets from environment variables');
    
    // Return a subset of critical environment variables
    return {
      NODE_ENV: process.env.NODE_ENV,
      PORT: process.env.PORT,
      MONGODB_URI: process.env.MONGODB_URI || process.env.MONGOD_URI,
      REDIS_URL: process.env.REDIS_URL,
      JWT_SECRET: process.env.JWT_SECRET,
      // Add other critical env vars as needed
    };
  }

  /**
   * Get Secret Manager configuration based on environment
   */
  getSecretManagerConfig() {
    const configs = {
      development: {
        projectId: process.env.GCP_PROJECT_ID || 'invoice-660f3',
        secretName: 'app-secrets-dev'
      },
      production: {
        projectId: process.env.GCP_PROJECT_ID || 'carenest-prod',
        secretName: 'app-secrets-prod'
      }
    };

    return configs[this.environment];
  }

  /**
   * Load secrets using the appropriate method
   */
  async load() {
    if (this.loaded) {
      console.log('[SecretLoader] Secrets already loaded, using cache');
      return this.secrets;
    }

    console.log(`[SecretLoader] Loading secrets for environment: ${this.environment}`);
    console.log(`[SecretLoader] Running in Cloud Run: ${this.isCloudRun}`);

    let loadedSecrets = null;

    // Strategy 1: Try Google Cloud Secret Manager (if in Cloud Run)
    if (this.isCloudRun) {
      loadedSecrets = await this.loadFromSecretManager();
    }

    // Strategy 2: Try local secrets.json file (development)
    if (!loadedSecrets && !this.isCloudRun) {
      loadedSecrets = this.loadFromLocalFile();
    }

    // Strategy 3: Fall back to environment variables
    if (!loadedSecrets) {
      console.warn('[SecretLoader] Falling back to environment variables');
      loadedSecrets = this.loadFromEnvironment();
    }

    // Store loaded secrets
    this.secrets = loadedSecrets || {};
    this.loaded = true;

    // Apply secrets to process.env
    this.applyToEnvironment();

    console.log(`[SecretLoader] ✓ Secrets loaded successfully (${Object.keys(this.secrets).length} keys)`);

    return this.secrets;
  }

  /**
   * Apply loaded secrets to process.env
   */
  applyToEnvironment() {
    for (const [key, value] of Object.entries(this.secrets)) {
      // Only set if not already set (env vars take precedence)
      if (process.env[key] === undefined) {
        process.env[key] = String(value);
      }
    }
  }

  /**
   * Get a specific secret value
   */
  get(key, defaultValue = undefined) {
    return this.secrets[key] || process.env[key] || defaultValue;
  }

  /**
   * Check if a secret exists
   */
  has(key) {
    return key in this.secrets || key in process.env;
  }

  /**
   * Get all secrets (use carefully, don't log!)
   */
  getAll() {
    return { ...this.secrets };
  }

  /**
   * Reload secrets (useful for development)
   */
  async reload() {
    this.loaded = false;
    this.secrets = {};
    return await this.load();
  }

  /**
   * Get summary of loaded secrets (safe for logging)
   */
  getSummary() {
    return {
      environment: this.environment,
      isCloudRun: this.isCloudRun,
      secretCount: Object.keys(this.secrets).length,
      loaded: this.loaded,
      secretKeys: Object.keys(this.secrets).sort()
    };
  }
}

// Create singleton instance
const secretLoader = new SecretLoader();

/**
 * Helper function to load secrets at application startup
 */
async function loadSecrets() {
  try {
    await secretLoader.load();
    return secretLoader;
  } catch (error) {
    console.error('[SecretLoader] Fatal error loading secrets:', error);
    throw error;
  }
}

/**
 * Helper function to get a secret value
 */
function getSecret(key, defaultValue) {
  return secretLoader.get(key, defaultValue);
}

module.exports = {
  SecretLoader,
  secretLoader,
  loadSecrets,
  getSecret
};
