const mongoose = require('mongoose');

/**
 * A device public key registered for invoice signing.
 *
 * Each device that generates invoices holds its own Ed25519 private key in the
 * platform keystore and registers only the public half here. Signing is
 * per-device; verification is therefore cross-device, because the verifier
 * needs nothing but this table.
 *
 * The alternative — one shared secret per organisation — was rejected: every
 * device would then hold the *signing* key, and so would this server, so a
 * single compromised device (or this database) would let an attacker sign
 * arbitrary invoices for the organisation. Holding only public keys means the
 * blast radius of a stolen key is one device, and revoking it is a status flip.
 */
const deviceSigningKeySchema = new mongoose.Schema(
  {
    // Stable identifier for the device's key. Emitted in the PDF metadata so a
    // verifier knows which public key to use.
    deviceKeyId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    organizationId: {
      type: String,
      required: true,
      index: true,
    },
    // Base64-encoded raw Ed25519 public key (32 bytes).
    publicKeyBase64: {
      type: String,
      required: true,
    },
    algorithm: {
      type: String,
      default: 'Ed25519',
      enum: ['Ed25519'],
    },
    // Active keys can sign and verify. Revoked keys remain readable so old
    // invoices issued by them stay verifiable, which is the whole point of
    // having a signature in the first place.
    status: {
      type: String,
      enum: ['active', 'revoked'],
      default: 'active',
      index: true,
    },
    // Populated when a key is superseded, so an operator can see why it changed.
    revokedAt: Date,
    revocationReason: String,
    lastSeenAt: Date,
    registrationIp: String,
  },
  {
    timestamps: true,
    // Naming follows the mongoose default (collection named after the model).
    versionKey: false,
  }
);

// The common lookup is "all active keys for this org", used when a verifier is
// given a key id but needs to confirm it really belongs to the org.
deviceSigningKeySchema.index({ organizationId: 1, status: 1 });

module.exports = mongoose.model('DeviceSigningKey', deviceSigningKeySchema);
