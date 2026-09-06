const paymentService = require('../services/paymentService');
const catchAsync = require('../utils/catchAsync');
const logger = require('../config/logger');

class PaymentController {
  createPaymentIntent = catchAsync(async (req, res) => {
    const { invoiceId, organizationId } = req.body;
    
    if (!invoiceId || !organizationId) {
      return res.status(400).json({
        success: false,
        code: 'VALIDATION_ERROR',
        message: 'Missing required fields: invoiceId, organizationId'
      });
    }
    
    const result = await paymentService.createPaymentIntent(invoiceId, organizationId);
    
    logger.business('Payment intent created', {
      action: 'payment_intent_create',
      invoiceId,
      organizationId
    });
    
    res.status(200).json({
      success: true,
      code: 'PAYMENT_INTENT_CREATED',
      ...result
    });
  });

  createOnboardingLink = catchAsync(async (req, res) => {
    const { organizationId } = req.body;
    const userEmail = req.user ? req.user.email : 'system';
    if (!req.organizationContext?.permissions?.includes('manage_billing')) {
      return res.status(403).json({
        success: false,
        code: 'BILLING_PERMISSION_REQUIRED',
        message: 'Organization billing permission is required',
      });
    }
    
    if (!organizationId) {
      return res.status(400).json({
        success: false,
        code: 'VALIDATION_ERROR',
        message: 'organizationId is required'
      });
    }

    if (!req.organizationContext?.isAdmin) {
      return res.status(403).json({
        success: false,
        code: 'ADMIN_REQUIRED',
        message: 'Organization administrator access is required'
      });
    }
    
    const result = await paymentService.createOnboardingLink(organizationId, userEmail);
    
    logger.business('Onboarding link created', {
      action: 'payment_onboarding_link_create',
      organizationId,
      userEmail
    });
    
    res.status(200).json({
      success: true,
      code: 'ONBOARDING_LINK_CREATED',
      ...result
    });
  });

  getConnectStatus = catchAsync(async (req, res) => {
    const { organizationId } = req.query;
    const result = await paymentService.getConnectStatus(organizationId);

    res.status(200).json({
      success: true,
      code: 'STRIPE_CONNECT_STATUS',
      ...result
    });
  });

  recordPayment = catchAsync(async (req, res) => {
    const { invoiceId, paymentData } = req.body;
    const userEmail = req.user ? req.user.email : 'system';
    
    if (!invoiceId || !paymentData) {
      return res.status(400).json({
        success: false,
        code: 'VALIDATION_ERROR',
        message: 'Missing required fields: invoiceId, paymentData'
      });
    }
    
    const result = await paymentService.recordPayment(invoiceId, paymentData, userEmail);
    
    logger.business('Payment recorded', {
      action: 'payment_record',
      invoiceId,
      userEmail,
      paymentAmount: paymentData.amount
    });
    
    res.status(200).json({
      success: true,
      code: 'PAYMENT_RECORDED',
      ...result
    });
  });

  createCreditNote = catchAsync(async (req, res) => {
    const creditNoteData = req.body;
    const userEmail = req.user ? req.user.email : 'system';
    
    if (!creditNoteData || !creditNoteData.invoiceId) {
      return res.status(400).json({
        success: false,
        code: 'VALIDATION_ERROR',
        message: 'Missing required credit note data'
      });
    }
    
    const result = await paymentService.createCreditNote(creditNoteData, userEmail);
    
    logger.business('Credit note created', {
      action: 'credit_note_create',
      invoiceId: creditNoteData.invoiceId,
      userEmail,
      amount: creditNoteData.amount
    });
    
    res.status(200).json({
      success: true,
      code: 'CREDIT_NOTE_CREATED',
      ...result
    });
  });

  applyCreditNote = catchAsync(async (req, res) => {
    const { creditNoteId, invoiceId, amount } = req.body;
    const userEmail = req.user ? req.user.email : 'system';
    
    if (!creditNoteId || !invoiceId || !amount) {
      return res.status(400).json({
        success: false,
        code: 'VALIDATION_ERROR',
        message: 'Missing required fields: creditNoteId, invoiceId, amount'
      });
    }
    
    const result = await paymentService.applyCreditNote(creditNoteId, invoiceId, amount, userEmail);
    
    logger.business('Credit note applied', {
      action: 'credit_note_apply',
      creditNoteId,
      invoiceId,
      amount,
      userEmail
    });
    
    res.status(200).json({
      success: true,
      code: 'CREDIT_NOTE_APPLIED',
      ...result
    });
  });

  refundPayment = catchAsync(async (req, res) => {
    const { invoiceId, amount, reason } = req.body;
    const userEmail = req.user ? req.user.email : 'system';
    
    if (!invoiceId || !amount) {
      return res.status(400).json({
        success: false,
        code: 'VALIDATION_ERROR',
        message: 'Missing required fields: invoiceId, amount'
      });
    }
    
    const result = await paymentService.processRefund(invoiceId, amount, reason, userEmail);
    
    logger.business('Payment refund processed', {
      action: 'payment_refund',
      invoiceId,
      amount,
      reason,
      userEmail
    });
    
    res.status(200).json({
      success: true,
      code: 'PAYMENT_REFUNDED',
      ...result
    });
  });
}

module.exports = new PaymentController();
