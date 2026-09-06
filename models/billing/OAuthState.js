const mongoose = require('mongoose');

/**
 * Short-lived one-time state used by the Stripe Connect OAuth flow. Only
 * a hash of the state is stored; the original is sent to the user agent
 * and consumed atomically on callback to defeat fixation and replay.
 */
const oauthStateSchema = new mongoose.Schema(
  {
    stateHash: { type: String, required: true, unique: true },
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
    },
    initiatingUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    purpose: { type: String, enum: ['stripe_connect_existing_account'], required: true },
    expiresAt: { type: Date, required: true, index: true },
    consumedAt: { type: Date },
  },
  { timestamps: true, collection: 'oauth_states' }
);

module.exports = mongoose.model('OAuthState', oauthStateSchema);
