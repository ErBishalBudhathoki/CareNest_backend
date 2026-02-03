/**
 * Price Prompt Controller
 * Handles API endpoints for missing price prompts during invoice generation
 * Task 2.3: Create price prompt system for missing prices
 *
 * @file backend/controllers/pricePromptController.js
 */

const catchAsync = require('../utils/catchAsync');
const logger = require('../config/logger');
const PricePromptService = require('../services/pricePromptService');
const { createAuditLog } = require('../services/auditService');
const { v4: uuidv4 } = require('uuid');

class PricePromptController {
  /**
   * Create a price prompt for missing pricing
   * POST /api/invoice/price-prompt/create
   */
  createPricePrompt = catchAsync(async (req, res) => {
    const service = new PricePromptService();

    try {
      const promptData = req.body;

      if (!promptData) {
        return res.status(400).json({
          success: false,
          code: 'VALIDATION_ERROR',
          message: 'Prompt data is required'
        });
      }

      // Validate input data
      const validationErrors = service.validatePromptData(promptData);
      if (validationErrors.length > 0) {
        return res.status(400).json({
          success: false,
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          errors: validationErrors
        });
      }

      // Generate session ID if not provided
      if (!promptData.sessionId) {
        promptData.sessionId = uuidv4();
      }

      // Create the price prompt
      const result = await service.createPricePrompt(promptData);

      // Create audit log
      await createAuditLog({
        entityType: 'price_prompt',
        entityId: result.promptId,
        action: 'CREATE',
        userEmail: promptData.userEmail,
        organizationId: promptData.organizationId,
        metadata: {
          ndisItemNumber: promptData.ndisItemNumber,
          clientEmail: promptData.clientEmail,
          sessionId: promptData.sessionId,
          context: 'invoice_generation'
        }
      });

      logger.business('Price prompt created', {
        action: 'PRICE_PROMPT_CREATED',
        promptId: result.promptId,
        sessionId: promptData.sessionId,
        ndisItemNumber: promptData.ndisItemNumber
      });

      res.status(201).json({
        success: true,
        code: 'PRICE_PROMPT_CREATED',
        message: 'Price prompt created successfully',
        data: {
          promptId: result.promptId,
          sessionId: promptData.sessionId,
          prompt: result.prompt
        }
      });
    } finally {
      await service.disconnect();
    }
  });

  /**
   * Resolve a price prompt with user-provided pricing
   * POST /api/invoice/price-prompt/resolve
   */
  resolvePricePrompt = catchAsync(async (req, res) => {
    const service = new PricePromptService();

    try {
      const { promptId, resolution } = req.body;

      if (!promptId) {
        return res.status(400).json({
          success: false,
          code: 'VALIDATION_ERROR',
          message: 'Prompt ID is required'
        });
      }

      if (!resolution) {
        return res.status(400).json({
          success: false,
          code: 'VALIDATION_ERROR',
          message: 'Resolution data is required'
        });
      }

      // Validate resolution data
      const validationErrors = service.validateResolutionData(resolution);
      if (validationErrors.length > 0) {
        return res.status(400).json({
          success: false,
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          errors: validationErrors
        });
      }

      // Resolve the price prompt
      await service.resolvePricePrompt(promptId, resolution);

      // Create audit log
      await createAuditLog({
        entityType: 'price_prompt',
        entityId: promptId,
        action: 'UPDATE',
        userEmail: req.body.userEmail || 'system',
        organizationId: req.body.organizationId,
        metadata: {
          subAction: 'resolve_prompt',
          providedPrice: resolution.providedPrice,
          saveAsCustomPricing: resolution.saveAsCustomPricing,
          applyToClient: resolution.applyToClient,
          applyToOrganization: resolution.applyToOrganization
        }
      });

      logger.business('Price prompt resolved', {
        action: 'PRICE_PROMPT_RESOLVED',
        promptId,
        providedPrice: resolution.providedPrice
      });

      res.status(200).json({
        success: true,
        code: 'PRICE_PROMPT_RESOLVED',
        message: 'Price prompt resolved successfully',
        data: {
          promptId: promptId,
          resolvedPrice: resolution.providedPrice
        }
      });
    } finally {
      await service.disconnect();
    }
  });

