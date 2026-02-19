import axios from 'axios';
import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';
import logger from '../utils/logger.js';
import ConnectivityValidator from '../utils/connectivityValidator.js';

dotenv.config();

/**
 * IntegrationTestRunner - Executes automated integration tests against the backend API
 * 
 * Responsibilities:
 * - Run individual tests or test suites
 * - Track API calls and responses
 * - Capture database state on failures
 * - Support parallel test execution
 * - Collect and aggregate test results
 */
class IntegrationTestRunner {
  constructor(config = {}) {
    this.config = {
      environment: config.environment || 'development',
      apiBaseUrl: config.apiBaseUrl || process.env.DEVELOPMENT_URL || 'http://localhost:8080/api',
      mongoUri: config.mongoUri || process.env.MONGODB_URI,
      timeout: config.timeout || 30000,
      retries: config.retries || 2,
      parallel: config.parallel || false,
      ...config
    };

    this.apiClient = axios.create({
      baseURL: this.config.apiBaseUrl,
      timeout: this.config.timeout,
      headers: {
        'Content-Type': 'application/json'
      }
    });

    this.mongoClient = null;
    this.db = null;
    this.testResults = [];
    this.apiCallLog = [];
  }

  /**
   * Initialize database connection
   */
  async initialize() {
    try {
      // Validate connectivity first
      const validator = new ConnectivityValidator();
      const connectivityResults = await validator.validateAll({
        apiBaseUrl: this.config.apiBaseUrl,
        databaseConnection: { uri: this.config.mongoUri }
      });
      
      if (!connectivityResults.success) {
        throw new Error('Connectivity validation failed. Check API and database connections.');
      }
      
      this.mongoClient = new MongoClient(this.config.mongoUri);
      await this.mongoClient.connect();
      this.db = this.mongoClient.db();
      logger.info('IntegrationTestRunner initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize IntegrationTestRunner:', error);
      throw error;
    }
  }

  /**
   * Close database connection
   */
  async cleanup() {
    if (this.mongoClient) {
      await this.mongoClient.close();
      logger.info('IntegrationTestRunner cleaned up');
    }
  }

  /**
   * Run all tests or tests for specific phases
   * @param {Object} options - Test execution options
   * @returns {Promise<Object>} Test results
   */
  async runTests(options = {}) {
    const startTime = Date.now();
    this.testResults = [];
    this.apiCallLog = [];

    try {
      await this.initialize();

      const phases = options.phases || ['all'];
      const testSuites = this._getTestSuitesForPhases(phases);

      logger.info(`Running ${testSuites.length} test suites...`);

      if (this.config.parallel) {
        await this.runParallel(testSuites);
      } else {
        for (const suite of testSuites) {
          await this.runTestSuite(suite);
        }
      }

      const duration = Date.now() - startTime;
      const results = this._aggregateResults(duration);

      logger.info(`Test execution completed in ${duration}ms`);
      logger.info(`Results: ${results.passed} passed, ${results.failed} failed, ${results.skipped} skipped`);

      return results;
    } catch (error) {
      logger.error('Test execution failed:', error);
      throw error;
    } finally {
      await this.cleanup();
    }
  }

  /**
   * Run a specific test suite
   * @param {string} suiteName - Name of the test suite
   * @returns {Promise<Object>} Test suite results
   */
  async runTestSuite(suiteName) {
    logger.info(`Running test suite: ${suiteName}`);
    const startTime = Date.now();

    try {
      // Import the test suite dynamically
      const testModule = await import(`../tests/integration/${suiteName}.test.js`);
      const tests = testModule.default || testModule.tests;

      if (!tests || tests.length === 0) {
        logger.warn(`No tests found in suite: ${suiteName}`);
        return { suite: suiteName, tests: [], duration: 0 };
      }

      const suiteResults = [];

      for (const test of tests) {
        const result = await this._executeTest(test, suiteName);
        suiteResults.push(result);
        this.testResults.push(result);
      }

      const duration = Date.now() - startTime;
      logger.info(`Test suite ${suiteName} completed in ${duration}ms`);

      return {
        suite: suiteName,
        tests: suiteResults,
        duration
      };
    } catch (error) {
      logger.error(`Failed to run test suite ${suiteName}:`, error);
      return {
        suite: suiteName,
        error: error.message,
        duration: Date.now() - startTime
      };
    }
  }

  /**
   * Run multiple test suites in parallel
   * @param {Array<string>} suites - Array of test suite names
   * @returns {Promise<Array>} Array of test suite results
   */
  async runParallel(suites) {
    logger.info(`Running ${suites.length} test suites in parallel...`);

    const promises = suites.map(suite => this.runTestSuite(suite));
    const results = await Promise.allSettled(promises);

    return results.map((result, index) => {
      if (result.status === 'fulfilled') {
        return result.value;
      } else {
        logger.error(`Test suite ${suites[index]} failed:`, result.reason);
        return {
          suite: suites[index],
          error: result.reason.message,
          duration: 0
        };
      }
    });
  }

