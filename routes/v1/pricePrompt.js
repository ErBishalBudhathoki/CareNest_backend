/**
 * Price Prompt Routes
 * Express router for price prompt functionality
 * 
 * @file backend/routes/v1/pricePrompt.js
 */

const express = require('express');
const PricePromptController = require('../../controllers/pricePromptController');
const router = express.Router();

// Create a price prompt for missing pricing
// POST /api/invoice/price-prompt/create
router.post('/price-prompt/create', PricePromptController.createPricePrompt);

// Resolve a price prompt with user-provided pricing
// POST /api/invoice/price-prompt/resolve
router.post('/price-prompt/resolve', PricePromptController.resolvePricePrompt);

// Get pending price prompts for a session
// GET /api/invoice/price-prompt/pending/:sessionId
router.get('/price-prompt/pending/:sessionId', PricePromptController.getPendingPrompts);

// Cancel a price prompt
// POST /api/invoice/price-prompt/cancel
router.post('/price-prompt/cancel', PricePromptController.cancelPricePrompt);

// Generate invoice with price prompt handling
// POST /api/invoice/generate-with-prompts
router.post('/generate-with-prompts', PricePromptController.generateInvoiceWithPrompts);

// Complete invoice generation after all prompts are resolved
// POST /api/invoice/complete-generation
router.post('/complete-generation', PricePromptController.completeInvoiceGeneration);

module.exports = router;
