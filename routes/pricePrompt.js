const express = require('express');
const router = express.Router();
const logger = require('../config/logger');
const {
  createPricePrompt,
  resolvePricePrompt,
  getPendingPricePrompts,
  cancelPricePrompt,
  generateInvoiceWithPromptHandling,
  completeInvoiceGenerationAfterPrompts
} = require('../services/pricePromptService');

// Create a new price prompt for missing pricing
router.post('/api/price-prompts/create', async (req, res) => {
  try {
    const {
      organizationId,
      supportItemNumber,
      clientId,
      serviceDate,
      requestedBy,
      context,
      priority = 'medium'
    } = req.body;
    
    const result = await createPricePrompt({
      organizationId,
      supportItemNumber,
      clientId,
      serviceDate,
      requestedBy,
      context,
      priority
    });
    
    res.json(result);
  } catch (error) {
    logger.error('Price prompt creation failed', {
      error: error.message,
      stack: error.stack,
      organizationId: req.body.organizationId,
      supportItemNumber: req.body.supportItemNumber,
      clientId: req.body.clientId,
      serviceDate: req.body.serviceDate,
      requestedBy: req.body.requestedBy,
      priority: req.body.priority
    });
    res.status(500).json({ error: 'Failed to create price prompt' });
  }
});

// Resolve a price prompt with pricing information
router.post('/api/price-prompts/:promptId/resolve', async (req, res) => {
  try {
    const { promptId } = req.params;
    const {
      price,
      resolvedBy,
      notes,
      createCustomPricing = false
    } = req.body;
    
    const result = await resolvePricePrompt(promptId, {
      price,
      resolvedBy,
      notes,
      createCustomPricing
    });
    
    res.json(result);
  } catch (error) {
    logger.error('Price prompt resolution failed', {
      error: error.message,
      stack: error.stack,
      promptId: req.params.promptId,
      price: req.body.price,
      resolvedBy: req.body.resolvedBy,
      createCustomPricing: req.body.createCustomPricing
    });
    res.status(500).json({ error: 'Failed to resolve price prompt' });
  }
});

// Get pending price prompts for an organization
router.get('/api/price-prompts/pending/:organizationId', async (req, res) => {
  try {
    const { organizationId } = req.params;
    const {
      priority,
      supportItemNumber,
      clientId,
      page = 1,
      limit = 50
    } = req.query;
    
    const result = await getPendingPricePrompts(organizationId, {
      priority,
      supportItemNumber,
      clientId,
      page: parseInt(page),
      limit: parseInt(limit)
    });
    
    res.json(result);
  } catch (error) {
    logger.error('Pending price prompts fetch failed', {
      error: error.message,
      stack: error.stack,
      organizationId: req.params.organizationId,
      priority: req.query.priority,
      supportItemNumber: req.query.supportItemNumber,
      clientId: req.query.clientId,
      page: req.query.page,
      limit: req.query.limit
    });
    res.status(500).json({ error: 'Failed to fetch pending price prompts' });
  }
});

// Cancel a price prompt
router.delete('/api/price-prompts/:promptId', async (req, res) => {
  try {
    const { promptId } = req.params;
    const { cancelledBy, reason } = req.body;
    
    const result = await cancelPricePrompt(promptId, {
      cancelledBy,
      reason
    });
    
    res.json(result);
  } catch (error) {
    logger.error('Price prompt cancellation failed', {
      error: error.message,
      stack: error.stack,
      promptId: req.params.promptId,
      cancelledBy: req.body.cancelledBy,
      reason: req.body.reason
    });
    res.status(500).json({ error: 'Failed to cancel price prompt' });
  }
});

// Generate invoice with prompt handling for missing prices
router.post('/api/price-prompts/generate-invoice', async (req, res) => {
  try {
    const {
      organizationId,
      clientId,
      startDate,
      endDate,
      requestedBy,
      autoCreatePrompts = true
    } = req.body;
    
    const result = await generateInvoiceWithPromptHandling({
      organizationId,
      clientId,
      startDate,
      endDate,
      requestedBy,
      autoCreatePrompts
    });
    
    res.json(result);
  } catch (error) {
    logger.error('Invoice generation with prompt handling failed', {
      error: error.message,
      stack: error.stack,
      organizationId: req.body.organizationId,
      clientId: req.body.clientId,
      startDate: req.body.startDate,
      endDate: req.body.endDate,
      requestedBy: req.body.requestedBy,
      autoCreatePrompts: req.body.autoCreatePrompts
    });
    res.status(500).json({ error: 'Failed to generate invoice with prompt handling' });
  }
});

// Complete invoice generation after all prompts are resolved
router.post('/api/price-prompts/complete-invoice/:invoiceId', async (req, res) => {
  try {
    const { invoiceId } = req.params;
    const { completedBy } = req.body;
    
    const result = await completeInvoiceGenerationAfterPrompts(invoiceId, {
      completedBy
    });
    
    res.json(result);
  } catch (error) {
    logger.error('Invoice generation completion failed', {
      error: error.message,
      stack: error.stack,
      invoiceId: req.params.invoiceId,
      completedBy: req.body.completedBy
    });
    res.status(500).json({ error: 'Failed to complete invoice generation' });
  }
});

module.exports = router;