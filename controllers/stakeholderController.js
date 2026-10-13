const catchAsync = require('../utils/catchAsync');
const stakeholderService = require('../services/stakeholderService');

/**
 * Multi-stakeholder CRM API (Phase 5). Org-scoped via the authenticated user.
 */
class StakeholderController {
  _org(req) {
    return req.user?.organizationId;
  }

  _actor(req) {
    return req.user?.email || '';
  }

  _requireOrg(req, res) {
    const org = this._org(req);
    if (!org) {
      res.status(400).json({
        success: false,
        code: 'MISSING_ORGANIZATION',
        message: 'Organization context is required.',
      });
      return null;
    }
    return org;
  }

  listStakeholders = catchAsync(async (req, res) => {
    const org = this._requireOrg(req, res);
    if (!org) return;
    const stakeholders = await stakeholderService.listStakeholders(org, {
      type: req.query.type,
      active: req.query.active !== undefined ? req.query.active === 'true' : undefined,
    });
    res.json({ success: true, data: { stakeholders } });
  });

  getStakeholder = catchAsync(async (req, res) => {
    const org = this._requireOrg(req, res);
    if (!org) return;
    const stakeholder = await stakeholderService.getStakeholder(org, req.params.id);
    if (!stakeholder) {
      return res.status(404).json({ success: false, code: 'NOT_FOUND', message: 'Stakeholder not found.' });
    }
    res.json({ success: true, data: stakeholder });
  });

  createStakeholder = catchAsync(async (req, res) => {
    const org = this._requireOrg(req, res);
    if (!org) return;
    const stakeholder = await stakeholderService.createStakeholder(org, req.body, this._actor(req));
    res.status(201).json({ success: true, message: 'Stakeholder created.', data: stakeholder });
  });

  updateStakeholder = catchAsync(async (req, res) => {
    const org = this._requireOrg(req, res);
    if (!org) return;
    const stakeholder = await stakeholderService.updateStakeholder(org, req.params.id, req.body, this._actor(req));
    if (!stakeholder) {
      return res.status(404).json({ success: false, code: 'NOT_FOUND', message: 'Stakeholder not found.' });
    }
    res.json({ success: true, message: 'Stakeholder updated.', data: stakeholder });
  });

  deleteStakeholder = catchAsync(async (req, res) => {
    const org = this._requireOrg(req, res);
    if (!org) return;
    const stakeholder = await stakeholderService.deactivateStakeholder(org, req.params.id, this._actor(req));
    if (!stakeholder) {
      return res.status(404).json({ success: false, code: 'NOT_FOUND', message: 'Stakeholder not found.' });
    }
    res.json({ success: true, message: 'Stakeholder deactivated.' });
  });

  // ---- Client linking ----

  getClientCareTeam = catchAsync(async (req, res) => {
    const org = this._requireOrg(req, res);
    if (!org) return;
    const careTeam = await stakeholderService.getClientCareTeam(org, req.params.clientId);
    if (!careTeam) {
      return res.status(404).json({ success: false, code: 'NOT_FOUND', message: 'Client not found.' });
    }
    res.json({ success: true, data: careTeam });
  });

  linkStakeholder = catchAsync(async (req, res) => {
    const org = this._requireOrg(req, res);
    if (!org) return;
    try {
      const client = await stakeholderService.linkToClient(
        org,
        req.params.clientId,
        {
          stakeholderId: req.body.stakeholderId,
          role: req.body.role,
          isPrimary: req.body.isPrimary,
          fundingType: req.body.fundingType,
        },
        this._actor(req),
      );
      res.status(201).json({ success: true, message: 'Stakeholder linked.', data: client });
    } catch (error) {
      const code = error.statusCode || 500;
      return res.status(code).json({
        success: false,
        code: error.code || 'STAKEHOLDER_LINK_FAILED',
        message: error.message,
      });
    }
  });

  unlinkStakeholder = catchAsync(async (req, res) => {
    const org = this._requireOrg(req, res);
    if (!org) return;
    const client = await stakeholderService.unlinkFromClient(
      org,
      req.params.clientId,
      req.params.stakeholderId,
    );
    if (!client) {
      return res.status(404).json({ success: false, code: 'NOT_FOUND', message: 'Client not found.' });
    }
    res.json({ success: true, message: 'Stakeholder unlinked.' });
  });
}

module.exports = new StakeholderController();
