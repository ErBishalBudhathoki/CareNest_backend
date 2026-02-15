const Organization = require('../models/Organization');
const IntegrationLog = require('../models/IntegrationLog');
const integrationService = require('../services/integrationService');
const logger = require('../utils/logger');

/**
 * Get all integrations for an organization
 */
exports.getIntegrations = async (req, res) => {
  try {
    const { organizationId } = req.params;

    const organization = await Organization.findById(organizationId);
    if (!organization) {
      return res.status(404).json({
        success: false,
        message: 'Organization not found',
      });
    }

    res.json({
      success: true,
      integrations: organization.integrations || {},
    });
  } catch (error) {
    logger.error('Error getting integrations:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get integrations',
      error: error.message,
    });
  }
};

/**
 * Connect an integration
 */
exports.connectIntegration = async (req, res) => {
  try {
    const { organizationId } = req.params;
    const { integrationType, apiKey, accessToken, refreshToken, metadata } = req.body;

    if (!integrationType) {
      return res.status(400).json({
        success: false,
        message: 'Integration type is required',
      });
    }

    const organization = await Organization.findById(organizationId);
    if (!organization) {
      return res.status(404).json({
        success: false,
        message: 'Organization not found',
      });
    }

    // Initialize integrations object if it doesn't exist
    if (!organization.integrations) {
      organization.integrations = {};
    }

    // Create integration config
    const integrationConfig = {
      isConnected: true,
      connectedAt: new Date(),
    };

    if (apiKey) integrationConfig.apiKey = apiKey;
    if (accessToken) integrationConfig.accessToken = accessToken;
    if (refreshToken) integrationConfig.refreshToken = refreshToken;
    if (metadata) integrationConfig.metadata = metadata;

    // Update the specific integration
    organization.integrations[integrationType] = integrationConfig;
    organization.markModified('integrations');
    
    await organization.save();

    // Log the integration connection
    await IntegrationLog.create({
      organizationId,
      integrationType,
      action: 'connect',
      status: 'success',
      userId: req.user?.id,
      timestamp: new Date(),
    });

    logger.info(`Integration ${integrationType} connected for organization ${organizationId}`);

    res.json({
      success: true,
      message: `${integrationType} integration connected successfully`,
      integration: organization.integrations[integrationType],
    });
  } catch (error) {
    logger.error('Error connecting integration:', error);
    
    // Log the failed attempt
    try {
      await IntegrationLog.create({
        organizationId: req.params.organizationId,
        integrationType: req.body.integrationType,
        action: 'connect',
        status: 'failed',
        error: error.message,
        userId: req.user?.id,
        timestamp: new Date(),
      });
    } catch (logError) {
      logger.error('Error logging integration failure:', logError);
    }

    res.status(500).json({
      success: false,
      message: 'Failed to connect integration',
      error: error.message,
    });
  }
};

/**
 * Disconnect an integration
 */
exports.disconnectIntegration = async (req, res) => {
  try {
    const { organizationId } = req.params;
    const { integrationType } = req.body;

    if (!integrationType) {
      return res.status(400).json({
        success: false,
        message: 'Integration type is required',
      });
    }

    const organization = await Organization.findById(organizationId);
    if (!organization) {
      return res.status(404).json({
        success: false,
        message: 'Organization not found',
      });
    }

    if (!organization.integrations || !organization.integrations[integrationType]) {
      return res.status(404).json({
        success: false,
        message: 'Integration not found',
      });
    }

    // Mark as disconnected but keep the config for history
    organization.integrations[integrationType].isConnected = false;
    organization.integrations[integrationType].disconnectedAt = new Date();
    organization.markModified('integrations');
    
    await organization.save();

    // Log the disconnection
    await IntegrationLog.create({
      organizationId,
      integrationType,
      action: 'disconnect',
      status: 'success',
      userId: req.user?.id,
      timestamp: new Date(),
    });

    logger.info(`Integration ${integrationType} disconnected for organization ${organizationId}`);

    res.json({
      success: true,
      message: `${integrationType} integration disconnected successfully`,
    });
  } catch (error) {
    logger.error('Error disconnecting integration:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to disconnect integration',
      error: error.message,
    });
  }
};

/**
 * Get OAuth authorization URL
 */
exports.getAuthUrl = async (req, res) => {
  try {
    const { organizationId } = req.params;
    const { integrationType, redirectUri } = req.body;

    if (!integrationType) {
      return res.status(400).json({
        success: false,
        message: 'Integration type is required',
      });
    }

    const authUrl = await integrationService.getAuthorizationUrl(
      integrationType,
      organizationId,
      redirectUri
    );

    res.json({
      success: true,
      authUrl,
      integrationType,
    });
  } catch (error) {
    logger.error('Error getting auth URL:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get authorization URL',
      error: error.message,
    });
  }
};

/**
 * Handle OAuth callback
 */
