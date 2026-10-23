const SILQuote = require('../models/SILQuote');
const SILRosterOfCare = require('../models/SILRosterOfCare');
const Client = require('../models/Client');
const { priceValidationService } = require('./priceValidationService');
const logger = require('../config/logger');

/**
 * SIL quoting and roster-of-care conversion (Phase 4).
 * See docs/SIL_MANAGEMENT_SPEC.md sections 3.5, 3.6, 4 and 8.
 */
class SILQuoteService {
  async listQuotes(organizationId, { clientId, status } = {}) {
    const filter = { organizationId };
    if (clientId) filter.clientId = clientId;
    if (status) filter.status = status;
    return SILQuote.find(filter).sort({ createdAt: -1 });
  }

  async getQuote(organizationId, id) {
    return SILQuote.findOne({ _id: id, organizationId });
  }

  /**
   * Create a quote, validating every line against NDIS price caps.
   * @param {Object} data - { clientId, propertyId?, fundingType?, validUntil?, lines:[...] }
   */
  async buildQuote(organizationId, data, actor = '') {
    // A quote may only reference a participant (and property) in this
    // organisation; otherwise it creates a cross-tenant reference that later
    // fails billing and confuses the roster-of-care screen.
    const Client = require('../models/Client');
    const SILProperty = require('../models/SILProperty');

    const client = await Client.findOne({
      _id: data.clientId,
      organizationId,
    })
      .select('_id')
      .lean();
    if (!client) {
      const err = new Error('Client not found in this organization.');
      err.statusCode = 403;
      err.code = 'CROSS_ORG_CLIENT';
      throw err;
    }

    if (data.propertyId) {
      const property = await SILProperty.findOne({
        _id: data.propertyId,
        organizationId,
      })
        .select('_id')
        .lean();
      if (!property) {
        const err = new Error('Property not found in this organization.');
        err.statusCode = 403;
        err.code = 'CROSS_ORG_PROPERTY';
        throw err;
      }
    }

    const lines = await this._priceLines(data.lines || []);
    const totals = this._totals(lines);

    const quote = await SILQuote.create({
      organizationId,
      clientId: data.clientId,
      propertyId: data.propertyId || null,
      fundingType: data.fundingType || 'plan_managed',
      validUntil: data.validUntil || null,
      lines,
      totals,
      status: 'draft',
      createdBy: actor,
      updatedBy: actor,
    });

    logger.business('SIL Quote Created', {
      event: 'sil_quote_created',
      organizationId,
      quoteId: quote._id.toString(),
      weeklyAmount: totals.weeklyAmount,
    });

    return quote;
  }

  async updateQuote(organizationId, id, data, actor = '') {
    const quote = await SILQuote.findOne({ _id: id, organizationId });
    if (!quote) return null;

    if (Array.isArray(data.lines)) {
      quote.lines = await this._priceLines(data.lines);
      quote.totals = this._totals(quote.lines);
    }
    if (data.fundingType !== undefined) quote.fundingType = data.fundingType;
    if (data.validUntil !== undefined) quote.validUntil = data.validUntil;
    if (data.propertyId !== undefined) quote.propertyId = data.propertyId;
    quote.updatedBy = actor;
    await quote.save();
    return quote;
  }

  async sendQuote(organizationId, id, actor = '') {
    const quote = await SILQuote.findOneAndUpdate(
      { _id: id, organizationId, status: 'draft' },
      { status: 'sent', updatedBy: actor },
      { new: true },
    );
    return quote;
  }

  /**
   * Accept a quote. Refuses when any line failed cap validation.
   */
  async acceptQuote(organizationId, id, actor = '') {
    const quote = await SILQuote.findOne({ _id: id, organizationId });
    if (!quote) return { notFound: true };

    const failing = quote.lines.filter((l) => l.priceValidation && l.priceValidation.passed === false);
    if (failing.length > 0) {
      return { blocked: true, failing };
    }

    quote.status = 'accepted';
    quote.approvedBy = actor;
    quote.approvedAt = new Date();
    quote.updatedBy = actor;
    await quote.save();
    return { quote };
  }

  async declineQuote(organizationId, id, actor = '') {
    return SILQuote.findOneAndUpdate(
      { _id: id, organizationId },
      { status: 'declined', updatedBy: actor },
      { new: true },
    );
  }

