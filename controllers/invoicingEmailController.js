const InvoicingEmailDetail = require('../models/InvoicingEmailDetail');
const InvoicingEmailKey = require('../models/InvoicingEmailKey');

class InvoicingEmailController {
  constructor() {
    this.addUpdateInvoicingEmailDetail =
      this.addUpdateInvoicingEmailDetail.bind(this);
    this.setInvoicingEmailDetailKey = this.setInvoicingEmailDetailKey.bind(this);
    this.getInvoicingEmailDetails = this.getInvoicingEmailDetails.bind(this);
    this.checkInvoicingEmailKey = this.checkInvoicingEmailKey.bind(this);
    this.getEmailDetailToSendEmail = this.getEmailDetailToSendEmail.bind(this);
  }

  _normalizeEmail(value) {
    return String(value || '').trim().toLowerCase();
  }

  _resolveOrganizationId(req) {
    return (
      req.organizationContext?.organizationId ||
      req.body?.organizationId ||
      req.query?.organizationId ||
      req.user?.lastActiveOrganizationId ||
      req.user?.organizationId ||
      null
    );
  }

  async addUpdateInvoicingEmailDetail(req, res) {
    try {
      const userEmail = this._normalizeEmail(req.body?.userEmail);
      const invoicingBusinessName = String(
        req.body?.invoicingBusinessName || ''
      ).trim();
      const email = this._normalizeEmail(req.body?.email);
      const encryptedPassword = String(req.body?.encryptedPassword || '').trim();
      const organizationId = this._resolveOrganizationId(req);

      if (!organizationId) {
        return res.status(400).json({
          success: false,
          message: 'Organization ID is required',
        });
      }

      if (!userEmail || !email || !encryptedPassword) {
        return res.status(400).json({
          success: false,
          message: 'userEmail, email, and encryptedPassword are required',
        });
      }

      const existing = await InvoicingEmailDetail.findOne({
        userEmail,
        organizationId: String(organizationId),
        isActive: true,
      }).lean();

      if (existing) {
        return res.status(409).json({
          success: false,
          message: 'Invoicing email details already added',
        });
      }

      await InvoicingEmailDetail.create({
        userEmail,
        organizationId: String(organizationId),
        invoicingBusinessName,
        email,
        encryptedPassword,
        isActive: true,
      });

      return res.status(200).json({
        success: true,
        message: 'Invoicing email details added successfully',
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        message: 'Failed to add invoicing email details',
        error: error.message,
      });
    }
  }

  async setInvoicingEmailDetailKey(req, res) {
    try {
      const userEmail = this._normalizeEmail(req.body?.userEmail);
      const invoicingBusinessKey = String(
        req.body?.invoicingBusinessKey || ''
      ).trim();
      const organizationId = this._resolveOrganizationId(req);

      if (!organizationId) {
        return res.status(400).json({
          success: false,
          message: 'Organization ID is required',
        });
      }

      if (!userEmail || !invoicingBusinessKey) {
        return res.status(400).json({
          success: false,
          message: 'userEmail and invoicingBusinessKey are required',
        });
      }

      await InvoicingEmailKey.findOneAndUpdate(
        { userEmail, organizationId: String(organizationId) },
        {
          $set: {
            userEmail,
            organizationId: String(organizationId),
            invoicingBusinessKey,
          },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );

      return res.status(200).json({
        success: true,
        message: 'Invoicing email key saved successfully',
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        message: 'Failed to save invoicing email key',
        error: error.message,
      });
    }
  }

  async getInvoicingEmailDetails(req, res) {
    try {
      const userEmail = this._normalizeEmail(req.query?.email);
      const organizationId = this._resolveOrganizationId(req);

      if (!organizationId) {
        return res.status(400).json({
          success: false,
          message: 'Organization ID is required',
        });
      }

      if (!userEmail) {
        return res.status(400).json({
          success: false,
          message: 'email query param is required',
        });
      }

      let detail = await InvoicingEmailDetail.findOne({
        userEmail,
        organizationId: String(organizationId),
        isActive: true,
      }).lean();

      // Backward compatibility for legacy records that might not have org scoped data.
      if (!detail) {
        detail = await InvoicingEmailDetail.findOne({
          userEmail,
          isActive: true,
        }).lean();
      }

      if (!detail) {
        return res.status(200).json({
          success: true,
          message: 'No invoicing email details found',
        });
      }

      return res.status(200).json({
        success: true,
        message: 'Invoicing email details found',
        data: {
          userEmail: detail.userEmail,
          invoicingBusinessName: detail.invoicingBusinessName,
          email: detail.email,
          encryptedPassword: detail.encryptedPassword,
        },
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        message: 'Error retrieving invoicing email details',
        error: error.message,
      });
    }
  }

  async checkInvoicingEmailKey(req, res) {
    try {
      const userEmail = this._normalizeEmail(req.query?.email);
      const organizationId = this._resolveOrganizationId(req);

      if (!organizationId) {
        return res.status(400).json({
          success: false,
          message: 'Organization ID is required',
        });
      }

      if (!userEmail) {
        return res.status(400).json({
          success: false,
          message: 'email query param is required',
        });
      }

      let keyDoc = await InvoicingEmailKey.findOne({
        userEmail,
        organizationId: String(organizationId),
      }).lean();

      // Backward compatibility for legacy records that might not have org scoped data.
      if (!keyDoc) {
        keyDoc = await InvoicingEmailKey.findOne({ userEmail }).lean();
      }

      if (!keyDoc || !keyDoc.invoicingBusinessKey) {
        return res.status(200).json({
          success: true,
          message: 'No invoicing email key found',
        });
      }

      return res.status(200).json({
        success: true,
        message: 'Invoicing email key found',
        key: keyDoc.invoicingBusinessKey,
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        message: 'Error retrieving invoicing email key details',
        error: error.message,
      });
    }
  }

  async getEmailDetailToSendEmail(req, res) {
    try {
      const userEmail = this._normalizeEmail(req.body?.userEmail);
      const organizationId = this._resolveOrganizationId(req);

      if (!organizationId) {
        return res.status(400).json({
          success: false,
          message: 'Organization ID is required',
        });
      }

      if (!userEmail) {
        return res.status(400).json({
          success: false,
          message: 'userEmail is required',
        });
      }

      let detail = await InvoicingEmailDetail.findOne({
        userEmail,
        organizationId: String(organizationId),
        isActive: true,
      }).lean();

      let keyDoc = await InvoicingEmailKey.findOne({
        userEmail,
        organizationId: String(organizationId),
      }).lean();

      if (!detail) {
        detail = await InvoicingEmailDetail.findOne({
          userEmail,
          isActive: true,
        }).lean();
      }
      if (!keyDoc) {
        keyDoc = await InvoicingEmailKey.findOne({ userEmail }).lean();
      }

      if (!detail) {
        return res.status(404).json({
          success: false,
          message: 'No user found',
        });
      }

      return res.status(200).json({
        success: true,
        message: 'Email details found',
        accessToken: keyDoc?.invoicingBusinessKey || '',
        emailAddress: detail.email,
        recipientEmail: userEmail,
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: error.message,
      });
    }
  }
}

module.exports = new InvoicingEmailController();
