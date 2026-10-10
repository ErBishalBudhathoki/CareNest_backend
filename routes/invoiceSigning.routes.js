/**
 * Invoice signing — device key registration and lookup.
 *
 * Devices that generate invoices register the public half of their Ed25519
 * keypair here. The private half never leaves the platform keystore, so this
 * server holds nothing an attacker could use to forge an invoice.
 *
 * This is deliberately separate from the admin-dev console: registration is
 * called by the app on behalf of real devices, using normal app auth, while the
 * console endpoints are basic-auth gated and operator-facing.
 */
const express = require('express');
const router = express.Router();

const { authenticateUser } = require('../middleware/auth');
const DeviceSigningKey = require('../models/DeviceSigningKey');
const svc = require('../services/invoiceSignatureService');

router.use(authenticateUser);

const RAW_ED25519_LENGTH = 32;

/**
 * Registers or replaces a device public key.
 *
 * A device re-registering an existing key id is a no-op refresh (updates
 * lastSeenAt), not a rotation: registering a *different* key under the same id
 * would silently invalidate every invoice that device already issued, so it is
 * rejected instead and the operator must rotate explicitly.
 */
router.post('/register', async (req, res) => {
  try {
    const { deviceKeyId, publicKeyBase64 } = req.body || {};

    if (!deviceKeyId || typeof deviceKeyId !== 'string') {
      return res.status(400).json({ success: false, message: 'deviceKeyId is required' });
    }
    if (!publicKeyBase64 || typeof publicKeyBase64 !== 'string') {
      return res.status(400).json({ success: false, message: 'publicKeyBase64 is required' });
    }

    // Validate the key is actually a usable Ed25519 public key before storing
    // it, so a malformed registration is caught at the door rather than at the
    // first verification attempt, when it is too late to fix.
    let raw;
    let key;
    try {
      raw = Buffer.from(publicKeyBase64, 'base64');
      key = svc.publicKeyFromBase64(publicKeyBase64);
    } catch (e) {
      return res.status(400).json({ success: false, message: 'key is not a valid Ed25519 public key' });
    }
    if (!key) return res.status(500).json({ success: false, message: 'key validation unavailable' });

    if (raw.length !== RAW_ED25519_LENGTH && raw.length !== 44) {
      return res.status(400).json({
        success: false,
        message: `public key must be ${RAW_ED25519_LENGTH} raw bytes (or 44-byte SPKI DER)`,
      });
    }

    const organizationId = String(req.user.organizationId || req.user.organization || '');
    if (!organizationId) {
      return res.status(400).json({ success: false, message: 'Signed-in account has no organizationId' });
    }

    const existing = await DeviceSigningKey.findOne({ deviceKeyId }).lean();
    const now = new Date();

    if (existing) {
      if (existing.status !== 'active') {
        return res.status(409).json({ success: false, message: 'This device key has been revoked' });
      }
      if (existing.publicKeyBase64 !== publicKeyBase64) {
        return res.status(409).json({
          success: false,
          message:
            'deviceKeyId is already registered with a different public key. Rotate explicitly rather than re-registering.',
        });
      }
      await DeviceSigningKey.updateOne(
        { deviceKeyId },
        { $set: { lastSeenAt: now } }
      );
      return res.json({ success: true, data: { deviceKeyId, status: 'active', refreshed: true } });
    }

    await DeviceSigningKey.create({
      deviceKeyId,
      organizationId,
      publicKeyBase64,
      algorithm: 'Ed25519',
      status: 'active',
      lastSeenAt: now,
      registrationIp: req.ip || null,
    });

    res.status(201).json({
      success: true,
      data: { deviceKeyId, status: 'active', canonicalVersion: svc.CANONICAL_VERSION },
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/** Public keys for the caller's organisation. */
router.get('/', async (req, res) => {
  try {
    const organizationId = String(req.user.organizationId || req.user.organization || '');
    const keys = await DeviceSigningKey.find(organizationId ? { organizationId } : {})
      .select('-__v')
      .sort({ createdAt: -1 })
      .lean();
    res.json({ success: true, data: keys, total: keys.length });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
