/**
 * Invoice Management Endpoints
 * Provides API endpoints for managing generated invoices
 * Supports listing, viewing, sharing, and deleting invoices with organization-based access control
 */

const { InvoiceManagementService: invoiceManagementService } = require('../services/invoiceManagementService');
const logger = require('../config/logger');

// Service is already instantiated in the module export

/**
 * Get paginated list of invoices for an organization
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function getInvoicesList(req, res) {
  try {
    const {
      organizationId,
      page = 1,
      limit = 20,
      status,
      clientEmail,
      paymentStatus,
      invoiceType,
      dateFrom,
      dateTo,
      sortBy = 'auditTrail.createdAt',
      sortOrder = 'desc',
      searchTerm
    } = req.query;

    // Validate organization access
    if (!organizationId) {
      return res.status(400).json({
        success: false,
        error: 'Organization ID is required'
      });
    }

    // Prepare filters and pagination
    const filters = {
      status,
      clientEmail,
      paymentStatus,
      invoiceType,
      dateFrom,
      dateTo,
      searchTerm
    };

    const pagination = {
      page: parseInt(page),
      limit: parseInt(limit),
      sortBy,
      sortOrder: sortOrder === 'desc' ? -1 : 1
    };

    // Use service to get invoices list
    const result = await invoiceManagementService.getInvoicesList(
      organizationId,
      filters,
      pagination
    );

    if (!result.success) {
      return res.status(500).json(result);
    }

    // Log access for audit trail
    logger.info(`Invoice list accessed for organization: ${organizationId}`, {
      organizationId,
      page,
      limit,
      totalCount: result.data.pagination.totalCount,
      filters
    });

    res.json(result);

  } catch (error) {
    logger.error('Error getting invoices list:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve invoices list',
      details: error.message
    });
  }
}

/**
 * Get detailed view of a specific invoice
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function getInvoiceDetails(req, res) {
  try {
    const { invoiceId } = req.params;
    const { organizationId } = req.query;

    if (!invoiceId || !organizationId) {
      return res.status(400).json({
        success: false,
        error: 'Invoice ID and Organization ID are required'
      });
    }

    // Use service to get invoice details
    const result = await invoiceManagementService.getInvoiceDetails(
      invoiceId,
      organizationId
    );

    if (!result.success) {
      const statusCode = result.error.includes('not found') ? 404 : 500;
      return res.status(statusCode).json(result);
    }

    res.json(result);

  } catch (error) {
    logger.error('Error getting invoice details:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve invoice details',
      details: error.message
    });
  }
}

/**
 * Share an invoice with external parties
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function shareInvoice(req, res) {
  try {
    const { invoiceId } = req.params;
    const {
      organizationId,
      shareMethod,
      recipientEmail,
      userEmail,
      message,
      expiryDays = 30
    } = req.body;

    // Check if this is a PDF sharing request
    const isPdfRequest = req.path.includes('/share/pdf');

    if (isPdfRequest) {
      // Handle PDF sharing request
      const result = await invoiceManagementService.getInvoicePdf(
        invoiceId,
        organizationId
      );

      if (!result.success) {
        const statusCode = result.error.includes('not found') ? 404 : 500;
        return res.status(statusCode).json(result);
      }

      // Return PDF data as base64
      return res.json({
        success: true,
        data: {
          pdfData: result.data.pdfData,
          filename: result.data.filename || `invoice-${invoiceId}.pdf`,
          mimeType: 'application/pdf'
        }
      });
    }

    if (!invoiceId || !organizationId) {
      return res.status(400).json({
        success: false,
        error: 'Invoice ID and Organization ID are required'
      });
    }

    if (!shareMethod || !['email', 'link'].includes(shareMethod)) {
      return res.status(400).json({
        success: false,
        error: 'Valid share method is required (email or link)'
      });
    }

    // Prepare share options
    const shareOptions = {
      shareMethod,
      recipientEmail,
      userEmail,
      message,
      expiryDays
    };

    // Use service to share invoice
    const result = await invoiceManagementService.shareInvoice(
      invoiceId,
      organizationId,
      shareOptions
    );

    if (!result.success) {
      const statusCode = result.error.includes('not found') ? 404 : 500;
      return res.status(statusCode).json(result);
    }

    res.json(result);

  } catch (error) {
    logger.error('Error sharing invoice:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to share invoice',
      details: error.message
    });
  }
}

/**
 * Delete an invoice (soft delete with audit trail)
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function deleteInvoice(req, res) {
  try {
    const { invoiceId } = req.params;
    const { organizationId, userEmail, reason } = req.body;

    if (!invoiceId || !organizationId) {
      return res.status(400).json({
        success: false,
        error: 'Invoice ID and Organization ID are required'
      });
    }

    // Prepare delete options
    const deleteOptions = {
      userEmail,
      reason
    };

    // Use service to delete invoice
    const result = await invoiceManagementService.deleteInvoice(
      invoiceId,
      organizationId,
      deleteOptions
    );

    if (!result.success) {
      const statusCode = result.error.includes('not found') ? 404 : 500;
      return res.status(statusCode).json(result);
    }

    res.json(result);

  } catch (error) {
    logger.error('Error deleting invoice:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete invoice',
      details: error.message
    });
  }
}

/**
 * Get invoice statistics for an organization
 * GET /api/invoices/stats/:organizationId
 */
