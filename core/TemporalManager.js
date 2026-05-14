const { Connection, Client } = require('@temporalio/client');
const logger = require('../config/logger');

let clientInstance = null;
let connectionInstance = null;

class TemporalManager {
  /**
   * Initializes and returns the Temporal Client connection.
   * If already initialized, returns the existing client instance.
   */
  static async getClient() {
    if (clientInstance) {
      return clientInstance;
    }

    try {
      // Connect to the Temporal server through Cloudflare Tunnel
      // Force IPv4 resolution because Docker on Oracle Cloud often fails to route IPv6
      const dns = require('dns').promises;
      const lookup = await dns.lookup('temporal.bishalbudhathoki.com', { family: 4 });
      
      connectionInstance = await Connection.connect({
        address: `${lookup.address}:443`,
        tls: {
          serverNameOverride: 'temporal.bishalbudhathoki.com'
        },
      });

      clientInstance = new Client({
        connection: connectionInstance,
        // Using the 'default' namespace. If your server uses a different one, update here.
        namespace: 'default',
      });

      logger.info('Connected to Temporal server at temporal.bishalbudhathoki.com:443');
      return clientInstance;
    } catch (error) {
      logger.error('Failed to connect to Temporal server:', error);
      throw error;
    }
  }

  /**
   * Closes the connection gracefully.
   */
  static async close() {
    if (connectionInstance) {
      await connectionInstance.close();
      connectionInstance = null;
      clientInstance = null;
      logger.info('Closed Temporal server connection');
    }
  }
}

module.exports = TemporalManager;
