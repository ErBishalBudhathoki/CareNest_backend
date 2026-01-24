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
const logger = require('../config/logger');
const crypto = require('crypto');

class InvoiceManagementService {
  
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
      const query = {
        organizationId,
        'deletion.isDeleted': { $ne: true }
      };
      
      if (status) {
        query['workflow.status'] = status;
      }

      if (invoiceType) {
        query['metadata.invoiceType'] = invoiceType;
      }
      
      if (clientEmail) {
        query.clientEmail = new RegExp(clientEmail, 'i');
      }
      
      if (paymentStatus) {
        query['payment.status'] = paymentStatus;
      }
      
      if (dateFrom || dateTo) {
        query['auditTrail.createdAt'] = {};
        if (dateFrom) query['auditTrail.createdAt'].$gte = new Date(dateFrom);
        if (dateTo) query['auditTrail.createdAt'].$lte = new Date(dateTo);
      }
      
      if (searchTerm) {
        query.$or = [
          { invoiceNumber: new RegExp(searchTerm, 'i') },
          { clientName: new RegExp(searchTerm, 'i') },
          { clientEmail: new RegExp(searchTerm, 'i') },
          { 'metadata.internalNotes': new RegExp(searchTerm, 'i') }
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
      
      // Check if PDF path exists
      const pdfPath = invoice.metadata?.pdfPath;
      if (!pdfPath) {
        return {
          success: false,
          error: 'PDF not available for this invoice'
        };
      }
      
      // Return PDF metadata
      return {
        success: true,
        data: {
          pdfPath: pdfPath,
          filename: `invoice-${invoice.invoiceNumber || invoiceId}.pdf`,
          invoiceNumber: invoice.invoiceNumber,
          clientName: invoice.clientName
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
        error: error.message
      };
    }
  }

  /**
   * Generate unique invoice number for organization
   */
  async generateInvoiceNumber(organizationId) {
    try {
      // Get current year and month
      const now = new Date();
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, '0');
      
      // Create prefix: ORG-YYYY-MM-
      const prefix = `${organizationId.toUpperCase()}-${year}-${month}-`;
      
      // Find the highest existing invoice number for this prefix
      const lastInvoice = await Invoice.findOne(
        {
          organizationId,
          invoiceNumber: { $regex: `^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}` }
        },
        null,
        {
          sort: { invoiceNumber: -1 }
        }
      ).select('invoiceNumber');
      
      let nextNumber = 1;
      if (lastInvoice && lastInvoice.invoiceNumber) {
        const lastNumberStr = lastInvoice.invoiceNumber.replace(prefix, '');
        const lastNumber = parseInt(lastNumberStr, 10);
        if (!isNaN(lastNumber)) {
          nextNumber = lastNumber + 1;
        }
      }
      
      // Format with leading zeros (4 digits)
      const formattedNumber = String(nextNumber).padStart(4, '0');
      
      return `${prefix}${formattedNumber}`;
      
    } catch (error) {
      logger.error('Error generating invoice number:', error);
      // Fallback to timestamp-based number
      const timestamp = Date.now();
      return `${organizationId.toUpperCase()}-${timestamp}`;
    }
  }

  /**
   * Log invoice access for audit trail
   */
  async logInvoiceAccess(invoiceId, organizationId, action, metadata = {}) {
    try {
      await AuditTrail.create({
        timestamp: new Date(),
        invoiceId,
        organizationId,
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
      const invoice = await Invoice.findOne({
        _id: invoiceId,
        organizationId,
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