// Removed duplicate getInvoiceStats function - using the service-based implementation below

function toNumber(value) {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const normalized = value.trim();
    if (!normalized) return 0;
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function normalizeString(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function parseDateLike(value) {
  if (!value) return null;

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value;
  }

  if (typeof value === 'number') {
    const fromNumber = new Date(value);
    return Number.isNaN(fromNumber.getTime()) ? null : fromNumber;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;

    const asIso = new Date(trimmed);
    if (!Number.isNaN(asIso.getTime())) return asIso;

    const ddmmyyyy = trimmed.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (ddmmyyyy) {
      const day = Number(ddmmyyyy[1]);
      const month = Number(ddmmyyyy[2]);
      const year = Number(ddmmyyyy[3]);
      const parsed = new Date(Date.UTC(year, month - 1, day));
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    }
  }

  return null;
}

function normalizeLineItems(rawLineItems, organizationId) {
  if (!Array.isArray(rawLineItems)) return [];

  return rawLineItems
    .map((item) => {
      if (!item || typeof item !== 'object') return null;

      const supportItemNumber = normalizeString(
        item.supportItemNumber ||
        item.itemCode ||
        item.ndisItemNumber ||
        item.ndisItem?.itemNumber
      );

      const supportItemName = normalizeString(
        item.supportItemName ||
        item.itemName ||
        item.description ||
        item.ndisItemName ||
        item.ndisItem?.itemName ||
        'Payroll Item'
      );

      const quantity = toNumber(item.quantity ?? item.hours ?? item.totalHours);
      const price = toNumber(item.price ?? item.rate ?? item.unitPrice);
      let totalPrice = toNumber(
        item.totalPrice ?? item.amount ?? item.total ?? item.lineTotal
      );

      if (totalPrice <= 0 && quantity > 0 && price > 0) {
        totalPrice = quantity * price;
      }

      const parsedDate = parseDateLike(item.date ?? item.serviceDate);

      return {
        supportItemNumber,
        supportItemName,
        price: price > 0 ? price : 0,
        quantity: quantity > 0 ? quantity : (totalPrice > 0 ? 1 : 0),
        unit: normalizeString(item.unit) || (item.hours != null ? 'hour' : 'unit'),
        totalPrice: totalPrice > 0 ? totalPrice : 0,
        date: parsedDate || undefined,
        organizationId,
        providerType: normalizeString(item.providerType) || undefined,
        serviceLocationPostcode:
          normalizeString(item.serviceLocationPostcode) || undefined,
        pricingMetadata: item.pricingMetadata && typeof item.pricingMetadata === 'object'
          ? item.pricingMetadata
          : undefined
      };
    })
    .filter((item) => item && (item.totalPrice > 0 || item.quantity > 0));
}

function resolveEmployeeContext({
  employeeContext,
  metadata,
  billedTo,
  calculatedPayloadData
}) {
  const firstClient = Array.isArray(calculatedPayloadData?.clients)
    ? calculatedPayloadData.clients[0]
    : null;
  const employeeDetails = firstClient?.employeeDetails || {};

  const resolved = {
    employeeId: normalizeString(
      employeeContext?.employeeId ||
      metadata?.employeeId ||
      employeeDetails?.employeeId ||
      employeeDetails?.id
    ),
    employeeEmail: normalizeString(
      employeeContext?.employeeEmail ||
      metadata?.employeeEmail ||
      billedTo?.email ||
      firstClient?.employeeEmail ||
      employeeDetails?.email
    ).toLowerCase(),
    employeeName: normalizeString(
      employeeContext?.employeeName ||
      metadata?.employeeName ||
      billedTo?.name ||
      firstClient?.employeeName ||
      employeeDetails?.name
    )
  };

  return resolved;
}

/**
 * Create a new invoice
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function createInvoice(req, res) {
  try {
    console.log('=== CREATE INVOICE REQUEST ===');
    console.log('Request body:', JSON.stringify(req.body, null, 2));
    console.log('Request headers:', req.headers);

    const {
      organizationId,
      clientId,
      clientEmail,
      clientName,
      lineItems,
      expenses = [],
      financialSummary,
      metadata = {},
      pdfPath,
      userEmail,
      calculatedPayloadData,
      invoiceNumber: providedInvoiceNumber,
      invoiceType,
      issuer,
      billedTo,
      employeeContext
    } = req.body;

    const normalizedLineItems = normalizeLineItems(lineItems, organizationId);
    const hasExpenses = Array.isArray(expenses) && expenses.length > 0;

    // Validate required fields
    if (!organizationId || !clientEmail || (!normalizedLineItems.length && !hasExpenses)) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: organizationId, clientEmail, and at least one payable line item/expense'
      });
    }
    // Validate invoiceType and header entities
    if (!invoiceType || !['client', 'employee'].includes(String(invoiceType))) {
      return res.status(400).json({
        success: false,
        error: 'invoiceType must be either "client" or "employee"'
      });
    }
    if (!issuer || !issuer.businessName || !issuer.businessAddress || !issuer.contactEmail || !issuer.contactPhone) {
      return res.status(400).json({
        success: false,
        error: 'issuer (admin profile) is required with businessName, businessAddress, contactEmail and contactPhone'
      });
    }
    if (!billedTo || !billedTo.name) {
      return res.status(400).json({
        success: false,
        error: 'billedTo entity is required'
      });
    }

    // Use provided invoice number or generate a new one
    const invoiceNumber = providedInvoiceNumber || await invoiceManagementService.generateInvoiceNumber(organizationId);

    console.log('=== INVOICE NUMBER HANDLING ===');
    console.log('Provided invoice number:', providedInvoiceNumber);
    console.log('Final invoice number:', invoiceNumber);
    console.log('================================')

    const resolvedEmployeeContext = resolveEmployeeContext({
      employeeContext,
      metadata,
      billedTo,
      calculatedPayloadData
    });
    const lineItemsTotal = normalizedLineItems.reduce(
      (sum, item) => sum + (item.totalPrice || 0),
      0
    );

    // Prepare invoice data according to schema
    const invoiceData = {
      invoiceNumber,
      organizationId,
      clientId,
      clientEmail,
      clientName,
      lineItems: normalizedLineItems,
      financialSummary: {
        subtotal: financialSummary?.subtotal || lineItemsTotal,
        taxAmount: financialSummary?.taxAmount || 0,
        discountAmount: financialSummary?.discountAmount || 0,
        expenseAmount: financialSummary?.expenseAmount || 0,
        totalAmount: financialSummary?.totalAmount || lineItemsTotal,
        currency: financialSummary?.currency || 'AUD',
        exchangeRate: financialSummary?.exchangeRate || 1.0,
        paymentTerms: financialSummary?.paymentTerms || 30,
        dueDate: financialSummary?.dueDate || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
      },
      metadata: {
        invoiceType: invoiceType,
        generationMethod: metadata.generationMethod || 'automatic',
        templateUsed: metadata.templateUsed || 'default',
        customizations: metadata.customizations || [],
        tags: metadata.tags || [],
        category: metadata.category || 'standard',
        priority: metadata.priority || 'normal',
        internalNotes: metadata.internalNotes || '',
        pdfPath: pdfPath || null
      },
      header: {
        issuer,
        billedTo,
      },
      calculatedPayloadData: calculatedPayloadData || null,
      employeeContext: resolvedEmployeeContext,
      compliance: {
        ndisCompliant: true, // Will be validated
        validationPassed: true,
        validationErrors: [],
        auditRequired: false,
        complianceNotes: '',
        lastComplianceCheck: new Date(),
        complianceOfficer: userEmail || ''
      },
      delivery: {
        method: 'email',
        status: 'pending',
        recipientEmail: clientEmail,
        deliveryAttempts: 0,
        deliveryNotes: ''
      },
      payment: {
        status: 'pending',
        method: '',
        paidAmount: 0,
        paymentNotes: '',
        remindersSent: 0,
        writeOffAmount: 0,
        writeOffReason: ''
      },
      workflow: {
        status: 'generated',
        approvalRequired: false,
        workflowNotes: '',
        currentStep: 'generated',
        nextAction: 'send'
      },
      auditTrail: {
        createdBy: userEmail || 'system',
        createdAt: new Date(),
        updatedBy: userEmail || 'system',
        updatedAt: new Date(),
        version: 1,
        changeHistory: [{
          timestamp: new Date(),
          userId: userEmail || 'system',
          action: 'created',
          changes: { status: 'Invoice created' },
          reason: 'Invoice generation completed'
        }]
      },
      sharing: {
        isShared: false,
        sharedWith: [],
        shareToken: '',
        sharePermissions: 'view',
        shareHistory: []
      },
      deletion: {
        isDeleted: false,
        canRestore: true
      }
    };

    console.log('HEADER VALIDATION:', { invoiceType, issuer, billedTo });
    console.log('METADATA AFTER BUILD:', invoiceData.metadata);

    // Create the invoice
    const result = await invoiceManagementService.createInvoice(invoiceData);

    if (result.success) {
      logger.info('Invoice created successfully', {
        invoiceId: result.data._id,
        invoiceNumber: result.data.invoiceNumber,
        organizationId,
        clientEmail,
        totalAmount: invoiceData.financialSummary.totalAmount,
        createdBy: userEmail
      });

      res.status(201).json({
        success: true,
        message: 'Invoice created successfully',
        data: {
          invoiceId: result.data._id,
          invoiceNumber: result.data.invoiceNumber,
          totalAmount: result.data.financialSummary.totalAmount,
          status: result.data.workflow.status,
          createdAt: result.data.auditTrail.createdAt
        }
      });
    } else {
      console.log('=== CREATE INVOICE FAILED ===');
      console.log('Service result:', result);
      res.status(500).json({
        success: false,
        error: result.error || 'Failed to create invoice'
      });
    }

  } catch (error) {
    console.log('=== CREATE INVOICE ERROR ===');
    console.log('Error:', error);
    logger.error('Error creating invoice:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error while creating invoice'
    });
  }
}

/**
 * Get business statistics for an organization
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function getInvoiceStats(req, res) {
  try {
    const { organizationId } = req.params;

    if (!organizationId) {
      return res.status(400).json({
        success: false,
        error: 'Organization ID is required'
      });
    }

    // Use service to get business statistics
    const result = await invoiceManagementService.getBusinessStatistics(organizationId);

    if (!result.success) {
      return res.status(500).json(result);
    }

    // Log access for audit trail
    logger.info(`Business statistics accessed for organization: ${organizationId}`, {
      organizationId,
      statistics: result.data
    });

    res.json(result);

  } catch (error) {
    logger.error('Error getting business statistics:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve business statistics',
      details: error.message
    });
  }
}

/**
 * Update invoice payment status
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function updatePaymentStatus(req, res) {
  try {
    const { invoiceId } = req.params;
    const { organizationId, status, notes, paidAmount, updatedBy } = req.body;

    if (!invoiceId || !organizationId || !status) {
      return res.status(400).json({
        success: false,
        error: 'Invoice ID, Organization ID, and Status are required'
      });
    }

    const result = await invoiceManagementService.updatePaymentStatus(
      invoiceId,
      organizationId,
      status,
      { notes, paidAmount, updatedBy }
    );

    if (!result.success) {
      return res.status(result.error === 'Invoice not found' ? 404 : 500).json(result);
    }

    // Log action
    logger.info(`Payment status updated for invoice ${invoiceId} to ${status}`);

    res.json(result);

  } catch (error) {
    logger.error('Error updating payment status:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update payment status',
      details: error.message
    });
  }
}

module.exports = {
  getInvoicesList,
  getInvoiceDetails,
  shareInvoice,
  deleteInvoice,
  getInvoiceStats,
  createInvoice,
  updatePaymentStatus
};