  /**
   * Get pending price prompts for a session
   * GET /api/invoice/price-prompt/pending/:sessionId
   */
  getPendingPrompts = catchAsync(async (req, res) => {
    const service = new PricePromptService();

    try {
      const { sessionId } = req.params;

      if (!sessionId) {
        return res.status(400).json({
          success: false,
          code: 'VALIDATION_ERROR',
          message: 'Session ID is required'
        });
      }

      // Get pending prompts
      const result = await service.getPendingPrompts(sessionId);

      logger.business('Pending price prompts retrieved', {
        action: 'PENDING_PROMPTS_RETRIEVED',
        sessionId,
        promptCount: result.prompts.length
      });

      res.status(200).json({
        success: true,
        code: 'PENDING_PROMPTS_RETRIEVED',
        message: 'Pending prompts retrieved successfully',
        data: {
          sessionId: sessionId,
          promptCount: result.prompts.length,
          prompts: result.prompts
        }
      });
    } finally {
      await service.disconnect();
    }
  });

  /**
   * Cancel a price prompt
   * POST /api/invoice/price-prompt/cancel
   */
  cancelPricePrompt = catchAsync(async (req, res) => {
    const service = new PricePromptService();

    try {
      const { promptId } = req.body;

      if (!promptId) {
        return res.status(400).json({
          success: false,
          code: 'VALIDATION_ERROR',
          message: 'Prompt ID is required'
        });
      }

      // Cancel the price prompt
      await service.cancelPricePrompt(promptId);

      // Create audit log
      await createAuditLog({
        entityType: 'price_prompt',
        entityId: promptId,
        action: 'UPDATE',
        userEmail: req.body.userEmail || 'system',
        organizationId: req.body.organizationId,
        metadata: {
          subAction: 'cancel_prompt',
          reason: req.body.reason || 'User cancelled'
        }
      });

      logger.business('Price prompt cancelled', {
        action: 'PRICE_PROMPT_CANCELLED',
        promptId,
        reason: req.body.reason || 'User cancelled'
      });

      res.status(200).json({
        success: true,
        code: 'PRICE_PROMPT_CANCELLED',
        message: 'Price prompt cancelled successfully',
        data: {
          promptId: promptId
        }
      });
    } finally {
      await service.disconnect();
    }
  });

