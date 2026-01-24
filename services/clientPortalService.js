const Invoice = require('../models/Invoice');
const ClientAssignment = require('../models/ClientAssignment');
const requestService = require('./requestService');
const auditService = require('./auditService');

class ClientPortalService {

  /**
   * Get invoices for a client
   * @param {string} clientId - Client ID
   * @param {string} clientEmail - Client Email
   * @param {Object} query - Pagination/Filter params
   */
  async getInvoices(clientId, clientEmail, { page = 1, limit = 10, status }) {
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

    const invoices = await Invoice.find(matchQuery)
      .sort({ 'financialSummary.dueDate': -1 }) // Show latest due first
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Invoice.countDocuments(matchQuery);

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
    const invoice = await Invoice.findOne({
      _id: invoiceId,
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
    // Check permissions implicitly by query
    const invoice = await Invoice.findOne({
        _id: invoiceId,
        'clientEmail': userEmail // Basic check, better to use clientId from auth
    });

    if (!invoice) throw new Error('Invoice not found');

    const result = await Invoice.updateOne(
      { _id: invoiceId },
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
    const result = await Invoice.updateOne(
      { _id: invoiceId },
      {
        $set: {
          'workflow.status': 'disputed', 
          'workflow.rejectionReason': reason,
          'workflow.nextAction': 'admin_review',
          'payment.status': 'pending'
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
    // Query clientAssignments
    // Structure: { clientEmail: '...', schedule: [{ date, startTime... }] }
    const assignments = await ClientAssignment.aggregate([
        { $match: { clientEmail: clientEmail, isActive: true } },
        { $unwind: '$schedule' },
        { $match: { 'schedule.date': { $gte: new Date().toISOString().split('T')[0] } } }, // Upcoming
        { $sort: { 'schedule.date': 1 } }
    ]);

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
