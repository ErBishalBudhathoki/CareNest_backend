import axios from 'axios';
import { MongoClient } from 'mongodb';
import logger from './logger.js';

/**
 * ConnectivityValidator - Validates connectivity to API and database
 * 
 * Responsibilities:
 * - Check API endpoint connectivity
 * - Check database connectivity
 * - Handle timeouts gracefully
 * - Provide detailed error messages
 */
class ConnectivityValidator {
  constructor(config = {}) {
    this.config = {
      apiTimeout: config.apiTimeout || 10000,
      dbTimeout: config.dbTimeout || 10000,
      ...config
    };
  }

  /**
   * Validate connectivity to both API and database
   * @param {Object} envConfig - Environment configuration
   * @returns {Promise<Object>} Validation result
   */
  async validateAll(envConfig) {
    const results = {
      api: await this.validateAPI(envConfig.apiBaseUrl),
      database: await this.validateDatabase(envConfig.databaseConnection.uri)
    };

    results.success = results.api.success && results.database.success;
    
    return results;
  }

  /**
   * Validate API connectivity
   * @param {string} apiBaseUrl - API base URL
   * @returns {Promise<Object>} Validation result
   */
  async validateAPI(apiBaseUrl) {
    logger.info(`Validating API connectivity: ${apiBaseUrl}`);
    
    try {
      const startTime = Date.now();
      
      // Try to reach a health check endpoint or any endpoint
      const response = await axios.get(`${apiBaseUrl}/health`, {
        timeout: this.config.apiTimeout,
        validateStatus: () => true // Accept any status code
      });
      
      const duration = Date.now() - startTime;
      
      // Consider 2xx, 3xx, 404, and 401 as successful connectivity
      // (404 and 401 mean the server is reachable, just no health endpoint or auth required)
      const isConnected = response.status < 500;
      
      if (isConnected) {
        logger.info(`API connectivity validated successfully (${duration}ms)`);
        return {
          success: true,
          url: apiBaseUrl,
          status: response.status,
          duration,
          message: 'API is reachable'
        };
      } else {
        logger.warn(`API returned server error: ${response.status}`);
        return {
          success: false,
          url: apiBaseUrl,
          status: response.status,
          duration,
          message: `API returned server error: ${response.status}`,
          error: response.statusText
        };
      }
    } catch (error) {
      logger.error('API connectivity validation failed', { error: error.message });
      
      if (error.code === 'ECONNREFUSED') {
        return {
          success: false,
          url: apiBaseUrl,
          message: 'Connection refused - API server may not be running',
          error: error.message
        };
      } else if (error.code === 'ETIMEDOUT' || error.code === 'ECONNABORTED') {
        return {
          success: false,
          url: apiBaseUrl,
          message: 'Connection timeout - API server is not responding',
          error: error.message
        };
      } else if (error.code === 'ENOTFOUND') {
        return {
          success: false,
          url: apiBaseUrl,
          message: 'Host not found - check the API URL',
          error: error.message
        };
      } else {
        return {
          success: false,
          url: apiBaseUrl,
          message: 'API connectivity check failed',
          error: error.message
        };
      }
    }
  }

  /**
   * Validate database connectivity
   * @param {string} mongoUri - MongoDB connection URI
   * @returns {Promise<Object>} Validation result
   */
  async validateDatabase(mongoUri) {
    // Mask password in logs
    const maskedUri = mongoUri.replace(/:([^:@]+)@/, ':****@');
    logger.info(`Validating database connectivity: ${maskedUri}`);
    
    let client = null;
    
    try {
      const startTime = Date.now();
      
      client = new MongoClient(mongoUri, {
        serverSelectionTimeoutMS: this.config.dbTimeout,
        connectTimeoutMS: this.config.dbTimeout
      });
      
      await client.connect();
      
      // Ping the database to ensure connection is working
      await client.db().admin().ping();
      
      const duration = Date.now() - startTime;
      
      logger.info(`Database connectivity validated successfully (${duration}ms)`);
      
      return {
        success: true,
        uri: maskedUri,
        duration,
        message: 'Database is reachable'
      };
    } catch (error) {
      logger.error('Database connectivity validation failed', { error: error.message });
      
      if (error.name === 'MongoServerSelectionError') {
        return {
          success: false,
          uri: maskedUri,
          message: 'Cannot connect to MongoDB server - check connection string and network',
          error: error.message
        };
      } else if (error.name === 'MongoAuthenticationError') {
        return {
          success: false,
          uri: maskedUri,
          message: 'Authentication failed - check username and password',
          error: error.message
        };
      } else if (error.name === 'MongoNetworkError') {
        return {
          success: false,
          uri: maskedUri,
          message: 'Network error - check if MongoDB server is running',
          error: error.message
        };
      } else {
        return {
          success: false,
          uri: maskedUri,
          message: 'Database connectivity check failed',
          error: error.message
        };
      }
    } finally {
      if (client) {
        try {
          await client.close();
        } catch (closeError) {
          logger.warn('Error closing database connection', { error: closeError.message });
        }
      }
    }
  }

  /**
   * Display connectivity validation results
   * @param {Object} results - Validation results
   */
  displayResults(results) {
    console.log('\n═══════════════════════════════════════════════════════');
    console.log('         CONNECTIVITY VALIDATION RESULTS');
    console.log('═══════════════════════════════════════════════════════\n');
    
    // API Results
    console.log('API Connectivity:');
    if (results.api.success) {
      console.log(`  ✓ ${results.api.message}`);
      console.log(`    URL: ${results.api.url}`);
      console.log(`    Status: ${results.api.status}`);
      console.log(`    Response Time: ${results.api.duration}ms`);
    } else {
      console.log(`  ✗ ${results.api.message}`);
      console.log(`    URL: ${results.api.url}`);
      if (results.api.error) {
        console.log(`    Error: ${results.api.error}`);
      }
    }
    
    console.log('');
    
    // Database Results
    console.log('Database Connectivity:');
    if (results.database.success) {
      console.log(`  ✓ ${results.database.message}`);
      console.log(`    URI: ${results.database.uri}`);
      console.log(`    Response Time: ${results.database.duration}ms`);
    } else {
      console.log(`  ✗ ${results.database.message}`);
      console.log(`    URI: ${results.database.uri}`);
      if (results.database.error) {
        console.log(`    Error: ${results.database.error}`);
      }
    }
    
    console.log('\n═══════════════════════════════════════════════════════\n');
    
    if (results.success) {
      console.log('✓ All connectivity checks passed\n');
    } else {
      console.log('✗ Some connectivity checks failed\n');
    }
  }
}

export default ConnectivityValidator;
