/**
 * Environment configuration management
 * Provides environment-specific settings and feature flags
 */

class EnvironmentConfig {
  constructor() {
    this.environment = process.env.NODE_ENV || 'development';
    this.isProduction = this.environment === 'production';
    this.isDevelopment = this.environment === 'development';
    
    // Load configuration based on environment
    this.loadEnvironmentConfig();
  }

  loadEnvironmentConfig() {
    // Base configuration
    this.config = {
      app: {
        name: 'Multi-Tenant Invoice Backend',
        port: process.env.PORT || 8080,
        version: '1.0.0'
      },
      logging: {
        level: this.isProduction ? 'info' : 'debug',
        enableSensitiveDataLogging: !this.isProduction,
        enableConsoleOutput: !this.isProduction,
        enableFileOutput: true,
        enableDebugOutput: this.isDevelopment
      },
      security: {
        enableDetailedErrors: !this.isProduction,
        enableStackTraces: !this.isProduction,
        hideCredentialsInLogs: this.isProduction,
        enableSecurityHeaders: this.isProduction
      },
      database: {
        enableQueryLogging: this.isDevelopment,
        connectionTimeout: this.isProduction ? 30000 : 10000
      },
      features: {
        enableHealthEndpoint: true,
        enableMetrics: true,
        enableDebugEndpoints: this.isDevelopment
      }
    };
    
    // Environment-specific overrides
    if (this.isProduction) {
      this.configureProduction();
    } else {
      this.configureDevelopment();
    }
  }

  configureProduction() {
    console.log('🚀 Configuring PRODUCTION environment');
    
    // Production-specific settings
    this.config.logging.enableVerboseLogging = false;
    this.config.security.corsOrigins = process.env.ALLOWED_ORIGINS?.split(',') || [];
    this.config.features.enableApiDocs = false;
  }

  configureDevelopment() {
    console.log('🛠️  Configuring DEVELOPMENT environment');
    
    // Development-specific settings
    this.config.logging.enableVerboseLogging = true;
    this.config.security.corsOrigins = ['http://localhost:3000', 'http://localhost:8080'];
    this.config.features.enableApiDocs = true;
  }

  /**
   * Get environment configuration
   * @returns {Object} Configuration object
   */
  getConfig() {
    return this.config;
  }

  /**
   * Check if running in production
   * @returns {boolean}
   */
  isProductionEnvironment() {
    return this.isProduction;
  }

  /**
   * Check if running in development
   * @returns {boolean}
   */
  isDevelopmentEnvironment() {
    return this.isDevelopment;
  }

  /**
   * Get environment name
   * @returns {string}
   */
  getEnvironment() {
    return this.environment;
  }

  /**
   * Should log sensitive data?
   * @returns {boolean}
   */
  shouldLogSensitiveData() {
    return this.config.logging.enableSensitiveDataLogging;
  }

  /**
   * Should show detailed errors?
   * @returns {boolean}
   */
  shouldShowDetailedErrors() {
    return this.config.security.enableDetailedErrors;
  }

  /**
   * Get log level
   * @returns {string}
   */
  getLogLevel() {
    return this.config.logging.level;
  }
}

// Export singleton instance
const environmentConfig = new EnvironmentConfig();

module.exports = {
  EnvironmentConfig,
  environmentConfig
};