  /**
   * Convert an accepted quote into an active roster-of-care.
   */
  async convertToRosterOfCare(organizationId, id, { effectiveFrom, cadence = 'quarterly' } = {}, actor = '') {
    const quote = await SILQuote.findOne({ _id: id, organizationId });
    if (!quote) return { notFound: true };
    if (quote.status !== 'accepted') {
      return { invalidState: true, status: quote.status };
    }

    const from = effectiveFrom ? new Date(effectiveFrom) : new Date();
    const nextReview = this._nextReview(from, cadence);

    // §8.6: reject a new active RoC when the client already has an active /
    // under-review RoC (its period is open-ended unless it has an effectiveTo).
    const existingActive = await SILRosterOfCare.findOne({
      organizationId,
      clientId: quote.clientId,
      status: { $in: ['active', 'under_review'] },
      $or: [{ effectiveTo: null }, { effectiveTo: { $gte: from } }],
    });
    if (existingActive) {
      return { conflict: true, existing: existingActive };
    }

    const roc = await SILRosterOfCare.create({
      organizationId,
      clientId: quote.clientId,
      propertyId: quote.propertyId,
      quoteId: quote._id,
      effectiveFrom: from,
      supports: quote.lines.map((l) => ({
        supportNumber: l.supportNumber,
        supportName: l.supportName,
        shiftType: l.shiftType,
        hoursPerWeek: l.hoursPerWeek,
        unitPrice: l.unitPrice,
        gstCode: l.gstCode,
        amount: l.amount,
        days: l.days || [],
        startTime: l.startTime || '',
        endTime: l.endTime || '',
      })),
      reviewSchedule: { cadence, nextReviewDate: nextReview },
      status: 'active',
      history: [{ changedAt: new Date(), changedBy: actor, change: 'Created from quote' }],
      createdBy: actor,
      updatedBy: actor,
    });

    quote.status = 'converted';
    quote.rosterOfCareId = roc._id;
    quote.updatedBy = actor;
    await quote.save();

    // §7: the participant's funding type follows the accepted quote, so the
    // Phase 6 route (claim CSV vs plan/self-managed PDF) is correct for every
    // invoice generated from this roster of care. Past invoices keep their own
    // stamped `billing` block and are unaffected.
    if (quote.fundingType) {
      await Client.updateOne(
        { _id: quote.clientId, organizationId },
        { $set: { fundingType: quote.fundingType } },
      );
    }

    logger.business('SIL Quote Converted', {
      event: 'sil_quote_converted',
      organizationId,
      quoteId: quote._id.toString(),
      rosterOfCareId: roc._id.toString(),
    });

    return { quote, rosterOfCare: roc };
  }

  async _priceLines(lines) {
    const priced = [];
    for (const line of lines) {
      const hours = Number(line.hoursPerWeek) || 0;
      const unitPrice = Number(line.unitPrice) || 0;
      const amount = Math.round(hours * unitPrice * 100) / 100;

      let validation = { passed: true, capApplied: null, type: null, errors: [] };
      try {
        const result = await priceValidationService.validatePrice(
          line.supportNumber,
          unitPrice,
          line.state || 'NSW',
          line.providerType || 'standard',
          line.serviceDate || new Date(),
        );
        validation = {
          passed: result.isValid !== false,
          capApplied: result.priceCap ?? null,
          type: result.status ?? null,
          errors: result.isValid === false ? [result.message || 'Price validation failed'] : [],
        };
      } catch (error) {
        // Catalog unavailable: keep the line but flag that it was not validated.
        validation = { passed: true, capApplied: null, type: 'unvalidated', errors: [] };
      }

      priced.push({
        supportNumber: line.supportNumber,
        supportName: line.supportName || '',
        shiftType: line.shiftType || 'day',
        hoursPerWeek: hours,
        unitPrice,
        gstCode: line.gstCode || 'P2',
        amount,
        days: Array.isArray(line.days) ? line.days.filter(Boolean) : [],
        startTime: line.startTime || '',
        endTime: line.endTime || '',
        priceValidation: validation,
      });
    }
    return priced;
  }

  _totals(lines) {
    const weeklyHours = lines.reduce((sum, l) => sum + (l.hoursPerWeek || 0), 0);
    const weeklyAmount = lines.reduce((sum, l) => sum + (l.amount || 0), 0);
    return {
      weeklyHours: Math.round(weeklyHours * 100) / 100,
      weeklyAmount: Math.round(weeklyAmount * 100) / 100,
      annualAmount: Math.round(weeklyAmount * 52 * 100) / 100,
    };
  }

  _nextReview(from, cadence) {
    const d = new Date(from);
    if (cadence === 'monthly') d.setMonth(d.getMonth() + 1);
    else if (cadence === 'annual') d.setFullYear(d.getFullYear() + 1);
    else d.setMonth(d.getMonth() + 3);
    return d;
  }
}

module.exports = new SILQuoteService();
