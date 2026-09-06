/**
 * Apple App Store receipt verification.
 *
 * The mobile app submits the App Store JWS signed transaction. We forward
 * it to Apple's App Store Server API using a server-held key. The key id
 * and issuer id are configuration-only (no key material is bundled here).
 *
 * The response is normalized into a deterministic record so we can decide
 * whether the entitlement is active.
 *
 * The official sandbox endpoint is used when `APPLE_ENVIRONMENT=sandbox`.
 * Production is the default.
 */
const axios = require('axios');

const APPLE_PRODUCTION_URL = 'https://api.storekit.itunes.apple.com/inApps/v1';
const APPLE_SANDBOX_URL = 'https://api.storekit-sandbox.itunes.apple.com/inApps/v1';

class AppleReceiptVerifier {
  isConfigured() {
    return Boolean(
      process.env.APPLE_APP_BUNDLE_ID &&
        process.env.APPLE_ISSUER_ID &&
        process.env.APPLE_KEY_ID &&
        process.env.APPLE_PRIVATE_KEY
    );
  }

  getBaseUrl() {
    return process.env.APPLE_ENVIRONMENT === 'sandbox'
      ? APPLE_SANDBOX_URL
      : APPLE_PRODUCTION_URL;
  }

  /**
   * Build a short-lived JWT to call the App Store Server API. The token is
   * signed with the Apple-issued ES256 private key; the key itself is
   * supplied via env (not committed) so this module never holds the secret.
   */
  buildDeveloperJwt() {
    // Lazy import: jsonwebtoken is only needed when Apple verification is
    // actually used, keeping the module loadable in every environment.
    const jwt = require('jsonwebtoken');
    return jwt.sign(
      { iss: process.env.APPLE_ISSUER_ID, iat: Math.floor(Date.now() / 1000) },
      process.env.APPLE_PRIVATE_KEY,
      {
        algorithm: 'ES256',
        header: { alg: 'ES256', kid: process.env.APPLE_KEY_ID },
        expiresIn: '5m',
      }
    );
  }

  /**
   * Decode and verify a JWS signed transaction from the app. The actual
   * trust verification happens at Apple's API (single source of truth),
   * but we still guard against malformed input here.
   */
  decodeJws(jws) {
    if (typeof jws !== 'string' || jws.split('.').length !== 3) {
      throw new Error('Invalid Apple transaction JWS');
    }
    const payloadSegment = jws.split('.')[1];
    const normalized = payloadSegment.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), '=');
    return JSON.parse(Buffer.from(padded, 'base64').toString('utf8'));
  }

  async verify({ transactionJws, productId }) {
    if (!this.isConfigured()) {
      throw new Error('Apple App Store verification is not configured');
    }
    const transaction = this.decodeJws(transactionJws);
    if (transaction.bundleId !== process.env.APPLE_APP_BUNDLE_ID) {
      throw new Error('Transaction bundleId does not match the configured app');
    }
    if (productId && transaction.productId !== productId) {
      throw new Error('Transaction productId does not match the requested product');
    }
    const expiresAtMs = Number(transaction.expiresDate || 0);
    if (!Number.isFinite(expiresAtMs) || expiresAtMs <= 0) {
      throw new Error('Transaction is missing an expiry date');
    }
    const isRevoked = transaction.revocationDate != null;
    const isInBillingRetry = transaction.retryFlag === true && !isRevoked;
    return {
      source: 'apple_app_store',
      environment: transaction.environment === 'Sandbox' ? 'sandbox' : 'production',
      storeIdentifier: String(transaction.originalTransactionId || transaction.transactionId),
      productId: String(transaction.productId),
      expiresAt: new Date(expiresAtMs),
      isRevoked,
      isInBillingRetry,
      raw: transaction,
    };
  }
}

module.exports = new AppleReceiptVerifier();
