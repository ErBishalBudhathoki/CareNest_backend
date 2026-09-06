/**
 * Google Play purchase verification. Uses the Google Play Developer API
 * (publisher subscriber purchases endpoint) to fetch a verified
 * subscription state. The service account credentials are configuration
 * only; the private key never appears in this file.
 */
const axios = require('axios');

class GooglePlayReceiptVerifier {
  isConfigured() {
    return Boolean(
      process.env.GOOGLE_PLAY_PACKAGE_NAME &&
        process.env.GOOGLE_PLAY_CLIENT_EMAIL &&
        process.env.GOOGLE_PLAY_PRIVATE_KEY
    );
  }

  getAuthClient() {
    // Lazy import: googleapis is only needed when Google verification is
    // actually used, keeping the module loadable in every environment.
    const { google } = require('googleapis');
    const jwtClient = new google.auth.JWT({
      email: process.env.GOOGLE_PLAY_CLIENT_EMAIL,
      key: process.env.GOOGLE_PLAY_PRIVATE_KEY,
      scopes: ['https://www.googleapis.com/auth/androidpublisher'],
    });
    return jwtClient;
  }

  async verify({ purchaseToken, productId, subscriptionId }) {
    if (!this.isConfigured()) {
      throw new Error('Google Play verification is not configured');
    }
    const auth = this.getAuthClient();
    await auth.authorize();
    const packageName = process.env.GOOGLE_PLAY_PACKAGE_NAME;
    const androidpublisher = google.androidpublisher({ version: 'v3', auth });

    const endpoint = subscriptionId
      ? androidpublisher.purchases.subscriptionsv2.get({
          packageName,
          token: purchaseToken,
        })
      : androidpublisher.purchases.products.get({
          packageName,
          productId: productId || subscriptionId,
          token: purchaseToken,
        });

    const { data } = await endpoint;

    if (subscriptionId) {
      const subscription = data.subscriptionState || 'unknown';
      const lineItem = (data.lineItems || [])[0] || {};
      const expiryMs = Number(
        lineItem.expiryTime || data.lineItems?.[0]?.expiryTime || 0
      );
      return {
        source: 'google_play_store',
        environment: 'production',
        storeIdentifier: String(purchaseToken),
        productId: String(subscriptionId),
        expiresAt: new Date(expiryMs),
        isRevoked:
          subscription === 'SUBSCRIPTION_STATE_EXPIRED' ||
          subscription === 'SUBSCRIPTION_STATE_CANCELED',
        isInBillingRetry: subscription === 'SUBSCRIPTION_STATE_IN_GRACE_PERIOD',
        raw: data,
      };
    }

    return {
      source: 'google_play_store',
      environment: 'production',
      storeIdentifier: String(purchaseToken),
      productId: String(productId),
      expiresAt: new Date(0),
      isRevoked: data.purchaseState === 1,
      isInBillingRetry: false,
      raw: data,
    };
  }
}

module.exports = new GooglePlayReceiptVerifier();
