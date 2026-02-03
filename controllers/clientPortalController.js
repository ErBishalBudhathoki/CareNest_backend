const User = require('../models/User');
const clientPortalService = require('../services/clientPortalService');
const clientAuthService = require('../services/clientAuthService');
const catchAsync = require('../utils/catchAsync');
const jwt = require('jsonwebtoken');
const logger = require('../config/logger');

class ClientPortalController {
  // --- Auth ---
  activate = catchAsync(async (req, res) => {
    const { email, password } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        code: 'VALIDATION_ERROR',
        message: 'Email and password are required'
      });
    }
    
    const result = await clientAuthService.activateClientAccount(email, password);
    
    logger.business('Client account activated', {
      action: 'client_portal_activate',
      email: result.email
    });
    
    res.status(201).json({
      success: true,
      code: 'ACCOUNT_ACTIVATED',
      message: 'Account activated',
      user: { email: result.email }
    });
  });

  login = catchAsync(async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        code: 'VALIDATION_ERROR',
        message: 'Email and password are required'
      });
    }

    const user = await User.findOne({ email, role: 'client' }).select('+password');
    if (!user) {
      return res.status(401).json({
        success: false,
        code: 'INVALID_CREDENTIALS',
        message: 'Invalid credentials'
      });
    }

    const isValid = await user.comparePassword(password);
    if (!isValid) {
      return res.status(401).json({
        success: false,
        code: 'INVALID_CREDENTIALS',
        message: 'Invalid credentials'
      });
    }

    // Generate Token
    const token = jwt.sign(
      {
        userId: user._id,
        email: user.email,
        roles: ['client'],
        clientId: user.clientId,
        organizationId: user.organizationId
      },
      process.env.JWT_SECRET,
      { expiresIn: '24h', issuer: 'invoice-app', audience: 'invoice-app-users' }
    );

    logger.business('Client portal login', {
      action: 'client_portal_login',
      email: user.email,
      clientId: user.clientId
    });

    res.status(200).json({
      success: true,
      code: 'LOGIN_SUCCESS',
      token,
      user: {
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: 'client',
        clientId: user.clientId
      }
    });
  });

  // --- Invoices ---
  getInvoices = catchAsync(async (req, res) => {
    const userEmail = req.user.email;
    const { page, limit, status } = req.query;
    
    const profile = await clientAuthService.getClientProfile(req.user.userId);
    const result = await clientPortalService.getInvoices(profile.client._id, userEmail, { page, limit, status });

    logger.business('Client retrieved invoices', {
      action: 'client_portal_invoices_list',
      clientId: profile.client._id,
      email: userEmail
    });

    res.status(200).json({
      success: true,
      code: 'INVOICES_RETRIEVED',
      data: result
    });
  });

  getInvoiceDetail = catchAsync(async (req, res) => {
    const { id } = req.params;
    
    if (!id) {
      return res.status(400).json({
        success: false,
        code: 'VALIDATION_ERROR',
        message: 'Invoice ID is required'
      });
    }
    
    const profile = await clientAuthService.getClientProfile(req.user.userId);
    const result = await clientPortalService.getInvoiceDetail(id, profile.client._id, req.user.email);
    
    logger.business('Client retrieved invoice detail', {
      action: 'client_portal_invoice_detail',
      invoiceId: id,
      clientId: profile.client._id
    });
    
    res.status(200).json({
      success: true,
      code: 'INVOICE_RETRIEVED',
      data: result
    });
  });

  approveInvoice = catchAsync(async (req, res) => {
    const { id } = req.params;
    
    if (!id) {
      return res.status(400).json({
        success: false,
        code: 'VALIDATION_ERROR',
        message: 'Invoice ID is required'
      });
    }
    
    const result = await clientPortalService.approveInvoice(id, req.user.userId, req.user.email);
    
    logger.business('Client approved invoice', {
      action: 'client_portal_invoice_approve',
      invoiceId: id,
      userId: req.user.userId
    });
    
    res.status(200).json({
      success: true,
      code: 'INVOICE_APPROVED',
      message: 'Invoice approved',
      result
    });
  });

  disputeInvoice = catchAsync(async (req, res) => {
    const { id } = req.params;
    const { reason } = req.body;
    
    if (!id) {
      return res.status(400).json({
        success: false,
        code: 'VALIDATION_ERROR',
        message: 'Invoice ID is required'
      });
    }
    
    const result = await clientPortalService.disputeInvoice(id, req.user.userId, req.user.email, reason);
    
    logger.business('Client disputed invoice', {
      action: 'client_portal_invoice_dispute',
      invoiceId: id,
      userId: req.user.userId,
      reason
    });
    
    res.status(200).json({
      success: true,
      code: 'INVOICE_DISPUTED',
      message: 'Invoice disputed',
      result
    });
  });

  // --- Appointments ---
  getAppointments = catchAsync(async (req, res) => {
    const result = await clientPortalService.getAppointments(req.user.email);
    
    logger.business('Client retrieved appointments', {
      action: 'client_portal_appointments_list',
      email: req.user.email,
      count: result?.length || 0
    });
    
    res.status(200).json({
      success: true,
      code: 'APPOINTMENTS_RETRIEVED',
      data: result
    });
  });

  getAppointmentDetail = catchAsync(async (req, res) => {
    const { assignmentId, scheduleId } = req.params;
    
    if (!assignmentId || !scheduleId) {
      return res.status(400).json({
        success: false,
        code: 'VALIDATION_ERROR',
        message: 'assignmentId and scheduleId are required'
      });
    }
    
    const result = await clientPortalService.getAppointmentDetail(assignmentId, scheduleId, req.user.email);
    
    logger.business('Client retrieved appointment detail', {
      action: 'client_portal_appointment_detail',
      assignmentId,
      scheduleId
    });
    
    res.status(200).json({
      success: true,
      code: 'APPOINTMENT_RETRIEVED',
      data: result
    });
  });

  requestAppointment = catchAsync(async (req, res) => {
    const { type, details, note } = req.body;
    
    if (!type) {
      return res.status(400).json({
        success: false,
        code: 'VALIDATION_ERROR',
        message: 'Appointment type is required'
      });
    }
    
    const result = await clientPortalService.requestAppointment(req.user.email, req.user.userId, type, details, note);
    
    logger.business('Client requested appointment', {
      action: 'client_portal_appointment_request',
      email: req.user.email,
      type
    });
    
    res.status(200).json({
      success: true,
      code: 'APPOINTMENT_REQUESTED',
      message: 'Request submitted',
      data: result
    });
  });

  changePassword = catchAsync(async (req, res) => {
    const { currentPassword, newPassword } = req.body;
    
    if (!newPassword) {
      return res.status(400).json({
        success: false,
        code: 'VALIDATION_ERROR',
        message: 'New password is required'
      });
    }

    await clientAuthService.changePassword(req.user.email, currentPassword, newPassword);
    
    logger.business('Client changed password', {
      action: 'client_portal_password_change',
      email: req.user.email
    });
    
    res.status(200).json({
      success: true,
      code: 'PASSWORD_CHANGED',
      message: 'Password changed successfully'
    });
  });
}

module.exports = new ClientPortalController();
