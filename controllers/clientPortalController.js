const clientPortalService = require('../services/clientPortalService');
const clientAuthService = require('../services/clientAuthService');
const { createLogger } = require('../utils/logger');
const jwt = require('jsonwebtoken');

const logger = createLogger('ClientPortalController');

class ClientPortalController {
  
  // --- Auth ---

  async activate(req, res) {
    try {
      const { email, password } = req.body;
      const result = await clientAuthService.activateClientAccount(email, password);
      res.status(201).json({ success: true, message: 'Account activated', user: { email: result.email } });
    } catch (error) {
      logger.error('Client activation error', { error: error.message });
      res.status(400).json({ success: false, message: error.message });
    }
  }

  async login(req, res) {
    // Reuse secure auth logic or custom? 
    // Let's implement custom simple login for clients reusing standard JWT
    try {
      const { email, password } = req.body;
      const { verifyPassword } = require('../utils/cryptoHelpers');
      const db = await clientAuthService.getDb();
      
      const user = await db.collection('login').findOne({ email, role: 'client' });
      if (!user) {
        return res.status(401).json({ success: false, message: 'Invalid credentials' });
      }

      const isValid = await verifyPassword(password, user.password, user.salt);
      if (!isValid) {
        return res.status(401).json({ success: false, message: 'Invalid credentials' });
      }

      // Generate Token
      const token = jwt.sign(
        {
          userId: user._id, // Use _id as userId for consistency with middleware
          email: user.email,
          roles: ['client'],
          clientId: user.clientId, // Specific to client
          organizationId: user.organizationId
        },
        process.env.JWT_SECRET,
        { expiresIn: '24h', issuer: 'invoice-app', audience: 'invoice-app-users' }
      );

      res.json({
        success: true,
        token,
        user: {
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          role: 'client',
          clientId: user.clientId
        }
      });

    } catch (error) {
        logger.error('Client login error', { error: error.message });
        res.status(500).json({ success: false, message: 'Login failed' });
    }
  }

  // --- Invoices ---

  async getInvoices(req, res) {
    try {
        // user is attached by AuthMiddleware
        const userEmail = req.user.email;
        const { page, limit, status } = req.query;
        // We need clientId. Let's look up user first?
        // clientAuthService.getClientProfile(req.user.userId) returns { user, client }.
        
        const profile = await clientAuthService.getClientProfile(req.user.userId);
        const result = await clientPortalService.getInvoices(profile.client._id, userEmail, { page, limit, status });
        
        res.json({ success: true, data: result });
    } catch (error) {
        logger.error('Get invoices error', { error: error.message });
        res.status(500).json({ success: false, message: 'Failed to fetch invoices' });
    }
  }

  async getInvoiceDetail(req, res) {
    try {
        const { id } = req.params;
        const profile = await clientAuthService.getClientProfile(req.user.userId);
        const result = await clientPortalService.getInvoiceDetail(id, profile.client._id, req.user.email);
        res.json({ success: true, data: result });
    } catch (error) {
        res.status(404).json({ success: false, message: error.message });
    }
  }

  async approveInvoice(req, res) {
    try {
        const { id } = req.params;
        const result = await clientPortalService.approveInvoice(id, req.user.userId, req.user.email);
        res.json({ success: true, message: 'Invoice approved', result });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
  }

  async disputeInvoice(req, res) {
    try {
        const { id } = req.params;
        const { reason } = req.body;
        const result = await clientPortalService.disputeInvoice(id, req.user.userId, req.user.email, reason);
        res.json({ success: true, message: 'Invoice disputed', result });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
  }

  // --- Appointments ---

  async getAppointments(req, res) {
    try {
        const result = await clientPortalService.getAppointments(req.user.email);
        res.json({ success: true, data: result });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
  }

  async requestAppointment(req, res) {
    try {
        const { type, details, note } = req.body;
        const result = await clientPortalService.requestAppointment(req.user.email, req.user.userId, type, details, note);
        res.json({ success: true, message: 'Request submitted', data: result });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
  }

  async changePassword(req, res) {
    try {
        const { currentPassword, newPassword } = req.body;
        if (!newPassword) {
            return res.status(400).json({ success: false, message: 'New password is required' });
        }
        
        await clientAuthService.changePassword(req.user.email, currentPassword, newPassword);
        res.json({ success: true, message: 'Password changed successfully' });
    } catch (error) {
        logger.error('Change password error', { error: error.message });
        res.status(400).json({ success: false, message: error.message });
    }
  }
}

module.exports = new ClientPortalController();