  /**
   * Execute a single test with lifecycle management
   * @param {Object} test - Test definition
   * @param {string} suiteName - Name of the test suite
   * @returns {Promise<Object>} Test result
   */
  async _executeTest(test, suiteName) {
    const testName = test.name || 'Unnamed test';
    const startTime = Date.now();
    
    logger.info(`  Running test: ${testName}`);

    const result = {
      name: testName,
      suite: suiteName,
      phase: test.phase || 'unknown',
      status: 'skipped',
      duration: 0,
      apiCalls: [],
      error: null,
      databaseSnapshot: null
    };

    try {
      // Setup phase
      if (test.setup) {
        await test.setup(this);
      }

      // Execute phase
      const testApiCalls = [];
      const originalRequest = this.apiClient.request.bind(this.apiClient);
      
      // Intercept API calls for logging
      this.apiClient.request = async (config) => {
        const callStartTime = Date.now();
        try {
          const response = await originalRequest(config);
          const apiCall = {
            method: config.method,
            url: config.url,
            data: config.data,
            response: response.data,
            status: response.status,
            duration: Date.now() - callStartTime
          };
          testApiCalls.push(apiCall);
          this.apiCallLog.push({ ...apiCall, test: testName, suite: suiteName });
          return response;
        } catch (error) {
          const apiCall = {
            method: config.method,
            url: config.url,
            data: config.data,
            error: error.message,
            status: error.response?.status,
            duration: Date.now() - callStartTime
          };
          testApiCalls.push(apiCall);
          this.apiCallLog.push({ ...apiCall, test: testName, suite: suiteName });
          throw error;
        }
      };

      // Run the test
      await test.execute(this);

      // Restore original request method
      this.apiClient.request = originalRequest;

      result.status = 'passed';
      result.apiCalls = testApiCalls;
      logger.info(`  ✓ Test passed: ${testName}`);

    } catch (error) {
      result.status = 'failed';
      result.error = {
        message: error.message,
        stack: error.stack
      };

      // Capture database snapshot on failure
      if (test.captureDbOnFailure !== false) {
        result.databaseSnapshot = await this._captureDatabaseSnapshot(test.phase);
      }

      logger.error(`  ✗ Test failed: ${testName}`, error.message);
    } finally {
      // Teardown phase
      try {
        if (test.teardown) {
          await test.teardown(this);
        }
      } catch (teardownError) {
        logger.error(`  Teardown failed for test: ${testName}`, teardownError);
      }

      result.duration = Date.now() - startTime;
    }

    return result;
  }

  /**
   * Capture database snapshot for debugging
   * @param {string} phase - Feature phase
   * @returns {Promise<Object>} Database snapshot
   */
  async _captureDatabaseSnapshot(phase) {
    try {
      const collections = await this.db.listCollections().toArray();
      const snapshot = {};

      for (const collection of collections) {
        const collectionName = collection.name;
        const count = await this.db.collection(collectionName).countDocuments({ isSeedData: true });
        snapshot[collectionName] = { count };
      }

      return snapshot;
    } catch (error) {
      logger.error('Failed to capture database snapshot:', error);
      return { error: error.message };
    }
  }

  /**
   * Get test suites for specified phases
   * @param {Array<string>} phases - Feature phases
   * @returns {Array<string>} Test suite names
   */
  _getTestSuitesForPhases(phases) {
    const allSuites = [
      'financial-intelligence',
      'care-intelligence',
      'workforce-optimization',
      'realtime-portal',
      'client-portal',
      'payroll',
      'offline-sync',
      'compliance',
      'expenses',
      'scheduling',
      'analytics'
    ];

    if (phases.includes('all')) {
      return allSuites;
    }

    return phases.filter(phase => allSuites.includes(phase));
  }

  /**
   * Aggregate test results
   * @param {number} duration - Total execution duration
   * @returns {Object} Aggregated results
   */
  _aggregateResults(duration) {
    const passed = this.testResults.filter(r => r.status === 'passed').length;
    const failed = this.testResults.filter(r => r.status === 'failed').length;
    const skipped = this.testResults.filter(r => r.status === 'skipped').length;

    return {
      totalTests: this.testResults.length,
      passed,
      failed,
      skipped,
      duration,
      testCases: this.testResults,
      apiCallLog: this.apiCallLog,
      coverage: this._calculateCoverage()
    };
  }

  /**
   * Calculate API endpoint coverage
   * @returns {Object} Coverage statistics
   */
  _calculateCoverage() {
    const testedEndpoints = new Set();
    
    for (const call of this.apiCallLog) {
      const endpoint = `${call.method} ${call.url}`;
      testedEndpoints.add(endpoint);
    }

    return {
      testedEndpoints: Array.from(testedEndpoints),
      totalCalls: this.apiCallLog.length,
      uniqueEndpoints: testedEndpoints.size
    };
  }

  /**
   * Make an API request (helper for tests)
   * @param {string} method - HTTP method
   * @param {string} url - API endpoint
   * @param {Object} data - Request data
   * @returns {Promise<Object>} API response
   */
  async apiRequest(method, url, data = null) {
    const config = {
      method,
      url,
      ...(data && { data })
    };

    return await this.apiClient.request(config);
  }

  /**
   * Query database (helper for tests)
   * @param {string} collection - Collection name
   * @param {Object} query - Query filter
   * @returns {Promise<Array>} Query results
   */
  async dbQuery(collection, query = {}) {
    return await this.db.collection(collection).find(query).toArray();
  }

  /**
   * Count documents in collection (helper for tests)
   * @param {string} collection - Collection name
   * @param {Object} query - Query filter
   * @returns {Promise<number>} Document count
   */
  async dbCount(collection, query = {}) {
    return await this.db.collection(collection).countDocuments(query);
  }
}

export default IntegrationTestRunner;
