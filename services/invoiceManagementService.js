/**
 * Invoice Management Service
 * Handles CRUD operations for generated invoices with organization-based access control
 * Supports listing, viewing, sharing, and deleting invoices
 */

const { Invoice, InvoiceStatus, PaymentStatus } = require('../models/Invoice');
const Organization = require('../models/Organization');
const Client = require('../models/Client');
const AuditTrail = require('../models/AuditTrail');
const InvoiceLineItem = require('../models/InvoiceLineItem');
const { invoiceArtifactService } = require('./invoiceArtifactService');
const { getCanonicalOrganizationCode } = require('../utils/organizationCodeUtils');
const InputValidator = require('../utils/inputValidator');
const logger = require('../config/logger');
const crypto = require('crypto');
const fs = require('fs').promises;

class InvoiceManagementService {
  _sanitizeAlphaNumeric(value = '') {
    return String(value)
      .replace(/[^a-zA-Z0-9]/g, '')
      .toUpperCase();
  }

  _generateCompactCode(value = '', length = 3, fallback = 'X') {
    const cleaned = this._sanitizeAlphaNumeric(value);
    if (!cleaned) {
      return fallback.repeat(length);
    }
    if (cleaned.length >= length) {
      return cleaned.substring(0, length);
    }
    return (cleaned + fallback.repeat(length)).substring(0, length);
  }
  
  /**
   * Get paginated list of invoices for an organization
   */
  async getInvoicesList(organizationId, filters = {}, pagination = {}) {
    try {
      const {
        status,
        clientEmail,
        paymentStatus,
        invoiceType,
        dateFrom,
        dateTo,
        searchTerm
      } = filters;
      
      const {
        page = 1,
        limit = 20,
        sortBy = 'auditTrail.createdAt',
        sortOrder = -1
      } = pagination;
      
      // Build query filter
      const { toSafeString } = require('../utils/security');
      const query = {
        organizationId: toSafeString(organizationId),
        'deletion.isDeleted': { $ne: true }
      };
      
      if (status) {
        query['workflow.status'] = toSafeString(status);
      }

      if (invoiceType) {
        query['metadata.invoiceType'] = toSafeString(invoiceType);
      }
      
      if (clientEmail) {
        query.clientEmail = new RegExp(InputValidator.escapeRegExp(clientEmail), 'i');
      }
      
      if (paymentStatus) {
        query['payment.status'] = toSafeString(paymentStatus);
      }
      
      if (dateFrom || dateTo) {
        query['auditTrail.createdAt'] = {};
        if (dateFrom) query['auditTrail.createdAt'].$gte = new Date(dateFrom);
        if (dateTo) query['auditTrail.createdAt'].$lte = new Date(dateTo);
      }
      
      if (searchTerm) {
        const escapedSearch = InputValidator.escapeRegExp(searchTerm);
        query.$or = [
          { invoiceNumber: new RegExp(escapedSearch, 'i') },
          { clientName: new RegExp(escapedSearch, 'i') },
          { clientEmail: new RegExp(escapedSearch, 'i') },
          { 'metadata.internalNotes': new RegExp(escapedSearch, 'i') }
        ];
      }
      
      // Get total count
      const totalCount = await Invoice.countDocuments(query);
      
      // Get paginated results
      const skip = (page - 1) * limit;
      const invoices = await Invoice.find(query)
        .sort({ [sortBy]: sortOrder })
        .skip(skip)
        .limit(limit)
        .select({
          invoiceNumber: 1,
          clientEmail: 1,
          clientName: 1,
          'financialSummary.totalAmount': 1,
          'financialSummary.subtotal': 1,
          'financialSummary.taxAmount': 1,
          'financialSummary.currency': 1,
          'financialSummary.dueDate': 1,
          'workflow.status': 1,
          'payment.status': 1,
          'delivery.status': 1,
          'auditTrail.createdAt': 1,
          'auditTrail.updatedAt': 1,
          'metadata.priority': 1,
          'metadata.tags': 1
        });
      
      const totalPages = Math.ceil(totalCount / limit);
      
      return {
        success: true,
        data: {
          invoices,
          pagination: {
            currentPage: page,
            totalPages,
            totalCount,
            hasNextPage: page < totalPages,
            hasPrevPage: page > 1
          }
        }
      };
      
    } catch (error) {
      logger.error('Error getting invoices list:', error);
      return {
        success: false,
        error: 'Failed to retrieve invoices list',
        details: error.message
      };
    }
  }