  /**
   * Generate invoice with price prompt handling
   * POST /api/invoice/generate-with-prompts
   */
  generateInvoiceWithPrompts = catchAsync(async (req, res) => {
    const InvoiceGenerationService = require('../services/invoiceGenerationService');
    const invoiceService = new InvoiceGenerationService();
    const promptService = new PricePromptService();

    try {
      const { userEmail, clientEmail, startDate, endDate, sessionId } = req.body;

      if (!userEmail || !clientEmail || !startDate || !endDate) {
        return res.status(400).json({
          success: false,
          code: 'VALIDATION_ERROR',
          message: 'userEmail, clientEmail, startDate, and endDate are required'
        });
      }

      // Validate input parameters
      const validationErrors = invoiceService.validateGenerationParams(userEmail, clientEmail, startDate, endDate);
      if (validationErrors.length > 0) {
        return res.status(400).json({
          success: false,
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          errors: validationErrors
        });
      }

      // Generate session ID if not provided
      const currentSessionId = sessionId || uuidv4();

      // Generate line items
      const result = await invoiceService.generateInvoiceLineItems(userEmail, clientEmail, startDate, endDate);

      // Check for missing prices and create prompts
      const missingPriceItems = [];
      const validItems = [];

      for (let i = 0; i < result.lineItems.length; i++) {
        const item = result.lineItems[i];

        if (item.pricing && (item.pricing.source === 'missing' || item.pricing.requiresManualPricing)) {
          // Create price prompt for missing pricing
          const promptData = {
            ndisItemNumber: item.ndisItemNumber,
            itemDescription: item.description,
            organizationId: item.organizationId,
            clientId: item.clientId,
            userEmail: userEmail,
            clientEmail: clientEmail,
            quantity: item.quantity,
            unit: item.unit,
            suggestedPrice: item.pricing.price || 0,
            priceCap: item.pricing.priceCap,
            state: item.state || 'NSW',
            providerType: item.providerType || 'standard',
            sessionId: currentSessionId,
            lineItemIndex: i
          };

          const promptResult = await promptService.createPricePrompt(promptData);
          missingPriceItems.push({
            lineItemIndex: i,
            item: item,
            promptId: promptResult.promptId
          });
        } else {
          validItems.push(item);
        }
      }

      // Create audit log
      await createAuditLog({
        entityType: 'invoice',
        entityId: result.metadata.assignmentId || 'unknown',
        action: 'CREATE',
        userEmail: userEmail,
        organizationId: result.lineItems[0]?.organizationId,
        metadata: {
          subAction: 'generate_with_prompts',
          clientEmail,
          startDate,
          endDate,
          sessionId: currentSessionId,
          totalItems: result.lineItems.length,
          validItems: validItems.length,
          missingPriceItems: missingPriceItems.length,
          extractionMethod: 'clientAssignment-based'
        }
      });

      logger.business('Invoice generated with prompts', {
        action: 'INVOICE_GENERATED_WITH_PROMPTS',
        userEmail,
        clientEmail,
        sessionId: currentSessionId,
        totalItems: result.lineItems.length,
        validItems: validItems.length,
        missingPriceItems: missingPriceItems.length
      });

      res.status(200).json({
        success: true,
        code: 'INVOICE_GENERATED_WITH_PROMPTS',
        message: missingPriceItems.length > 0
          ? 'Invoice generated with price prompts required'
          : 'Invoice generated successfully',
        data: {
          sessionId: currentSessionId,
          lineItems: result.lineItems,
          validItems: validItems,
          missingPriceItems: missingPriceItems,
          metadata: result.metadata,
          requiresPricePrompts: missingPriceItems.length > 0,
          promptCount: missingPriceItems.length
        }
      });
    } finally {
      await invoiceService.disconnect();
      await promptService.disconnect();
    }
  });

  /**
   * Complete invoice generation after all prompts are resolved
   * POST /api/invoice/complete-generation
   */
  completeInvoiceGeneration = catchAsync(async (req, res) => {
    const promptService = new PricePromptService();

    try {
      const { sessionId, lineItems } = req.body;

      if (!sessionId) {
        return res.status(400).json({
          success: false,
          code: 'VALIDATION_ERROR',
          message: 'Session ID is required'
        });
      }

      // Get all prompts for this session to verify they're resolved
      const pendingPrompts = await promptService.getPendingPrompts(sessionId);

      if (pendingPrompts.prompts.length > 0) {
        return res.status(400).json({
          success: false,
          code: 'PENDING_PROMPTS_EXIST',
          message: 'Cannot complete invoice generation with pending price prompts',
          data: {
            pendingPrompts: pendingPrompts.prompts.length
          }
        });
      }

      // Create audit log for completion
      await createAuditLog({
        entityType: 'invoice',
        entityId: sessionId,
        action: 'CREATE',
        userEmail: req.body.userEmail || 'system',
        organizationId: req.body.organizationId,
        metadata: {
          subAction: 'complete_generation',
          sessionId: sessionId,
          finalItemCount: lineItems?.length || 0
        }
      });

      logger.business('Invoice generation completed', {
        action: 'INVOICE_GENERATION_COMPLETED',
        sessionId,
        finalItemCount: lineItems?.length || 0
      });

      res.status(200).json({
        success: true,
        code: 'INVOICE_GENERATION_COMPLETED',
        message: 'Invoice generation completed successfully',
        data: {
          sessionId: sessionId,
          status: 'completed'
        }
      });
    } finally {
      await promptService.disconnect();
    }
  });
}

module.exports = new PricePromptController();
