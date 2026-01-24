const { ObjectId } = require('mongodb');
const { getDatabase } = require('../config/database');
const requestService = require('./requestService');
const auditService = require('./auditService');

class ClientPortalService {
  constructor() {
    this.db = null;
  }

  async getDb() {
    if (!this.db) {
      this.db = await getDatabase();
    }
    return this.db;
  }

  /**
   * Get invoices for a client
   * @param {string} clientId - Client ID
   * @param {string} clientEmail - Client Email
   * @param {Object} query - Pagination/Filter params
   */
  async getInvoices(clientId, clientEmail, { page = 1, limit = 10, status }) {
    const db = await this.getDb();
    const skip = (page - 1) * limit;

    const matchQuery = {
      $or: [
        { clientId: clientId.toString() },
        { clientEmail: clientEmail }
      ],
      'deletion.isDeleted': { $ne: true }
    };

    if (status) {
      if (status === 'overdue') {
        matchQuery['payment.status'] = 'overdue';
      } else if (status === 'paid') {
        matchQuery['payment.status'] = 'paid';
      } else if (status === 'pending') {
        matchQuery['payment.status'] = { $in: ['pending', 'partial'] };
      }
    }

    const invoices = await db.collection('invoices')
      .find(matchQuery)
      .sort({ 'financialSummary.dueDate': -1 }) // Show latest due first
      .skip(skip)
      .limit(parseInt(limit))
      .toArray();

    const total = await db.collection('invoices').countDocuments(matchQuery);

    return {
      invoices,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    };
  }

  /**
   * Get single invoice detail
   */
  async getInvoiceDetail(invoiceId, clientId, clientEmail) {
    const db = await this.getDb();
    
    const invoice = await db.collection('invoices').findOne({
      _id: new ObjectId(invoiceId),
      $or: [
        { clientId: clientId.toString() },
        { clientEmail: clientEmail }
      ]
    });

    if (!invoice) {
      throw new Error('Invoice not found or access denied');
    }

    return invoice;
  }

  /**
   * Approve invoice
   */
  async approveInvoice(invoiceId, userId, userEmail) {
    const db = await this.getDb();
    
    // Check permissions implicitly by query
    const invoice = await db.collection('invoices').findOne({
        _id: new ObjectId(invoiceId),
        'clientEmail': userEmail // Basic check, better to use clientId from auth
    });

    if (!invoice) throw new Error('Invoice not found');

    const result = await db.collection('invoices').updateOne(
      { _id: new ObjectId(invoiceId) },
      {
        $set: {
          'workflow.status': 'approved',
          'workflow.approvedBy': userEmail,
          'workflow.approvalDate': new Date(),
          'workflow.nextAction': 'payment_processing'
        }
      }
    );

    await auditService.logAction({
        userEmail,
        action: 'INVOICE_APPROVED_BY_CLIENT',
        details: { invoiceId },
        timestamp: new Date()
    });

    return result;
  }

  /**
   * Dispute invoice
   */
  async disputeInvoice(invoiceId, userId, userEmail, reason) {
    const db = await this.getDb();

    const result = await db.collection('invoices').updateOne(
      { _id: new ObjectId(invoiceId) },
      {
        $set: {
          'workflow.status': 'disputed', // Ensure 'disputed' is in schema enums
          'workflow.rejectionReason': reason,
          'workflow.nextAction': 'admin_review',
          'payment.status': 'pending' // Reset if it was something else?
        }
      }
    );

    await auditService.logAction({
        userEmail,
        action: 'INVOICE_DISPUTED_BY_CLIENT',
        details: { invoiceId, reason },
        timestamp: new Date()
    });

    return result;
  }

  /**
   * Get upcoming appointments
   */
  async getAppointments(clientEmail) {
    const db = await this.getDb();
    
    // Query clientAssignments
    // Structure: { clientEmail: '...', schedule: [{ date, startTime... }] }
    const assignments = await db.collection('clientAssignments').aggregate([
        { $match: { clientEmail: clientEmail, isActive: true } },
        { $unwind: '$schedule' },
        { $match: { 'schedule.date': { $gte: new Date().toISOString().split('T')[0] } } }, // Upcoming
        { $sort: { 'schedule.date': 1 } }
    ]).toArray();

    return assignments.map(a => ({
        ...a.schedule,
        userEmail: a.userEmail, // The employee assigned
        assignmentId: a._id
    }));
  }

  /**
   * Request Appointment Change/New
   */
  async requestAppointment(userEmail, userId, type, details, note) {
    // Delegate to RequestService
    return await requestService.createRequest({
        organizationId: 'SELF', // Or fetch from client profile
        userId: userId,
        type: type || 'Appointment',
        details,
        note
    }, userEmail);
  }
}

module.exports = new ClientPortalService();
