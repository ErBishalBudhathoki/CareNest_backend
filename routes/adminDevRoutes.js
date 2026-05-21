const express = require('express');
const router = express.Router();
const path = require('path');
const Organization = require('../models/Organization');

// Simple basic auth middleware for the dev tool
const devAuth = (req, res, next) => {
  const b64auth = (req.headers.authorization || '').split(' ')[1] || '';
  const [login, password] = Buffer.from(b64auth, 'base64').toString().split(':');

  const adminUser = process.env.ADMIN_DEV_USER || 'admin';
  const adminPass = process.env.ADMIN_DEV_PASSWORD;

  if (login && password && login === adminUser && password === adminPass && adminPass) {
    return next();
  }

  res.set('WWW-Authenticate', 'Basic realm="401"');
  res.status(401).send('Authentication required. Missing or incorrect ADMIN_DEV_PASSWORD.');
};

// Serve the Admin Dev Tool HTML page
router.get('/', devAuth, (req, res) => {
  res.sendFile(path.join(__dirname, '../views/admin_dev_tool.html'));
});

// Get all organizations and their AI settings
router.get('/api/organizations', devAuth, async (req, res) => {
  try {
    const orgs = await Organization.find({}).select('name organizationCode settings.aiInvoiceGeneration');
    res.json({ success: true, data: orgs });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Update AI settings for a specific organization
router.post('/api/organizations/:id/ai-settings', devAuth, async (req, res) => {
  try {
    const { frequency } = req.body;
    if (!['manual', 'weekly', 'monthly', 'off'].includes(frequency)) {
      return res.status(400).json({ success: false, message: 'Invalid frequency' });
    }

    const org = await Organization.findById(req.params.id);
    if (!org) return res.status(404).json({ success: false, message: 'Organization not found' });

    if (!org.settings) org.settings = {};
    if (!org.settings.aiInvoiceGeneration) org.settings.aiInvoiceGeneration = {};
    
    org.settings.aiInvoiceGeneration.frequency = frequency;
    await org.save();

    res.json({ success: true, message: 'Settings updated successfully' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Global override for all organizations
router.post('/api/organizations/global-ai-settings', devAuth, async (req, res) => {
  try {
    const { frequency } = req.body;
    if (!['manual', 'weekly', 'monthly', 'off'].includes(frequency)) {
      return res.status(400).json({ success: false, message: 'Invalid frequency' });
    }

    await Organization.updateMany(
      {},
      { $set: { 'settings.aiInvoiceGeneration.frequency': frequency } }
    );

    res.json({ success: true, message: `All organizations updated to ${frequency}` });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
