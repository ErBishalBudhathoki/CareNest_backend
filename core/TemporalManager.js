const { Connection, Client } = require('@temporalio/client');
const fs = require('fs');
const logger = require('../config/logger');

let clientInstance = null;
let connectionInstance = null;

class TemporalManager {
  /**
   * Initializes and returns the Temporal Client connection.
   *
   * Supports three connection modes based on environment:
   *
   *  1. mTLS (Cloud Run)
   *     Set TEMPORAL_TLS_CA, TEMPORAL_TLS_CERT, TEMPORAL_TLS_KEY to file paths.
   *     Certs are mounted from GCP Secret Manager as volume files.
   *
   *  2. Simple TLS (default)
   *     Just server-side TLS with SNI override.
   *
   *  3. Plaintext (Oracle Worker internal)
   *     Set TEMPORAL_TLS=false for internal Docker network traffic.
   */
  static async getClient() {
    if (clientInstance) {
      return clientInstance;
    }

    try {
      const address = process.env.TEMPORAL_ADDRESS || 'temporal-direct.bishalbudhathoki.com:7236';
      const namespace = process.env.TEMPORAL_NAMESPACE || 'default';
      const useTls = process.env.TEMPORAL_TLS !== 'false';

      const [host, port] = address.split(':');

      // Force IPv4 resolution to bypass Oracle Docker IPv6 issues
      const dns = require('dns').promises;
      let finalAddress = address;
      try {
        const lookup = await dns.lookup(host, { family: 4 });
        finalAddress = `${lookup.address}:${port || '7236'}`;
        logger.info(`Resolved ${host} to ${lookup.address}`);
      } catch (e) {
        logger.warn(`Failed to resolve IPv4 for ${host}, falling back to original address`, e);
      }

      const connectionOptions = { address: finalAddress };

      if (useTls) {
        const tlsConfig = {
          serverNameOverride: process.env.TEMPORAL_TLS_SERVER_NAME || 'temporal.bishalbudhathoki.com',
        };

        // mTLS: Read certs from GCP Secret Manager volume mounts
        const caPath = process.env.TEMPORAL_TLS_CA;
        const certPath = process.env.TEMPORAL_TLS_CERT;
        const keyPath = process.env.TEMPORAL_TLS_KEY;

        if (caPath && fs.existsSync(caPath)) {
          tlsConfig.serverRootCACertificate = fs.readFileSync(caPath);
          logger.info('Loaded Temporal CA certificate from volume mount');
        }

        if (certPath && keyPath && fs.existsSync(certPath) && fs.existsSync(keyPath)) {
          tlsConfig.clientCertPair = {
            crt: fs.readFileSync(certPath),
            key: fs.readFileSync(keyPath),
          };
          logger.info('Loaded Temporal client cert/key pair for mTLS');
        }

        connectionOptions.tls = tlsConfig;
      } else {
        logger.info('Temporal TLS disabled — using plaintext gRPC');
      }

      logger.info(`Connecting to Temporal at ${finalAddress} (tls=${useTls}, namespace=${namespace})`);

      connectionInstance = await Connection.connect({
        ...connectionOptions,
        // 15s deadline for cross-cloud (GCP → Oracle) gRPC connection
        connectTimeout: 15000,
      });

      clientInstance = new Client({
        connection: connectionInstance,
        namespace,
      });

      logger.info(`Connected to Temporal server at ${address} (namespace=${namespace})`);
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
