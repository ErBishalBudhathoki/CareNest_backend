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

/**
 * Auto-generate invoices for a period
 * POST /api/invoice-ai/auto-generate
 */
exports.autoGenerateInvoices = async (req, res) => {
  try {
    const { organizationId, startDate, endDate, validateBeforeGeneration, groupByClient } = req.body;

    if (!organizationId || !startDate || !endDate) {
      return res.status(400).json({
        success: false,
        message: 'organizationId, startDate, and endDate are required',
      });
    }

    // Get appointments for the period
    const appointments = await Appointment.find({
      organizationId,
      'schedule.date': {
        $gte: new Date(startDate),
        $lte: new Date(endDate),
      },
      status: 'completed',
      invoiced: { $ne: true },
    });

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