  /**
   * Get detailed view of a specific invoice
   */
  async getInvoiceDetails(invoiceId, organizationId) {
    try {
      const { toSafeString } = require('../utils/security');
      const safeInvoiceId = toSafeString(invoiceId);
      const safeOrgId = toSafeString(organizationId);

      const invoice = await Invoice.findOne({
        _id: safeInvoiceId,
        organizationId: safeOrgId,
        'deletion.isDeleted': { $ne: true }
      });
      
      if (!invoice) {
        return {
          success: false,
          error: 'Invoice not found or access denied'
        };
      }
      
      // Log access for audit trail
      await this.logInvoiceAccess(invoiceId, organizationId, 'view');
      
      return {
        success: true,
        data: invoice
      };
      
    } catch (error) {
      logger.error('Error getting invoice details:', error);
      return {
        success: false,
        error: 'Failed to retrieve invoice details',
        details: error.message
      };
    }
  }

  /**
   * Share an invoice with external parties
   */
  async shareInvoice(invoiceId, organizationId, shareOptions = {}) {
    try {
      const {
        sharedWith = [],
        permissions = 'view',
        expiryDays = 30,
        sharedBy
      } = shareOptions;
      
      // Verify invoice exists and belongs to organization
      const invoice = await Invoice.findOne({
        _id: invoiceId,
        organizationId,
        'deletion.isDeleted': { $ne: true }
      });
      
      if (!invoice) {
        return {
          success: false,
          error: 'Invoice not found or access denied'
        };
      }
      
      // Generate secure share token
      const shareToken = crypto.randomBytes(32).toString('hex');
      const shareExpiryDate = new Date();
      shareExpiryDate.setDate(shareExpiryDate.getDate() + expiryDays);
      
      // Update invoice with sharing information
      const shareHistory = {
        sharedWith: sharedWith.join(', '),
        sharedBy,
        sharedAt: new Date(),
        accessCount: 0,
        lastAccessed: null
      };
      
      await Invoice.updateOne(
        { _id: invoiceId },
        {
          $set: {
            'sharing.isShared': true,
            'sharing.sharedWith': sharedWith,
            'sharing.shareToken': shareToken,
            'sharing.shareExpiryDate': shareExpiryDate,
            'sharing.sharePermissions': permissions,
            'auditTrail.updatedAt': new Date(),
            'auditTrail.updatedBy': sharedBy
          },
          $push: {
            'sharing.shareHistory': shareHistory
          }
        }
      );
      
      // Log sharing action
      await this.logInvoiceAccess(invoiceId, organizationId, 'share', {
        sharedWith,
        sharedBy,
        permissions
      });
      
      return {
        success: true,
        data: {
          shareToken,
          shareUrl: `${process.env.FRONTEND_URL}/shared-invoice/${shareToken}`,
          expiryDate: shareExpiryDate,
          sharedWith,
          permissions
        }
      };
      
    } catch (error) {
      logger.error('Error sharing invoice:', error);
      return {
        success: false,
        error: 'Failed to share invoice',
        details: error.message
      };
    }
  }

  /**
   * Get invoice PDF data
   */
  async getInvoicePdf(invoiceId, organizationId) {
    try {
      // Find the invoice
      const invoice = await Invoice.findOne({
        _id: invoiceId,
        organizationId,
        'deletion.isDeleted': { $ne: true }
      });
      
      if (!invoice) {
        return {
          success: false,
          error: 'Invoice not found or access denied'
        };
      }

      let pdfData = null;
      let source = null;

      // Primary: backend-managed artifact in Firebase Storage.
      if (invoice.pdfArtifact && typeof invoice.pdfArtifact === 'object') {
        pdfData = await invoiceArtifactService.downloadPdfAsBase64(invoice.pdfArtifact);
        if (pdfData) {
          source = 'artifact_storage';
        }

        // Legacy migration path: older invoices may only have a direct URL.
        if (!pdfData && invoice.pdfArtifact.url) {
          pdfData = await invoiceArtifactService.downloadPdfFromUrlAsBase64(
            invoice.pdfArtifact.url
          );
          if (pdfData) {
            source = 'legacy_url_fallback';
          }
        }
      }

      // Last fallback for legacy server-local artifacts.
      if (!pdfData && invoice.metadata?.pdfPath) {
        try {
          const bytes = await fs.readFile(invoice.metadata.pdfPath);
          if (bytes?.length) {
            pdfData = bytes.toString('base64');
            source = 'legacy_pdf_path';
          }
        } catch (error) {
          logger.warn('Failed to read legacy invoice pdfPath', {
            invoiceId: String(invoiceId),
            pdfPath: invoice.metadata.pdfPath,
            error: error.message,
          });
        }
      }

      if (!pdfData) {
        return {
          success: false,
          error: 'PDF not available for this invoice'
        };
      }

      return {
        success: true,
        data: {
          pdfData,
          filename: `invoice-${invoice.invoiceNumber || invoiceId}.pdf`,
          invoiceNumber: invoice.invoiceNumber,
          clientName: invoice.clientName,
          source: source || 'unknown',
        }
      };
      
    } catch (error) {
      logger.error('Error getting invoice PDF:', error);
      return {
        success: false,
        error: 'Failed to retrieve invoice PDF',
        details: error.message
      };
    }
  }

