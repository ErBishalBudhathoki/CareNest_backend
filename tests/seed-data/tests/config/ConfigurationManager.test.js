import { describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import fc from 'fast-check';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import ConfigurationManager from '../../src/config/ConfigurationManager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Property-Based Tests for ConfigurationManager
 * 
 * Feature: e2e-testing-seed-data
 * Property 27: Environment Configuration Loading
 * Validates: Requirements 6.4
 * 
 * Property: For any environment, the loaded configuration should exactly match 
 * the contents of that environment's configuration file.
 */

describe('ConfigurationManager - Property-Based Tests', () => {
  beforeEach(() => {
    // Clear cache before each test
    ConfigurationManager.clearCache();
  });

  afterEach(() => {
    // Clean up environment variables
    delete process.env.TEST_VAR;
    delete process.env.STAGING_MONGODB_URI;
    delete process.env.STAGING_TEST_USER_EMAIL;
    delete process.env.STAGING_TEST_USER_PASSWORD;
    delete process.env.PROD_LIKE_API_URL;
    delete process.env.PROD_LIKE_MONGODB_URI;
    delete process.env.PROD_LIKE_TEST_USER_EMAIL;
    delete process.env.PROD_LIKE_TEST_USER_PASSWORD;
  });

  /**
   * Property 27: Environment Configuration Loading
   * 
   * For any valid environment configuration file, when loaded through ConfigurationManager,
   * the returned configuration should exactly match the file contents (after env var substitution).
   */
  test('Property 27: loaded environment config matches file contents exactly', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom('development', 'staging', 'production-like'),
        async (environment) => {
          // Read the actual config file
          const configPath = path.join(
            __dirname,
            '../../config/environments',
            `${environment}.json`
          );
          
          const fileContent = await fs.readFile(configPath, 'utf-8');
          const expectedConfig = JSON.parse(fileContent);

          // Set up environment variables for configs that need them
          if (environment === 'staging') {
            process.env.STAGING_MONGODB_URI = 'mongodb://staging-host:27017/test-db';
            process.env.STAGING_TEST_USER_EMAIL = 'staging@test.com';
            process.env.STAGING_TEST_USER_PASSWORD = 'StagingPass123!';
          } else if (environment === 'production-like') {
            process.env.PROD_LIKE_API_URL = 'https://prod-like-api.carenest.com';
            process.env.PROD_LIKE_MONGODB_URI = 'mongodb://prod-like-host:27017/test-db';
            process.env.PROD_LIKE_TEST_USER_EMAIL = 'prodlike@test.com';
            process.env.PROD_LIKE_TEST_USER_PASSWORD = 'ProdLikePass123!';
          }

          // Load config through ConfigurationManager
          const loadedConfig = await ConfigurationManager.loadEnvironmentConfig(environment);

          // Verify all top-level fields match
          expect(loadedConfig.name).toBe(expectedConfig.name);
          expect(loadedConfig.safetyChecks).toBe(expectedConfig.safetyChecks);
          expect(loadedConfig.timeout).toBe(expectedConfig.timeout);
          expect(loadedConfig.retries).toBe(expectedConfig.retries);

          // Verify database config matches (with env var substitution)
          if (environment === 'staging') {
            expect(loadedConfig.apiBaseUrl).toBe(expectedConfig.apiBaseUrl);
            expect(loadedConfig.database.connectionString).toBe('mongodb://staging-host:27017/test-db');
            expect(loadedConfig.database.name).toBe(expectedConfig.database.name);
            expect(loadedConfig.auth.testUserEmail).toBe('staging@test.com');
            expect(loadedConfig.auth.testUserPassword).toBe('StagingPass123!');
          } else if (environment === 'production-like') {
            expect(loadedConfig.apiBaseUrl).toBe('https://prod-like-api.carenest.com');
            expect(loadedConfig.database.connectionString).toBe('mongodb://prod-like-host:27017/test-db');
            expect(loadedConfig.database.name).toBe(expectedConfig.database.name);
            expect(loadedConfig.auth.testUserEmail).toBe('prodlike@test.com');
            expect(loadedConfig.auth.testUserPassword).toBe('ProdLikePass123!');
          } else {
            // Development - no env var substitution needed
            expect(loadedConfig.apiBaseUrl).toBe(expectedConfig.apiBaseUrl);
            expect(loadedConfig.database.connectionString).toBe(expectedConfig.database.connectionString);
            expect(loadedConfig.database.name).toBe(expectedConfig.database.name);
            expect(loadedConfig.auth.testUserEmail).toBe(expectedConfig.auth.testUserEmail);
            expect(loadedConfig.auth.testUserPassword).toBe(expectedConfig.auth.testUserPassword);
          }

          // Verify structure completeness - no extra or missing fields at top level
          const expectedKeys = Object.keys(expectedConfig).sort();
          const loadedKeys = Object.keys(loadedConfig).sort();
          expect(loadedKeys).toEqual(expectedKeys);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Additional property test: Configuration caching consistency
   * 
   * Verifies that loading the same configuration multiple times returns identical results
   */
  test('Property: cached config matches freshly loaded config', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom('development', 'staging', 'production-like'),
        async (environment) => {
          // Set up environment variables for configs that need them
          if (environment === 'staging') {
            process.env.STAGING_MONGODB_URI = 'mongodb://staging-host:27017/test-db';
            process.env.STAGING_TEST_USER_EMAIL = 'staging@test.com';
            process.env.STAGING_TEST_USER_PASSWORD = 'StagingPass123!';
          } else if (environment === 'production-like') {
            process.env.PROD_LIKE_API_URL = 'https://prod-like-api.carenest.com';
            process.env.PROD_LIKE_MONGODB_URI = 'mongodb://prod-like-host:27017/test-db';
            process.env.PROD_LIKE_TEST_USER_EMAIL = 'prodlike@test.com';
            process.env.PROD_LIKE_TEST_USER_PASSWORD = 'ProdLikePass123!';
          }

          // Load config first time (will be cached)
          const firstLoad = await ConfigurationManager.loadEnvironmentConfig(environment);
          
          // Load config second time (should use cache)
          const secondLoad = await ConfigurationManager.loadEnvironmentConfig(environment);

          // Both should be identical
          expect(secondLoad).toEqual(firstLoad);
          
          // Verify it's the same reference (cached)
          expect(secondLoad).toBe(firstLoad);
        }
      ),
      { numRuns: 50 }
    );
  });

  /**
   * Property test: Environment variable substitution correctness
   * 
   * Verifies that environment variables are correctly substituted in config values
   */
  test('Property: environment variables are correctly substituted', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 5, maxLength: 20 })
          .filter(s => /^[A-Z_][A-Z0-9_]*$/.test(s)), // Valid env var name
        fc.webUrl(), // Valid URL
        async (varName, varValue) => {
          // Set environment variable
          process.env[varName] = varValue;

          // Create a temporary config with env var reference
          const tempConfigPath = path.join(__dirname, '../../config/environments/temp-test.json');
          const tempConfig = {
            name: 'temp-test',
            apiBaseUrl: `\${${varName}}`,
            database: {
              connectionString: `mongodb://\${${varName}}:27017/test`,
              name: 'test-db'
            },
            safetyChecks: false
          };

          try {
            await fs.writeFile(tempConfigPath, JSON.stringify(tempConfig, null, 2));

            // Load the config
            const loadedConfig = await ConfigurationManager.loadEnvironmentConfig('temp-test');

            // Verify substitution occurred
            expect(loadedConfig.apiBaseUrl).toBe(varValue);
            expect(loadedConfig.database.connectionString).toBe(`mongodb://${varValue}:27017/test`);
          } finally {
            // Clean up
            try {
              await fs.unlink(tempConfigPath);
            } catch (e) {
              // Ignore cleanup errors
            }
            delete process.env[varName];
            ConfigurationManager.clearCache();
          }
        }
      ),
      { numRuns: 30 }
    );
  });

  /**
   * Property test: Invalid environment names throw errors
   * 
   * Verifies that attempting to load non-existent environments fails appropriately
   */
  test('Property: loading non-existent environment throws error', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 30 })
          .filter(s => !['development', 'staging', 'production-like'].includes(s))
          .filter(s => !s.includes('/') && !s.includes('\\')),
        async (invalidEnv) => {
          // Attempting to load invalid environment should throw
          await expect(
            ConfigurationManager.loadEnvironmentConfig(invalidEnv)
          ).rejects.toThrow();
        }
      ),
      { numRuns: 30 }
    );
  });

  /**
   * Property test: Configuration validation detects all valid configs
   * 
   * Verifies that validateConfig successfully validates all existing environment configs
   */
  test('Property: validateConfig detects all valid environment configs', async () => {
    // Set up environment variables for configs that need them
    process.env.STAGING_MONGODB_URI = 'mongodb://staging-host:27017/test-db';
    process.env.STAGING_TEST_USER_EMAIL = 'staging@test.com';
    process.env.STAGING_TEST_USER_PASSWORD = 'StagingPass123!';
    process.env.PROD_LIKE_API_URL = 'https://prod-like-api.carenest.com';
    process.env.PROD_LIKE_MONGODB_URI = 'mongodb://prod-like-host:27017/test-db';
    process.env.PROD_LIKE_TEST_USER_EMAIL = 'prodlike@test.com';
    process.env.PROD_LIKE_TEST_USER_PASSWORD = 'ProdLikePass123!';

    const validationResult = await ConfigurationManager.validateConfig();

    // Should be valid
    expect(validationResult.valid).toBe(true);
    
    // Should have no errors
    expect(validationResult.errors).toHaveLength(0);
    
    // May have warnings (e.g., features directory not found)
    expect(Array.isArray(validationResult.warnings)).toBe(true);
  });
});
