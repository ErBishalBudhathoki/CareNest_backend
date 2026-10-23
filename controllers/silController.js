const catchAsync = require('../utils/catchAsync');
const silPropertyService = require('../services/silPropertyService');
const silOccupancyService = require('../services/silOccupancyService');
const silRatioService = require('../services/silRatioService');
const silRosterService = require('../services/silRosterService');
const silQuoteService = require('../services/silQuoteService');
const silRosterOfCareService = require('../services/silRosterOfCareService');
const silBillingService = require('../services/silBillingService');

/**
 * SIL management API (Phase 4). All handlers are org-scoped via the
 * authenticated user's organizationId.
 */
class SILController {
  _org(req) {
    // Multi-org admins select an organisation through the x-organization-id
    // header; requireOrgMembership validates it and exposes the resolved id.
    return req.organizationContext?.organizationId || req.user?.organizationId;
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

  _handleError(res, error, fallback = 'Request failed') {
    const code = error.statusCode || 500;
    return res.status(code).json({
      success: false,
      code: error.code || 'SIL_ERROR',
      message: error.message || fallback,
    });
  }

  // ---- Properties ------------------------------------------------------

  listProperties = catchAsync(async (req, res) => {
    const org = this._requireOrg(req, res);
    if (!org) return;
    const properties = await silPropertyService.listProperties(org, {
      active: req.query.active !== undefined ? req.query.active === 'true' : undefined,
      state: req.query.state,
    });
    res.json({ success: true, data: { properties } });
  });

  getProperty = catchAsync(async (req, res) => {
    const org = this._requireOrg(req, res);
    if (!org) return;
    const property = await silPropertyService.getProperty(org, req.params.id);
    if (!property) {
      return res.status(404).json({ success: false, code: 'NOT_FOUND', message: 'Property not found.' });
    }
    res.json({ success: true, data: property });
  });

  createProperty = catchAsync(async (req, res) => {
    const org = this._requireOrg(req, res);
    if (!org) return;
    try {
      const property = await silPropertyService.createProperty(org, req.body, this._actor(req));
      res.status(201).json({ success: true, message: 'Property created.', data: property });
    } catch (error) {
      this._handleError(res, error);
    }
  });

  updateProperty = catchAsync(async (req, res) => {
    const org = this._requireOrg(req, res);
    if (!org) return;
    const property = await silPropertyService.updateProperty(org, req.params.id, req.body, this._actor(req));
    if (!property) {
      return res.status(404).json({ success: false, code: 'NOT_FOUND', message: 'Property not found.' });
    }
    res.json({ success: true, message: 'Property updated.', data: property });
  });

  deleteProperty = catchAsync(async (req, res) => {
    const org = this._requireOrg(req, res);
    if (!org) return;
    const property = await silPropertyService.deactivateProperty(org, req.params.id, this._actor(req));
    if (!property) {
      return res.status(404).json({ success: false, code: 'NOT_FOUND', message: 'Property not found.' });
    }
    res.json({ success: true, message: 'Property deactivated.' });
  });

  getVacancies = catchAsync(async (req, res) => {
    const org = this._requireOrg(req, res);
    if (!org) return;
    const board = await silPropertyService.getVacancies(org, req.params.id);
    if (!board) {
      return res.status(404).json({ success: false, code: 'NOT_FOUND', message: 'Property not found.' });
    }
    res.json({ success: true, data: board });
  });

  // ---- Occupancy -------------------------------------------------------

  listOccupancy = catchAsync(async (req, res) => {
    const org = this._requireOrg(req, res);
    if (!org) return;
    const occupancy = await silOccupancyService.listOccupancy(org, {
      propertyId: req.query.propertyId,
      clientId: req.query.clientId,
      status: req.query.status,
    });
    res.json({ success: true, data: { occupancy } });
  });

  createOccupancy = catchAsync(async (req, res) => {
    const org = this._requireOrg(req, res);
    if (!org) return;
    try {
      const occupancy = await silOccupancyService.createOccupancy(org, req.body, this._actor(req));
      res.status(201).json({ success: true, message: 'Occupancy created.', data: occupancy });
    } catch (error) {
      this._handleError(res, error);
    }
  });

  endOccupancy = catchAsync(async (req, res) => {
    const org = this._requireOrg(req, res);
    if (!org) return;
    try {
      const occupancy = await silOccupancyService.endOccupancy(org, req.params.id, req.body, this._actor(req));
      res.json({ success: true, message: 'Occupancy ended.', data: occupancy });
    } catch (error) {
      this._handleError(res, error);
    }
  });

  // ---- Ratio rules -----------------------------------------------------

  listRatioRules = catchAsync(async (req, res) => {
    const org = this._requireOrg(req, res);
    if (!org) return;
    const rules = await silRatioService.listRules(org, {
      shiftType: req.query.shiftType,
      isActive: req.query.isActive !== undefined ? req.query.isActive === 'true' : undefined,
    });
    res.json({ success: true, data: { rules } });
  });

  createRatioRule = catchAsync(async (req, res) => {
    const org = this._requireOrg(req, res);
    if (!org) return;
    const rule = await silRatioService.createRule(org, req.body);
    res.status(201).json({ success: true, message: 'Ratio rule created.', data: rule });
  });

  updateRatioRule = catchAsync(async (req, res) => {
    const org = this._requireOrg(req, res);
    if (!org) return;
    const rule = await silRatioService.updateRule(org, req.params.id, req.body);
    if (!rule) {
      return res.status(404).json({ success: false, code: 'NOT_FOUND', message: 'Ratio rule not found.' });
    }
    res.json({ success: true, message: 'Ratio rule updated.', data: rule });
  });

  deleteRatioRule = catchAsync(async (req, res) => {
    const org = this._requireOrg(req, res);
    if (!org) return;
    const rule = await silRatioService.deleteRule(org, req.params.id);
    if (!rule) {
      return res.status(404).json({ success: false, code: 'NOT_FOUND', message: 'Ratio rule not found.' });
    }
    res.json({ success: true, message: 'Ratio rule deactivated.' });
  });

  // ---- Rosters ---------------------------------------------------------

  getRoster = catchAsync(async (req, res) => {
    const org = this._requireOrg(req, res);
    if (!org) return;
    const roster = await silRosterService.getRoster(org, req.query.propertyId, req.query.weekStarting);
    res.json({ success: true, data: roster });
  });

  buildRoster = catchAsync(async (req, res) => {
    const org = this._requireOrg(req, res);
    if (!org) return;
    try {
      const roster = await silRosterService.buildRoster(
        org,
        { propertyId: req.body.propertyId, weekStarting: req.body.weekStarting },
        this._actor(req),
      );
      res.status(201).json({ success: true, message: 'Roster built.', data: roster });
    } catch (error) {
      this._handleError(res, error);
    }
  });

  updateRoster = catchAsync(async (req, res) => {
    const org = this._requireOrg(req, res);
    if (!org) return;
    const roster = await silRosterService.updateRoster(org, req.params.id, req.body, this._actor(req));
    if (!roster) {
      return res.status(404).json({ success: false, code: 'NOT_FOUND', message: 'Roster not found.' });
    }
    res.json({ success: true, message: 'Roster updated.', data: roster });
  });

  publishRoster = catchAsync(async (req, res) => {
    const org = this._requireOrg(req, res);
    if (!org) return;
    const result = await silRosterService.publishRoster(
      org,
      req.params.id,
      { blockOnRatioBreach: req.body?.blockOnRatioBreach === true },
      this._actor(req),
    );
    if (result.notFound) {
      return res.status(404).json({ success: false, code: 'NOT_FOUND', message: 'Roster not found.' });
    }
    if (result.blocked) {
      return res.status(409).json({
        success: false,
        code: 'RATIO_BREACH',
        message: 'Roster has understaffed shifts and blocking is enabled.',
        data: { roster: result.roster },
      });
    }
    res.json({ success: true, message: 'Roster published.', data: result.roster });
  });

  getRosterCompliance = catchAsync(async (req, res) => {
    const org = this._requireOrg(req, res);
    if (!org) return;
    const report = await silRosterService.getCompliance(org, req.params.id);
    if (!report) {
      return res.status(404).json({ success: false, code: 'NOT_FOUND', message: 'Roster not found.' });
    }
    res.json({ success: true, data: report });
  });

  // ---- Quotes ----------------------------------------------------------

  listQuotes = catchAsync(async (req, res) => {
    const org = this._requireOrg(req, res);
    if (!org) return;
    const quotes = await silQuoteService.listQuotes(org, {
      clientId: req.query.clientId,
      status: req.query.status,
    });
    res.json({ success: true, data: { quotes } });
  });

  getQuote = catchAsync(async (req, res) => {
    const org = this._requireOrg(req, res);
    if (!org) return;
    const quote = await silQuoteService.getQuote(org, req.params.id);
    if (!quote) {
      return res.status(404).json({ success: false, code: 'NOT_FOUND', message: 'Quote not found.' });
    }
    res.json({ success: true, data: quote });
  });

  createQuote = catchAsync(async (req, res) => {
    const org = this._requireOrg(req, res);
    if (!org) return;
    const quote = await silQuoteService.buildQuote(org, req.body, this._actor(req));
    res.status(201).json({ success: true, message: 'Quote created.', data: quote });
  });

  updateQuote = catchAsync(async (req, res) => {
    const org = this._requireOrg(req, res);
    if (!org) return;
    const quote = await silQuoteService.updateQuote(org, req.params.id, req.body, this._actor(req));
    if (!quote) {
      return res.status(404).json({ success: false, code: 'NOT_FOUND', message: 'Quote not found.' });
    }
    res.json({ success: true, message: 'Quote updated.', data: quote });
  });

  sendQuote = catchAsync(async (req, res) => {
    const org = this._requireOrg(req, res);
    if (!org) return;
    const quote = await silQuoteService.sendQuote(org, req.params.id, this._actor(req));
    if (!quote) {
      return res.status(409).json({ success: false, code: 'INVALID_STATE', message: 'Quote cannot be sent.' });
    }
    res.json({ success: true, message: 'Quote sent.', data: quote });
  });

  acceptQuote = catchAsync(async (req, res) => {
    const org = this._requireOrg(req, res);
    if (!org) return;
    const result = await silQuoteService.acceptQuote(org, req.params.id, this._actor(req));
    if (result.notFound) {
      return res.status(404).json({ success: false, code: 'NOT_FOUND', message: 'Quote not found.' });
    }
    if (result.blocked) {
      return res.status(409).json({
        success: false,
        code: 'PRICE_VALIDATION_FAILED',
        message: 'Quote has lines that fail price validation.',
        data: { failing: result.failing },
      });
    }
    res.json({ success: true, message: 'Quote accepted.', data: result.quote });
  });

  declineQuote = catchAsync(async (req, res) => {
    const org = this._requireOrg(req, res);
    if (!org) return;
    const quote = await silQuoteService.declineQuote(org, req.params.id, this._actor(req));
    if (!quote) {
      return res.status(404).json({ success: false, code: 'NOT_FOUND', message: 'Quote not found.' });
    }
    res.json({ success: true, message: 'Quote declined.', data: quote });
  });

  convertQuote = catchAsync(async (req, res) => {
    const org = this._requireOrg(req, res);
    if (!org) return;
    const result = await silQuoteService.convertToRosterOfCare(org, req.params.id, req.body, this._actor(req));
    if (result.notFound) {
      return res.status(404).json({ success: false, code: 'NOT_FOUND', message: 'Quote not found.' });
    }
    if (result.invalidState) {
      return res.status(409).json({
        success: false,
        code: 'INVALID_STATE',
        message: `Only accepted quotes can be converted (current: ${result.status}).`,
      });
    }
    if (result.conflict) {
      return res.status(409).json({
        success: false,
        code: 'ROC_CONFLICT',
        message: 'This client already has an active roster of care.',
        data: { rosterOfCareId: result.existing?._id?.toString?.() ?? null },
      });
    }
    res.status(201).json({
      success: true,
      message: 'Quote converted to roster of care.',
      data: { quote: result.quote, rosterOfCare: result.rosterOfCare },
    });
  });

  // ---- Rosters of care -------------------------------------------------

  listRostersOfCare = catchAsync(async (req, res) => {
    const org = this._requireOrg(req, res);
    if (!org) return;
    const rosters = await silRosterOfCareService.list(org, {
      clientId: req.query.clientId,
      status: req.query.status,
    });
    res.json({ success: true, data: { rostersOfCare: rosters } });
  });

  getRosterOfCare = catchAsync(async (req, res) => {
    const org = this._requireOrg(req, res);
    if (!org) return;
    const roc = await silRosterOfCareService.get(org, req.params.id);
    if (!roc) {
      return res.status(404).json({ success: false, code: 'NOT_FOUND', message: 'Roster of care not found.' });
    }
    res.json({ success: true, data: roc });
  });

  updateRosterOfCare = catchAsync(async (req, res) => {
    const org = this._requireOrg(req, res);
    if (!org) return;
    const roc = await silRosterOfCareService.update(org, req.params.id, req.body, this._actor(req));
    if (!roc) {
      return res.status(404).json({ success: false, code: 'NOT_FOUND', message: 'Roster of care not found.' });
    }
    res.json({ success: true, message: 'Roster of care updated.', data: roc });
  });

  reviewRosterOfCare = catchAsync(async (req, res) => {
    const org = this._requireOrg(req, res);
    if (!org) return;
    const roc = await silRosterOfCareService.review(org, req.params.id, req.body, this._actor(req));
    if (!roc) {
      return res.status(404).json({ success: false, code: 'NOT_FOUND', message: 'Roster of care not found.' });
    }
    res.json({ success: true, message: 'Roster of care reviewed.', data: roc });
  });

  /**
   * Materialise an active RoC's agreed weekly pattern into that week's shifts
   * (unassigned) so staff can be assigned in one place.
   */
  materializeRosterOfCareShifts = catchAsync(async (req, res) => {
    const org = this._requireOrg(req, res);
    if (!org) return;
    const result = await silRosterService.materializeRocShifts(
      org,
      req.params.id,
      { weekStarting: req.body.weekStarting, timezone: req.body.timezone },
      this._actor(req),
    );
    if (result.notFound) {
      return res.status(404).json({ success: false, code: 'NOT_FOUND', message: 'Roster of care not found.' });
    }
    if (result.invalidState) {
      return res.status(409).json({
        success: false,
        code: 'INVALID_STATE',
        message: `Only an active roster of care can be planned (current: ${result.status}).`,
      });
    }
    if (result.clientNotFound) {
      return res.status(404).json({ success: false, code: 'CLIENT_NOT_FOUND', message: 'Client not found.' });
    }
    if (result.noPattern) {
      return res.status(409).json({
        success: false,
        code: 'NO_PATTERN',
        message: 'This roster of care has no agreed days/times. Add a weekly pattern to its supports first.',
      });
    }
    res.status(201).json({
      success: true,
      message: `Planned ${result.created.length} shift(s)${result.skipped.length ? ` (${result.skipped.length} already existed)` : ''}.`,
      data: {
        rosterOfCareId: String(result.roc._id),
        weekStarting: result.week,
        created: result.created.length,
        skipped: result.skipped.length,
        shiftIds: result.created.map((s) => s._id?.toString?.()),
      },
    });
  });

  /**
   * Bill one period of an active roster of care. Produces a client invoice
   * whose funding route (claim CSV vs PDF) is stamped from the participant's
   * funding type. See docs/SIL_MANAGEMENT_SPEC.md section 7.
   */
  generateRosterOfCareInvoice = catchAsync(async (req, res) => {
    const org = this._requireOrg(req, res);
    if (!org) return;
    const result = await silBillingService.generateInvoiceFromRosterOfCare(
      org,
      req.params.id,
      { from: req.body.from, to: req.body.to, dueDate: req.body.dueDate },
      this._actor(req),
    );
    if (result.notFound) {
      return res.status(404).json({ success: false, code: 'NOT_FOUND', message: 'Roster of care not found.' });
    }
    if (result.clientNotFound) {
      return res.status(404).json({ success: false, code: 'CLIENT_NOT_FOUND', message: 'Participant not found.' });
    }
    if (result.invalidPeriod) {
      return res.status(400).json({ success: false, code: 'INVALID_PERIOD', message: result.message });
    }
    if (result.invalidState) {
      return res.status(409).json({
        success: false,
        code: 'INVALID_STATE',
        message: result.message || `Only an active roster of care can be invoiced (current: ${result.status}).`,
      });
    }
    if (result.conflict) {
      return res.status(409).json({
        success: false,
        code: 'DUPLICATE_PERIOD',
        message: 'This roster of care has already been invoiced for that period.',
        data: { invoiceId: result.existingInvoiceId },
      });
    }
    res.status(201).json({
      success: true,
      message: 'Roster of care invoiced.',
      data: {
        invoiceId: result.invoice?._id,
        invoiceNumber: result.invoice?.invoiceNumber,
        billing: result.billing,
      },
    });
  });
}

module.exports = new SILController();
