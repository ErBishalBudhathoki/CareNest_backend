/**
 * Price Prompt Controller
 * Handles API endpoints for missing price prompts during invoice generation
 * Task 2.3: Create price prompt system for missing prices
 * 
 * @file backend/controllers/pricePromptController.js
 */

const PricePromptService = require('../services/pricePromptService');
const { createAuditLog } = require('../services/auditService');
const { v4: uuidv4 } = require('uuid');
const logger = require('../config/logger');

class PricePromptController {
  /**
   * Create a price prompt for missing pricing
   * POST /api/invoice/price-prompt/create
   */
  static async createPricePrompt(req, res) {
    const service = new PricePromptService();
    
    try {
      const promptData = req.body;
      
      // Validate input data
      const validationErrors = service.validatePromptData(promptData);
      if (validationErrors.length > 0) {
        return res.status(400).json({
          success: false,
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
        action: 'CREATE', // Using standard action from service
        userEmail: promptData.userEmail,
        organizationId: promptData.organizationId,
        metadata: {
          ndisItemNumber: promptData.ndisItemNumber,
          clientEmail: promptData.clientEmail,
          sessionId: promptData.sessionId,
          context: 'invoice_generation'
        }
      });

      res.json({
        success: true,
        message: 'Price prompt created successfully',
        data: {
          promptId: result.promptId,
          sessionId: promptData.sessionId,
          prompt: result.prompt
        }
      });
      
    } catch (error) {
      logger.error('Error creating price prompt', {
        error: error.message,
        stack: error.stack,
        promptData: req.body
      });
      res.status(500).json({
        success: false,
        message: 'Failed to create price prompt',
        error: error.message
      });
    } finally {
      await service.disconnect();
    }
  }

  /**
   * Resolve a price prompt with user-provided pricing
   * POST /api/invoice/price-prompt/resolve
   */
  static async resolvePricePrompt(req, res) {
    const service = new PricePromptService();
    
    try {
      const { promptId, resolution } = req.body;
      
      if (!promptId) {
        return res.status(400).json({
          success: false,
          message: 'Prompt ID is required'
        });
      }

      // Validate resolution data
      const validationErrors = service.validateResolutionData(resolution);
      if (validationErrors.length > 0) {
        return res.status(400).json({
          success: false,
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
        action: 'UPDATE', // Using standard action
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

      res.json({
        success: true,
        message: 'Price prompt resolved successfully',
        data: {
          promptId: promptId,
          resolvedPrice: resolution.providedPrice
        }
      });
      
    } catch (error) {
      logger.error('Error resolving price prompt', {
        error: error.message,
        stack: error.stack,
        promptId: req.body.promptId,
        resolutionData: req.body
      });
      res.status(500).json({
        success: false,
        message: 'Failed to resolve price prompt',
        error: error.message
      });
    } finally {
      await service.disconnect();
    }
  }

  /**
   * Get pending price prompts for a session
   * GET /api/invoice/price-prompt/pending/:sessionId
   */
  static async getPendingPrompts(req, res) {
    const service = new PricePromptService();
    
    try {
      const { sessionId } = req.params;
      
      if (!sessionId) {
        return res.status(400).json({
          success: false,
          message: 'Session ID is required'
        });
      }

      // Get pending prompts
      const result = await service.getPendingPrompts(sessionId);
      
      res.json({
        success: true,
        message: 'Pending prompts retrieved successfully',
        data: {
          sessionId: sessionId,
          promptCount: result.prompts.length,
          prompts: result.prompts
        }
      });
      
    } catch (error) {
      logger.error('Error getting pending prompts', {
        error: error.message,
        stack: error.stack,
        sessionId: req.params.sessionId
      });
      res.status(500).json({
        success: false,
        message: 'Failed to get pending prompts',
        error: error.message
      });
    } finally {
      await service.disconnect();
    }
  }

  /**
   * Cancel a price prompt
   * POST /api/invoice/price-prompt/cancel
   */
  static async cancelPricePrompt(req, res) {
    const service = new PricePromptService();
    
    try {
      const { promptId } = req.body;
      
      if (!promptId) {
        return res.status(400).json({
          success: false,
          message: 'Prompt ID is required'
        });
      }

      // Cancel the price prompt
      await service.cancelPricePrompt(promptId);
      
      // Create audit log
      await createAuditLog({
        entityType: 'price_prompt',
        entityId: promptId,
        action: 'UPDATE', // Using standard action
        userEmail: req.body.userEmail || 'system',
        organizationId: req.body.organizationId,
        metadata: {
          subAction: 'cancel_prompt',
          reason: req.body.reason || 'User cancelled'
        }
      });

      res.json({
        success: true,
        message: 'Price prompt cancelled successfully',
        data: {
          promptId: promptId
        }
      });
      
    } catch (error) {
      logger.error('Error cancelling price prompt', {
        error: error.message,
        stack: error.stack,
        promptId: req.body.promptId
      });
      res.status(500).json({
        success: false,
        message: 'Failed to cancel price prompt',
        error: error.message
      });
    } finally {
      await service.disconnect();
    }
  }

  /**
   * Generate invoice with price prompt handling
   * POST /api/invoice/generate-with-prompts
   */
  static async generateInvoiceWithPrompts(req, res) {
    const InvoiceGenerationService = require('../services/invoiceGenerationService');
    const invoiceService = new InvoiceGenerationService();
    const promptService = new PricePromptService();
    
    try {
      const { userEmail, clientEmail, startDate, endDate, sessionId } = req.body;
      
      // Validate input parameters
      const validationErrors = invoiceService.validateGenerationParams(userEmail, clientEmail, startDate, endDate);
      if (validationErrors.length > 0) {
        return res.status(400).json({
          success: false,
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
        action: 'CREATE', // Standard action
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

      res.json({
        success: true,
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
      
    } catch (error) {
      logger.error('Error generating invoice with prompts', {
        error: error.message,
        stack: error.stack,
        userEmail: req.body.userEmail,
        clientEmail: req.body.clientEmail
      });
      res.status(500).json({
        success: false,
        message: 'Failed to generate invoice with prompts',
        error: error.message
      });
    } finally {
      await invoiceService.disconnect();
      await promptService.disconnect();
    }
  }

  /**
   * Complete invoice generation after all prompts are resolved
   * POST /api/invoice/complete-generation
   */
  static async completeInvoiceGeneration(req, res) {
    const promptService = new PricePromptService();
    
    try {
      const { sessionId, lineItems } = req.body;
      
      if (!sessionId) {
        return res.status(400).json({
          success: false,
          message: 'Session ID is required'
        });
      }

      // Get all prompts for this session to verify they're resolved
      const pendingPrompts = await promptService.getPendingPrompts(sessionId);
      
      if (pendingPrompts.prompts.length > 0) {
        return res.status(400).json({
          success: false,
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
        action: 'CREATE', // Standard action
        userEmail: req.body.userEmail || 'system',
        organizationId: req.body.organizationId,
        metadata: {
          subAction: 'complete_generation',
          sessionId: sessionId,
          finalItemCount: lineItems?.length || 0
        }
      });

      res.json({
        success: true,
        message: 'Invoice generation completed successfully',
        data: {
          sessionId: sessionId,
          status: 'completed'
        }
      });
      
    } catch (error) {
      logger.error('Error completing invoice generation', {
        error: error.message,
        stack: error.stack,
        sessionId: req.body.sessionId
      });
      res.status(500).json({
        success: false,
        message: 'Failed to complete invoice generation',
        error: error.message
      });
    } finally {
      await promptService.disconnect();
    }
  }
}

module.exports = PricePromptController;
