const invoiceAIService = require('../services/invoiceAIService');
const Invoice = require('../models/Invoice');
const Appointment = require('../models/Appointment');

/**
 * Validate an invoice
 * POST /api/invoice-ai/validate
 */
exports.validateInvoice = async (req, res) => {
  try {
    const { invoice } = req.body;

    if (!invoice) {
      return res.status(400).json({
        success: false,
        message: 'Invoice data is required',
      });
    }

    const validation = invoiceAIService.validateInvoice(invoice);

    res.json({
      success: true,
      data: validation,
    });
  } catch (error) {
    console.error('Error validating invoice:', error);
    res.status(500).json({
      success: false,
      message: 'Error validating invoice',
      error: error.message,
    });
  }
};

/**
 * Detect anomalies in an invoice
 * POST /api/invoice-ai/detect-anomalies
 */
exports.detectAnomalies = async (req, res) => {
  try {
    const { invoice } = req.body;

    if (!invoice) {
      return res.status(400).json({
        success: false,
        message: 'Invoice data is required',
      });
    }

    const anomalies = invoiceAIService.detectAnomalies(invoice);

    res.json({
      success: true,
      data: {
        anomalies,
        count: anomalies.length,
      },
    });
  } catch (error) {
    console.error('Error detecting anomalies:', error);
    res.status(500).json({
      success: false,
      message: 'Error detecting anomalies',
      error: error.message,
    });
  }
};

/**
 * Predict payment date for an invoice
 * GET /api/invoice-ai/payment-prediction/:invoiceId
 */
exports.predictPayment = async (req, res) => {
  try {
    const { invoiceId } = req.params;

    // Get invoice
    const invoice = await Invoice.findById(invoiceId);
    if (!invoice) {
      return res.status(404).json({
        success: false,
        message: 'Invoice not found',
      });
    }

    // Get client payment history (simplified)
    // In production, this would query actual payment history
    const clientHistory = {
      avgPaymentDays: 28,
      onTimePaymentRate: 0.75,
    };

    const prediction = invoiceAIService.predictPaymentDate(invoice, clientHistory);

    res.json({
      success: true,
      data: prediction,
    });
  } catch (error) {
    console.error('Error predicting payment:', error);
    res.status(500).json({
      success: false,
      message: 'Error predicting payment',
      error: error.message,
    });
  }
};

const Organization = require('../models/Organization');

/**
 * Auto-generate invoices for a period
 * POST /api/invoice-ai/auto-generate
 */
exports.autoGenerateInvoices = async (req, res) => {
  try {
    const { organizationId, startDate, endDate, validateBeforeGeneration, groupByClient, forceManual } = req.body;

    if (!organizationId) {
      return res.status(400).json({
        success: false,
        message: 'organizationId is required',
      });
    }

    // Cost Control: Check Organization AI Generation Frequency
    const org = await Organization.findById(organizationId);
    if (!org) {
      return res.status(404).json({ success: false, message: 'Organization not found' });
    }

    const { frequency, lastRunDate } = org.settings?.aiInvoiceGeneration || {};
    
    // Prevent accidental excessive AI generation bills
    if (!forceManual && lastRunDate) {
      const daysSince = (new Date() - new Date(lastRunDate)) / (1000 * 60 * 60 * 24);
      if (frequency === 'weekly' && daysSince < 7) {
        return res.status(429).json({ success: false, message: 'AI cost limit: Weekly generation limit reached.' });
      } else if (frequency === 'monthly' && daysSince < 28) {
        return res.status(429).json({ success: false, message: 'AI cost limit: Monthly generation limit reached.' });
      }
    }

    // Build query for appointments
    const query = {
      organizationId,
      status: 'completed',
      invoiced: { $ne: true },
    };

    if (startDate && endDate) {
      query['schedule.date'] = {
        $gte: new Date(startDate),
        $lte: new Date(endDate),
      };
    }

    // Get appointments for the period
    const appointments = await Appointment.find(query);

    if (appointments.length === 0) {
      return res.json({
        success: true,
        data: {
          totalInvoices: 0,
          successfulInvoices: 0,
          failedInvoices: 0,
          invoiceIds: [],
          errors: [],
          summary: 'No appointments found for the specified period',
        },
      });
    }

    // Auto-generate invoices
    const result = await invoiceAIService.autoGenerateInvoices(appointments, {
      validateBeforeGeneration: validateBeforeGeneration !== false,
      groupByClient: groupByClient === true,
    });

    // Update last run date
    if (org.settings) {
      if (!org.settings.aiInvoiceGeneration) org.settings.aiInvoiceGeneration = {};
      org.settings.aiInvoiceGeneration.lastRunDate = new Date();
      await org.save();
    }

    res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error('Error auto-generating invoices:', error);
    res.status(500).json({
      success: false,
      message: 'Error auto-generating invoices',
      error: error.message,
    });
  }
};

/**
 * Get smart reminders for an invoice
 * GET /api/invoice-ai/smart-reminders/:invoiceId
 */
exports.getSmartReminders = async (req, res) => {
  try {
    const { invoiceId } = req.params;

    // Get invoice
    const invoice = await Invoice.findById(invoiceId);
    if (!invoice) {
      return res.status(404).json({
        success: false,
        message: 'Invoice not found',
      });
    }

    // Get payment prediction
    const clientHistory = {
      avgPaymentDays: 28,
      onTimePaymentRate: 0.75,
    };
    const prediction = invoiceAIService.predictPaymentDate(invoice, clientHistory);

    // Get smart reminders
    const reminders = invoiceAIService.suggestReminders(invoice, prediction);

    res.json({
      success: true,
      data: {
        reminders,
        prediction,
      },
    });
  } catch (error) {
    console.error('Error getting smart reminders:', error);
    res.status(500).json({
      success: false,
      message: 'Error getting smart reminders',
      error: error.message,
    });
  }
};
