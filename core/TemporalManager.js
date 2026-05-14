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
      // Use environment variables for connection
      const address = process.env.TEMPORAL_ADDRESS || 'temporal.bishalbudhathoki.com:443';
      const useTls = process.env.TEMPORAL_TLS !== 'false';

      const [host, port] = address.split(':');
      
      // Force IPv4 resolution for the hostname to bypass Oracle Docker IPv6 issues
      const dns = require('dns').promises;
      let finalAddress = address;
      try {
        const lookup = await dns.lookup(host, { family: 4 });
        finalAddress = `${lookup.address}:${port || '443'}`;
      } catch (e) {
        logger.warn(`Failed to resolve IPv4 for ${host}, falling back to original address`, e);
      }

      const connectionOptions = { address: finalAddress };

      if (useTls) {
        connectionOptions.tls = {
          serverNameOverride: host // Explicitly required for SNI routing
        };
      }

      connectionInstance = await Connection.connect(connectionOptions);

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