  async attachPdfArtifact(invoiceId, organizationId, artifact) {
    try {
      if (!artifact || typeof artifact !== 'object') {
        return {
          success: false,
          error: 'Invalid invoice artifact payload'
        };
      }

      const update = {
        pdfArtifact: artifact,
        'metadata.pdfArtifactUrl': artifact.url || artifact.gsUri || null,
        'auditTrail.updatedAt': new Date(),
      };

      const invoice = await Invoice.findOneAndUpdate(
        {
          _id: invoiceId,
          organizationId,
          'deletion.isDeleted': { $ne: true },
        },
        {
          $set: update,
          $push: {
            'auditTrail.changeHistory': {
              timestamp: new Date(),
              userId: 'system',
              action: 'pdf_artifact_attached',
              changes: {
                provider: artifact.provider || 'firebase_storage',
                bucket: artifact.bucket || '',
                path: artifact.path || '',
              },
              reason: 'Stored immutable invoice PDF artifact',
            },
          },
        },
        {
          returnDocument: 'after',
        }
      );

      if (!invoice) {
        return {
          success: false,
          error: 'Invoice not found for artifact update',
        };
      }

      // Keep immutable snapshot source context in sync where possible.
      if (invoice.pdfRenderSnapshot && typeof invoice.pdfRenderSnapshot === 'object') {
        const nextSnapshot = {
          ...invoice.pdfRenderSnapshot,
          sourceContext: {
            ...(invoice.pdfRenderSnapshot.sourceContext || {}),
            pdfArtifact: artifact,
          },
        };

        await Invoice.updateOne(
          { _id: invoiceId, organizationId },
          { $set: { pdfRenderSnapshot: nextSnapshot } }
        );
      }

      return {
        success: true,
        data: invoice,
      };
    } catch (error) {
      logger.error('Error attaching invoice PDF artifact:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Soft delete an invoice
   */
  async deleteInvoice(invoiceId, organizationId, deleteOptions = {}) {
    try {
      const {
        deletedBy,
        deletionReason = 'User requested deletion',
        permanentDelete = false
      } = deleteOptions;
      
      // Verify invoice exists and belongs to organization
      const invoice = await Invoice.findOne({
        _id: invoiceId,
        organizationId,
        'deletion.isDeleted': { $ne: true }
      });
      
      if (!invoice) {
        return {
          success: false,
          error: 'Invoice not found or already deleted'
        };
      }
      
      // Check if invoice can be deleted (business rules)
      if (invoice.payment?.status === PaymentStatus.PAID) {
        return {
          success: false,
          error: 'Cannot delete paid invoices. Please contact administrator.'
        };
      }
      
      const deletionDate = new Date();
      const permanentDeletionDate = new Date();
      permanentDeletionDate.setDate(permanentDeletionDate.getDate() + 90); // 90 days retention
      
      if (permanentDelete) {
        // Permanent deletion (admin only)
        await Invoice.deleteOne({ _id: invoiceId });
        
        // Log permanent deletion
        await this.logInvoiceAccess(invoiceId, organizationId, 'permanent_delete', {
          deletedBy,
          deletionReason
        });
        
        return {
          success: true,
          data: {
            message: 'Invoice permanently deleted',
            deletedAt: deletionDate
          }
        };
      } else {
        // Soft deletion
        await Invoice.updateOne(
          { _id: invoiceId },
          {
            $set: {
              'deletion.isDeleted': true,
              'deletion.deletedBy': deletedBy,
              'deletion.deletedAt': deletionDate,
              'deletion.deletionReason': deletionReason,
              'deletion.canRestore': true,
              'deletion.permanentDeletionDate': permanentDeletionDate,
              'auditTrail.updatedAt': deletionDate,
              'auditTrail.updatedBy': deletedBy
            }
          }
        );
        
        // Log soft deletion
        await this.logInvoiceAccess(invoiceId, organizationId, 'soft_delete', {
          deletedBy,
          deletionReason
        });
        
        return {
          success: true,
          data: {
            message: 'Invoice deleted successfully',
            deletedAt: deletionDate,
            canRestore: true,
            permanentDeletionDate
          }
        };
      }
      
    } catch (error) {
      logger.error('Error deleting invoice:', error);
      return {
        success: false,
        error: 'Failed to delete invoice',
        details: error.message
      };
    }
  }

  /**
   * Get invoice statistics for an organization
   */
  async getInvoiceStats(organizationId) {
    try {
      const baseQuery = {
        organizationId,
        'deletion.isDeleted': { $ne: true }
      };
      
      // Aggregate statistics
      const stats = await Invoice.aggregate([
        { $match: baseQuery },
        {
          $group: {
            _id: null,
            totalInvoices: { $sum: 1 },
            totalAmount: { $sum: '$financialSummary.totalAmount' },
            paidAmount: {
              $sum: {
                $cond: [
                  { $eq: ['$payment.status', PaymentStatus.PAID] },
                  '$financialSummary.totalAmount',
                  0
                ]
              }
            },
            pendingAmount: {
              $sum: {
                $cond: [
                  { $eq: ['$payment.status', PaymentStatus.PENDING] },
                  '$financialSummary.totalAmount',
                  0
                ]
              }
            },
            overdueAmount: {
              $sum: {
                $cond: [
                  { $eq: ['$payment.status', PaymentStatus.OVERDUE] },
                  '$financialSummary.totalAmount',
                  0
                ]
              }
            }
          }
        }
      ]);
      
      // Status breakdown
      const statusBreakdown = await Invoice.aggregate([
        { $match: baseQuery },
        {
          $group: {
            _id: '$workflow.status',
            count: { $sum: 1 },
            totalAmount: { $sum: '$financialSummary.totalAmount' }
          }
        }
      ]);
      
      // Recent activity (last 30 days)
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      
      const recentActivity = await Invoice.countDocuments({
        ...baseQuery,
        'auditTrail.createdAt': { $gte: thirtyDaysAgo }
      });
      
      const result = stats[0] || {
        totalInvoices: 0,
        totalAmount: 0,
        paidAmount: 0,
        pendingAmount: 0,
        overdueAmount: 0
      };
      
      return {
        success: true,
        data: {
          ...result,
          statusBreakdown,
          recentActivity,
          collectionRate: result.totalAmount > 0 ? (result.paidAmount / result.totalAmount * 100).toFixed(2) : 0
        }
      };
      
    } catch (error) {
      logger.error('Error getting invoice stats:', error);
      return {
        success: false,
        error: 'Failed to retrieve invoice statistics',
        details: error.message
      };
    }
  }

  /**
   * Create a new invoice
   */
  async createInvoice(invoiceData) {
    try {
      // Create new invoice document
      const newInvoice = new Invoice(invoiceData);
      const result = await newInvoice.save();
      
      if (result) {
        // --- POPULATE ANALYTICS DATA (invoiceLineItems) ---
        if (invoiceData.lineItems && invoiceData.lineItems.length > 0) {
          const analyticsItems = invoiceData.lineItems.map(item => ({
            ...item,
            invoiceId: result._id,
            invoiceNumber: invoiceData.invoiceNumber,
            organizationId: invoiceData.organizationId,
            clientEmail: invoiceData.clientEmail,
            // Ensure dates are Date objects for aggregation
            createdAt: new Date(), 
            date: item.date ? new Date(item.date) : new Date(),
            // Ensure numeric values
            totalPrice: parseFloat(item.totalPrice || 0),
            hours: parseFloat(item.quantity || 0), // Assuming quantity is hours for services
            employeeId: item.employeeId || null // Ensure employeeId exists for utilization
          }));

          await InvoiceLineItem.insertMany(analyticsItems);
          logger.info(`Inserted ${analyticsItems.length} line items for analytics`);
        }
        // --------------------------------------------------
        
        logger.info('Invoice created in database', {
          invoiceId: result._id,
          invoiceNumber: invoiceData.invoiceNumber,
          organizationId: invoiceData.organizationId,
          clientEmail: invoiceData.clientEmail
        });
        
        return {
          success: true,
          data: result
        };
      } else {
        return {
          success: false,
          error: 'Failed to insert invoice into database'
        };
      }
      
    } catch (error) {
      logger.error('Error creating invoice:', error);
      return {
        success: false,
        error: error.message,
        errorCode: error.code,
        duplicateKey: error?.code === 11000
      };
    }
  }

  /**
   * Generate unique invoice number for organization
   */
  async generateInvoiceNumber(organizationId, options = {}) {
    try {
      const {
        clientId = '',
        clientName = '',
        clientEmail = ''
      } = options;

      const now = new Date();
      const shortYear = String(now.getFullYear()).slice(-1); // 2026 => "6"
      const shortMonth = String(now.getMonth() + 1).slice(-1); // 03 => "3", 10 => "0"

      // Prefer organization code for human-readable compact numbers.
      const org = await Organization.findById(organizationId)
        .select('organizationCode code name')
        .lean();

      const orgCode = this._generateCompactCode(
        getCanonicalOrganizationCode(org) || organizationId,
        3,
        'X'
      );

      const clientCode = this._generateCompactCode(
        `${clientName}${clientEmail}${clientId}`,
        2,
        'C'
      );

      // Compact format aligned with previous behavior:
      // INV + ORG(3) + Y(1) + M(1) + SEQ(2+) + CLIENT(2)
      const prefix = `INV${orgCode}${shortYear}${shortMonth}`;

      const escapedPrefix = InputValidator.escapeRegExp(prefix);
      const sequenceMatcher = new RegExp(
        `^${escapedPrefix}(\\d+)[A-Z0-9]{2}$`
      );

      // Compute max sequence for this org/month from compact-format invoices.
      const existingInvoices = await Invoice.find(
        {
          organizationId,
          invoiceNumber: { $regex: `^${escapedPrefix}` },
        },
        { invoiceNumber: 1 }
      ).lean();

      let maxSequence = 0;
      for (const invoice of existingInvoices) {
        const value = invoice?.invoiceNumber;
        if (!value) continue;
        const match = sequenceMatcher.exec(value);
        if (!match) continue;
        const parsed = parseInt(match[1], 10);
        if (!Number.isNaN(parsed) && parsed > maxSequence) {
          maxSequence = parsed;
        }
      }

      const nextSequence = maxSequence + 1;
      const sequenceStr = String(nextSequence).padStart(2, '0');

      return `${prefix}${sequenceStr}${clientCode}`;
    } catch (error) {
      logger.error('Error generating invoice number:', error);

      // Compact fallback: INV + ORG + Y + M + random + FB
      const now = new Date();
      const shortYear = String(now.getFullYear()).slice(-1);
      const shortMonth = String(now.getMonth() + 1).slice(-1);
      const orgCode = this._generateCompactCode(organizationId, 3, 'X');
      const randomSeq = String(Math.floor(Math.random() * 90) + 10); // 10..99
      return `INV${orgCode}${shortYear}${shortMonth}${randomSeq}FB`;
    }
  }

  /**
   * Log invoice access for audit trail
   */
  async logInvoiceAccess(invoiceId, organizationId, action, metadata = {}) {
    try {
      const { toSafeString } = require('../utils/security');
      const safeInvoiceId = toSafeString(invoiceId);
      const safeOrgId = toSafeString(organizationId);

      await AuditTrail.create({
        timestamp: new Date(),
        invoiceId: safeInvoiceId,
        organizationId: safeOrgId,
        action,
        metadata,
        userAgent: metadata.userAgent || 'system',
        ipAddress: metadata.ipAddress || 'unknown'
      });
    } catch (error) {
      logger.error('Error logging invoice access:', error);
      // Don't throw error as this is non-critical
    }
  }

  /**
   * Update invoice payment status
   */
  async updatePaymentStatus(invoiceId, organizationId, status, paymentDetails = {}) {
    try {
      const { toSafeString } = require('../utils/security');
      const safeInvoiceId = toSafeString(invoiceId);
      const safeOrgId = toSafeString(organizationId);

      const invoice = await Invoice.findOne({
        _id: safeInvoiceId,
        organizationId: safeOrgId,
        'deletion.isDeleted': { $ne: true }
      });
      
      if (!invoice) {
        return {
          success: false,
          error: 'Invoice not found'
        };
      }
      
      const updateData = {
        'payment.status': status,
        'auditTrail.updatedAt': new Date(),
        'auditTrail.updatedBy': paymentDetails.updatedBy || 'system'
      };

      // If paid, update paid amount and date
      if (status === PaymentStatus.PAID) {
        updateData['payment.paidDate'] = new Date();
        updateData['payment.paidAmount'] = invoice.financialSummary.totalAmount;
        updateData['workflow.status'] = InvoiceStatus.PAID;
      }
      
      // If partial, update paid amount
      if (status === PaymentStatus.PARTIAL && paymentDetails.paidAmount) {
        updateData['payment.paidAmount'] = (invoice.payment?.paidAmount || 0) + paymentDetails.paidAmount;
      }

      await Invoice.updateOne(
        { _id: invoiceId },
        { 
          $set: updateData,
          $push: {
            'auditTrail.changeHistory': {
              timestamp: new Date(),
              userId: paymentDetails.updatedBy || 'system',
              action: 'payment_status_update',
              changes: { oldStatus: invoice.payment?.status, newStatus: status },
              reason: paymentDetails.notes || 'Payment status updated'
            }
          }
        }
      );
      
      return {
        success: true,
        data: {
          invoiceId,
          status,
          updatedAt: new Date()
        }
      };
      
    } catch (error) {
      logger.error('Error updating payment status:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Get business statistics for an organization
   */
  async getBusinessStatistics(organizationId) {
    try {
      // Base query for organization
      const orgQuery = { organizationId };
      const activeInvoiceQuery = { 
        organizationId, 
        'deletion.isDeleted': { $ne: true }
      };
      
      // Get active businesses count (organizations)
      const activeBusinesses = await Organization.countDocuments({
        _id: organizationId,
        isActive: { $ne: false }
      });
      
      // Get total clients count
      const totalClients = await Client.countDocuments(orgQuery);
      
      // Get total invoices count
      const totalInvoices = await Invoice.countDocuments(activeInvoiceQuery);
      
      // Calculate total revenue from all invoices
      const revenueAggregation = await Invoice.aggregate([
        { $match: activeInvoiceQuery },
        {
          $group: {
            _id: null,
            totalRevenue: {
              $sum: {
                $cond: {
                  if: { $isNumber: "$financialSummary.totalAmount" },
                  then: "$financialSummary.totalAmount",
                  else: 0
                }
              }
            }
          }
        }
      ]);
      
      const totalRevenue = revenueAggregation.length > 0 ? revenueAggregation[0].totalRevenue : 0;
      
      // Format revenue for display
      const formattedRevenue = this.formatCurrency(totalRevenue);
      
      // Get invoice status breakdown
      const statusAggregation = await Invoice.aggregate([
        { $match: activeInvoiceQuery },
        {
          $group: {
            _id: "$status",
            count: { $sum: 1 }
          }
        }
      ]);

      const statsByStatus = statusAggregation.reduce((acc, curr) => {
        // Handle case where status might be missing or null
        const status = curr._id || 'unknown';
        acc[status] = curr.count;
        return acc;
      }, {});

      // Calculate aggregated metrics
      // Pending: Drafts
      const pendingInvoices = statsByStatus['draft'] || 0;
      
      // Active: Sent, Overdue, Partial (everything except Draft, Paid, Void)
      const activeInvoices = (statsByStatus['sent'] || 0) + 
                             (statsByStatus['overdue'] || 0) + 
                             (statsByStatus['partial'] || 0);

      const statistics = {
        activeBusinesses: activeBusinesses || 1, // At least 1 if organization exists
        totalClients,
        totalInvoices,
        totalRevenue: formattedRevenue,
        rawRevenue: totalRevenue,
        // Status breakdown
        pendingInvoices,
        activeInvoices,
        statsByStatus
      };
      
      logger.info(`Business statistics calculated for organization: ${organizationId}`, {
        organizationId,
        statistics
      });
      
      return {
        success: true,
        data: statistics
      };
      
    } catch (error) {
      logger.error('Error calculating business statistics:', error);
      return {
        success: false,
        error: 'Failed to calculate business statistics',
        details: error.message
      };
    }
  }

  /**
   * Format currency value for display
   */
  formatCurrency(amount) {
    if (amount >= 1000000) {
      return `$${(amount / 1000000).toFixed(1)}M`;
    } else if (amount >= 1000) {
      return `$${(amount / 1000).toFixed(1)}k`;
    } else {
      return `$${amount.toFixed(2)}`;
    }
  }
}

module.exports = { InvoiceManagementService: new InvoiceManagementService() };
