const express = require('express');
const router = express.Router();
const integrationController = require('../controllers/integrationController');
const { authenticateUser } = require('../middleware/auth');

// All routes require authentication
router.use(authenticateUser);

// Get all integrations for an organization
router.get('/:organizationId', integrationController.getIntegrations);

// Connect an integration
router.post('/:organizationId/connect', integrationController.connectIntegration);

// Disconnect an integration
router.post('/:organizationId/disconnect', integrationController.disconnectIntegration);

// Get OAuth authorization URL
router.post('/:organizationId/auth-url', integrationController.getAuthUrl);

// Handle OAuth callback
router.post('/:organizationId/callback', integrationController.handleCallback);

// Sync data with integration
router.post('/:organizationId/sync', integrationController.syncIntegration);

// Test integration connection
router.post('/:organizationId/test', integrationController.testIntegration);

// Get sync history
router.get('/:organizationId/sync-history/:integrationType', integrationController.getSyncHistory);

// Update integration settings
router.put('/:organizationId/settings', integrationController.updateSettings);

// Webhook endpoints for integrations
router.post('/webhook/:integrationType', integrationController.handleWebhook);

module.exports = router;