exports.handleCallback = async (req, res) => {
  try {
    const { organizationId } = req.params;
    const { integrationType, code, state } = req.body;

    if (!integrationType || !code) {
      return res.status(400).json({
        success: false,
        message: 'Integration type and authorization code are required',
      });
    }

    const tokens = await integrationService.exchangeCodeForTokens(
      integrationType,
      code,
      organizationId
    );

    const organization = await Organization.findById(organizationId);
    if (!organization) {
      return res.status(404).json({
        success: false,
        message: 'Organization not found',
      });
    }

    if (!organization.integrations) {
      organization.integrations = {};
    }

    organization.integrations[integrationType] = {
      isConnected: true,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      connectedAt: new Date(),
      metadata: tokens.metadata || {},
    };
    organization.markModified('integrations');
    
    await organization.save();

    // Log the successful OAuth connection
    await IntegrationLog.create({
      organizationId,
      integrationType,
      action: 'oauth_connect',
      status: 'success',
      userId: req.user?.id,
      timestamp: new Date(),
    });

    res.json({
      success: true,
      message: `${integrationType} integration connected successfully via OAuth`,
    });
  } catch (error) {
    logger.error('Error handling OAuth callback:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to complete OAuth flow',
      error: error.message,
    });
  }
};

/**
 * Sync data with integration
 */
exports.syncIntegration = async (req, res) => {
  try {
    const { organizationId } = req.params;
    const { integrationType, options } = req.body;

    if (!integrationType) {
      return res.status(400).json({
        success: false,
        message: 'Integration type is required',
      });
    }

    const organization = await Organization.findById(organizationId);
    if (!organization) {
      return res.status(404).json({
        success: false,
        message: 'Organization not found',
      });
    }

    if (!organization.integrations?.[integrationType]?.isConnected) {
      return res.status(400).json({
        success: false,
        message: 'Integration is not connected',
      });
    }

    const syncResult = await integrationService.syncData(
      integrationType,
      organizationId,
      organization.integrations[integrationType],
      options
    );

    // Update last sync time
    organization.integrations[integrationType].lastSyncAt = new Date();
    organization.markModified('integrations');
    await organization.save();

    // Log the sync
    await IntegrationLog.create({
      organizationId,
      integrationType,
      action: 'sync',
      status: 'success',
      metadata: { recordsSynced: syncResult.recordsSynced },
      userId: req.user?.id,
      timestamp: new Date(),
    });

    res.json({
      success: true,
      message: 'Sync completed successfully',
      result: syncResult,
    });
  } catch (error) {
    logger.error('Error syncing integration:', error);
    
    // Log the failed sync
    try {
      await IntegrationLog.create({
        organizationId: req.params.organizationId,
        integrationType: req.body.integrationType,
        action: 'sync',
        status: 'failed',
        error: error.message,
        userId: req.user?.id,
        timestamp: new Date(),
      });
    } catch (logError) {
      logger.error('Error logging sync failure:', logError);
    }

    res.status(500).json({
      success: false,
      message: 'Failed to sync integration',
      error: error.message,
    });
  }
};

/**
 * Test integration connection
 */
exports.testIntegration = async (req, res) => {
  try {
    const { organizationId } = req.params;
    const { integrationType } = req.body;

    if (!integrationType) {
      return res.status(400).json({
        success: false,
        message: 'Integration type is required',
      });
    }

    const organization = await Organization.findById(organizationId);
    if (!organization) {
      return res.status(404).json({
        success: false,
        message: 'Organization not found',
      });
    }

    if (!organization.integrations?.[integrationType]?.isConnected) {
      return res.status(400).json({
        success: false,
        message: 'Integration is not connected',
      });
    }

    const testResult = await integrationService.testConnection(
      integrationType,
      organization.integrations[integrationType]
    );

    res.json({
      success: true,
      message: 'Integration test completed',
      result: testResult,
    });
  } catch (error) {
    logger.error('Error testing integration:', error);
    res.status(500).json({
      success: false,
      message: 'Integration test failed',
      error: error.message,
    });
  }
};

/**
 * Get sync history
 */
exports.getSyncHistory = async (req, res) => {
  try {
    const { organizationId, integrationType } = req.params;
    const limit = parseInt(req.query.limit) || 50;

    const history = await IntegrationLog.find({
      organizationId,
      integrationType,
      action: 'sync',
    })
      .sort({ timestamp: -1 })
      .limit(limit)
      .lean();

    res.json({
      success: true,
      history,
    });
  } catch (error) {
    logger.error('Error getting sync history:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get sync history',
      error: error.message,
    });
  }
};

/**
 * Update integration settings
 */
exports.updateSettings = async (req, res) => {
  try {
    const { organizationId } = req.params;
    const { integrationType, settings } = req.body;

    if (!integrationType || !settings) {
      return res.status(400).json({
        success: false,
        message: 'Integration type and settings are required',
      });
    }

    const organization = await Organization.findById(organizationId);
    if (!organization) {
      return res.status(404).json({
        success: false,
        message: 'Organization not found',
      });
    }

    if (!organization.integrations?.[integrationType]) {
      return res.status(404).json({
        success: false,
        message: 'Integration not found',
      });
    }

    // Update settings
    organization.integrations[integrationType].metadata = {
      ...organization.integrations[integrationType].metadata,
      ...settings,
    };
    organization.markModified('integrations');
    await organization.save();

    res.json({
      success: true,
      message: 'Integration settings updated successfully',
    });
  } catch (error) {
    logger.error('Error updating integration settings:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update integration settings',
      error: error.message,
    });
  }
};

/**
 * Handle webhook from integration
 */
exports.handleWebhook = async (req, res) => {
  try {
    const { integrationType } = req.params;
    const payload = req.body;

    logger.info(`Received webhook from ${integrationType}:`, payload);

    await integrationService.handleWebhook(integrationType, payload);

    res.json({
      success: true,
      message: 'Webhook processed successfully',
    });
  } catch (error) {
    logger.error('Error handling webhook:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to process webhook',
      error: error.message,
    });
  }
};
