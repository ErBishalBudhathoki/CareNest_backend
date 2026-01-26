const paymentService = require('../services/paymentService');

class PaymentController {
  async createPaymentIntent(req, res) {
    try {
      // organizationId should be passed from frontend or inferred from invoice
      const { invoiceId, amount, currency, clientEmail, organizationId } = req.body;
      const result = await paymentService.createPaymentIntent(invoiceId, amount, currency, clientEmail, organizationId);
      res.json(result);
    } catch (error) {
      console.error('Create Payment Intent Error:', error);
      res.status(500).json({ error: error.message });
    }
  }

  async createOnboardingLink(req, res) {
    try {
      const { organizationId } = req.body;
      const userEmail = req.user ? req.user.email : 'system';
      const result = await paymentService.createOnboardingLink(organizationId, userEmail);
      res.json(result);
    } catch (error) {
      console.error('Create Onboarding Link Error:', error);
      res.status(500).json({ error: error.message });
    }
  }

  async recordPayment(req, res) {
    try {
      const { invoiceId, paymentData } = req.body;
      const userEmail = req.user ? req.user.email : 'system';
      
      const result = await paymentService.recordPayment(invoiceId, paymentData, userEmail);
      res.json(result);
    } catch (error) {
      console.error('Record Payment Error:', error);
      res.status(500).json({ error: error.message });
    }
  }

  async createCreditNote(req, res) {
    try {
      const creditNoteData = req.body;
      const userEmail = req.user ? req.user.email : 'system';
      
      const result = await paymentService.createCreditNote(creditNoteData, userEmail);
      res.json(result);
    } catch (error) {
      console.error('Create Credit Note Error:', error);
      res.status(500).json({ error: error.message });
    }
  }

  async applyCreditNote(req, res) {
    try {
      const { creditNoteId, invoiceId, amount } = req.body;
      const userEmail = req.user ? req.user.email : 'system';
      
      const result = await paymentService.applyCreditNote(creditNoteId, invoiceId, amount, userEmail);
      res.json(result);
    } catch (error) {
      console.error('Apply Credit Note Error:', error);
      res.status(500).json({ error: error.message });
    }
  }

  async refundPayment(req, res) {
    try {
      const { invoiceId, amount, reason } = req.body;
      const userEmail = req.user ? req.user.email : 'system';
      
      const result = await paymentService.processRefund(invoiceId, amount, reason, userEmail);
      res.json(result);
    } catch (error) {
      console.error('Refund Payment Error:', error);
      res.status(500).json({ error: error.message });
    }
  }
}

module.exports = new PaymentController();
