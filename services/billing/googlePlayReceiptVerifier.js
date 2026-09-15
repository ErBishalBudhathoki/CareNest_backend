/**
 * Google Play purchase verification. Uses the Google Play Developer API
 * (publisher subscriptionsv2 endpoint) to fetch a verified subscription state.
 *
 * Credentials are resolved in this order:
 *   1. Explicit service-account key (GOOGLE_PLAY_CLIENT_EMAIL +
 *      GOOGLE_PLAY_PRIVATE_KEY) if provided.
 *   2. Application Default Credentials (ADC) — on Cloud Run this is the
 *      runtime service account. Grant that account access in Play Console
 *      (Setup → API access). No private key is stored when using ADC.
 *
 * Secrets never appear in this file.
 */

const ANDROID_PUBLISHER_SCOPE =
  'https://www.googleapis.com/auth/androidpublisher';

class GooglePlayReceiptVerifier {
  hasServiceAccountKey() {
    return Boolean(
      process.env.GOOGLE_PLAY_CLIENT_EMAIL && process.env.GOOGLE_PLAY_PRIVATE_KEY
    );
  }

  isConfigured() {
    // Package name is always required. Credentials may come from a key file or
    // from Application Default Credentials (runtime service account).
    return Boolean(process.env.GOOGLE_PLAY_PACKAGE_NAME);
  }

  async getAuthClient() {
    // Lazy import: googleapis is only needed when Google verification is
    // actually used, keeping the module loadable in every environment.
    const { google } = require('googleapis');

    if (this.hasServiceAccountKey()) {
      const jwtClient = new google.auth.JWT({
        email: process.env.GOOGLE_PLAY_CLIENT_EMAIL,
        key: process.env.GOOGLE_PLAY_PRIVATE_KEY,
        scopes: [ANDROID_PUBLISHER_SCOPE],
      });
      await jwtClient.authorize();
      return jwtClient;
    }

    // Application Default Credentials (Cloud Run runtime service account).
    const googleAuth = new google.auth.GoogleAuth({
      scopes: [ANDROID_PUBLISHER_SCOPE],
    });
    return googleAuth.getClient();
  }

  _latestExpiryMs(lineItems) {
    const items = Array.isArray(lineItems) ? lineItems : [];
    let latest = 0;
    for (const item of items) {
      const raw = item?.expiryTime;
      if (raw === undefined || raw === null || raw === '') continue;

      // Play returns an RFC3339 string (e.g. "2026-10-14T08:00:00Z"); some
      // responses use an epoch-millis number/string. Handle both.
      let ms = typeof raw === 'number' ? raw : Number(raw);
      if (!Number.isFinite(ms) || ms === 0) {
        const parsed = Date.parse(String(raw));
        if (!Number.isNaN(parsed)) ms = parsed;
      }
      if (Number.isFinite(ms) && ms > latest) latest = ms;
    }
    return latest;
  }

  async verify({ purchaseToken, productId, subscriptionId }) {
    if (!this.isConfigured()) {
      throw new Error('Google Play verification is not configured');
    }

    const { google } = require('googleapis');
    const auth = await this.getAuthClient();
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
      const state = String(
        data.subscriptionState || 'SUBSCRIPTION_STATE_UNSPECIFIED'
      );
      const lineItem = (data.lineItems || [])[0] || {};
      const expiryMs = this._latestExpiryMs(data.lineItems);
      // If Stripe-like "expired" state, mark revoked so the gate blocks it.
      // CANCELED still grants access until expiryTime passes (expiry handles
      // that), so it is not treated as revoked here.
      const isExpired = state === 'SUBSCRIPTION_STATE_EXPIRED';
      const isInBillingRetry =
        state === 'SUBSCRIPTION_STATE_IN_GRACE_PERIOD' ||
        state === 'SUBSCRIPTION_STATE_ON_HOLD';

      return {
        source: 'google_play_store',
        environment: 'production',
        storeIdentifier: String(purchaseToken),
        productId: String(lineItem.productId || subscriptionId),
        expiresAt: new Date(expiryMs || 0),
        isRevoked: isExpired,
        isInBillingRetry,
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
