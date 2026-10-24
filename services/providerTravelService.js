const Shift = require('../models/Shift');
const Client = require('../models/Client');
const Trip = require('../models/Trip');
const SupportItem = require('../models/SupportItem');
const {
  InvoiceManagementService: invoiceManagementService,
} = require('./invoiceManagementService');
const { priceValidationService } = require('./priceValidationService');
const logger = require('../config/logger');

function round2(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

/**
 * NDIS provider travel billing.
 *
 * Provider travel is claimable as:
 *   - labour time (unit H) — travel minutes × hourly cap
 *   - non-labour distance (unit KM) — km × per-km cap
 *
 * The caller supplies the NDIS travel support item number(s) and either the
 * billable minutes/km. Prices default to the published cap; an explicit
 * agreed price below the cap can be supplied.
 */
class ProviderTravelService {
  /**
   * Build a travel charge automatically from approved mileage trips linked to
   * the shift's worker/participant. The km total is the sum of approved,
   * reimbursable trips in the shift window (one day either side).
   */
  async createTravelChargeFromTrips(organizationId, input = {}, actor = '') {
    const shift = await Shift.findOne({
      _id: input.shiftId,
      organizationId,
      isActive: { $ne: false },
    });
    if (!shift) return { notFound: true };
    if (!shift.employeeId) return { missingWorker: true };

    const start = new Date(new Date(shift.startTime).getTime() - 24 * 60 * 60 * 1000);
    const end = new Date(new Date(shift.endTime).getTime() + 24 * 60 * 60 * 1000);
    const query = {
      organizationId,
      userId: shift.employeeId,
      status: 'APPROVED',
      isReimbursable: true,
      date: { $gte: start, $lte: end },
    };
    if (shift.clientId) query.clientId = shift.clientId;

    const trips = await Trip.find(query).lean();
    const km = round2(
      (trips || []).reduce((sum, trip) => sum + (Number(trip.distance) || 0), 0),
    );
    if (km <= 0) {
      return { noTrips: true, km: 0, tripCount: trips?.length || 0 };
    }

    let nonLabourSupportNumber = input.nonLabourSupportNumber;
    if (!nonLabourSupportNumber) {
      nonLabourSupportNumber = await this._findNonLabourTravelItem(shift);
    }
    if (!nonLabourSupportNumber) {
      return { missingSupportItem: true, km, tripCount: trips.length };
    }

    const result = await this.createTravelCharge(
      organizationId,
      {
        ...input,
        shiftId: shift._id,
        km,
        minutes: input.minutes || 0,
        nonLabourSupportNumber,
      },
      actor,
    );
    return { ...result, km, tripCount: trips.length };
  }

  /**
   * Find the non-labour provider-travel item that matches the shift's support
   * category and registration group (e.g. 01 + 0107 → 01_799_0107_*).
   */
  async _findNonLabourTravelItem(shift) {
    const supportNumber = shift.supportItems?.[0]?.itemNumber || '';
    const parts = String(supportNumber).split('_');
    const category = parts[0];
    const registrationGroup = parts[2];

    if (category && registrationGroup) {
      const match = await SupportItem.findOne({
        supportItemNumber: new RegExp(
          `^${category}_799_${registrationGroup}_`,
        ),
      }).lean();
      if (match?.supportItemNumber) return match.supportItemNumber;
    }

    if (category) {
      const fallback = await SupportItem.findOne({
        supportItemNumber: new RegExp(`^${category}_799_`),
      }).lean();
      if (fallback?.supportItemNumber) return fallback.supportItemNumber;
    }
    return null;
  }

  async createTravelCharge(organizationId, input = {}, actor = '') {    const shift = await Shift.findOne({
      _id: input.shiftId,
      organizationId,
      isActive: { $ne: false },
    });
    if (!shift) return { notFound: true };
    if (shift.status === 'completed') {
      return { invalidState: true, status: shift.status };
    }
    if (shift.providerTravel?.invoiceId) {
      return {
        alreadyBilled: true,
        invoiceId: shift.providerTravel.invoiceId.toString(),
      };
    }

    const minutes = Number(input.minutes) || 0;
    const km = Number(input.km) || 0;
    if (minutes < 0 || km < 0) {
      const err = new Error('minutes and km must be non-negative.');
      err.statusCode = 400;
      err.code = 'INVALID_TRAVEL_QUANTITY';
      throw err;
    }
    if (minutes <= 0 && km <= 0) {
      const err = new Error('Provide billable minutes and/or km.');
      err.statusCode = 400;
      err.code = 'EMPTY_TRAVEL_CHARGE';
      throw err;
    }
    if (minutes > 0 && !input.labourSupportNumber) {
      const err = new Error(
        'labourSupportNumber is required when travel minutes are billed.',
      );
      err.statusCode = 422;
      err.code = 'MISSING_TRAVEL_SUPPORT_ITEM';
      throw err;
    }
    if (km > 0 && !input.nonLabourSupportNumber) {
      const err = new Error(
        'nonLabourSupportNumber is required when travel km are billed.',
      );
      err.statusCode = 422;
      err.code = 'MISSING_TRAVEL_SUPPORT_ITEM';
      throw err;
    }

    const client = await Client.findOne({
      _id: shift.clientId,
      organizationId,
    }).lean();
    if (!client) return { clientNotFound: true };

    const state = client.clientState || 'NSW';
    const serviceDate = shift.startTime ? new Date(shift.startTime) : new Date();
    const lineItems = [];

    const resolvePrice = async (supportNumber, explicitPrice) => {
      if (Number.isFinite(Number(explicitPrice)) && Number(explicitPrice) > 0) {
        return round2(explicitPrice);
      }
      try {
        const validation = await priceValidationService.validatePrice(
          supportNumber,
          0,
          state,
          'standard',
          serviceDate,
        );
        const cap = Number(validation?.priceCap);
        if (Number.isFinite(cap) && cap > 0) return round2(cap);
      } catch (_) {
        const err = new Error(
          'The NDIS price guide is unavailable, so provider travel cannot be priced. Please retry.',
        );
        err.statusCode = 503;
        err.code = 'PRICE_CATALOG_UNAVAILABLE';
        throw err;
      }
      const err = new Error(
        `No NDIS price cap is available for travel support item ${supportNumber}.`,
      );
      err.statusCode = 422;
      err.code = 'PRICE_CAP_NOT_FOUND';
      throw err;
    };

    if (minutes > 0) {
      const price = await resolvePrice(
        input.labourSupportNumber,
        input.labourUnitPrice,
      );
      const hours = round2(minutes / 60);
      lineItems.push({
        supportItemNumber: input.labourSupportNumber,
        supportItemName: input.labourSupportName || 'Provider travel — labour',
        price,
        quantity: hours,
        unit: 'H',
        totalPrice: round2(hours * price),
        date: serviceDate,
        organizationId,
        claimType: 'STANDARD',
      });
    }

    if (km > 0) {
      const price = await resolvePrice(
        input.nonLabourSupportNumber,
        input.kmUnitPrice,
      );
      lineItems.push({
        supportItemNumber: input.nonLabourSupportNumber,
        supportItemName: input.nonLabourSupportName || 'Provider travel — non-labour',
        price,
        quantity: round2(km),
        unit: 'KM',
        totalPrice: round2(km * price),
        date: serviceDate,
        organizationId,
        claimType: 'STANDARD',
      });
    }

    const subtotal = round2(
      lineItems.reduce((sum, item) => sum + item.totalPrice, 0),
    );
    const clientName =
      [client.clientFirstName, client.clientLastName].filter(Boolean).join(' ').trim() ||
      [client.firstName, client.lastName].filter(Boolean).join(' ').trim();
    const clientEmail = client.clientEmail || client.email || '';
    const invoiceNumber = await invoiceManagementService.generateInvoiceNumber(
      organizationId,
      { clientId: String(shift.clientId), clientName, clientEmail },
    );

    const invoiceData = {
      organizationId,
      invoiceNumber,
      clientId: String(shift.clientId),
      clientEmail,
      clientName,
      lineItems,
      financialSummary: {
        subtotal,
        taxAmount: 0,
        discountAmount: 0,
        expenseAmount: 0,
        totalAmount: subtotal,
        currency: 'AUD',
        exchangeRate: 1.0,
        paymentTerms: 30,
      },
      metadata: {
        invoiceType: 'client',
        generationMethod: 'ndis_provider_travel',
        category: 'Provider travel',
        shiftId: String(shift._id),
        servicePeriod: {
          from: shift.startTime,
          to: shift.endTime,
        },
        travel: { minutes, km },
        internalNotes: `Provider travel for shift ${shift._id}`,
      },
      workflow: {
        status: 'generated',
        approvalRequired: false,
        currentStep: 'generated',
        nextAction: 'send',
      },
      auditTrail: {
        createdBy: actor || 'system',
        createdAt: new Date(),
        updatedBy: actor || 'system',
        updatedAt: new Date(),
        version: 1,
        changeHistory: [
          {
            timestamp: new Date(),
            userId: actor || 'system',
            action: 'created',
            changes: { source: 'ndis_provider_travel', minutes, km },
            reason: 'NDIS provider travel charged',
          },
        ],
      },
      deletion: { isDeleted: false, canRestore: true },
    };

    const result = await invoiceManagementService.createInvoice(invoiceData);
    if (!result.success) {
      const err = new Error(result.error || 'Failed to create provider travel invoice');
      err.statusCode = result.statusCode || 500;
      err.code = result.errorCode || 'TRAVEL_INVOICE_FAILED';
      err.details = result.planValidation || null;
      throw err;
    }

    shift.providerTravel = {
      invoiceId: result.data._id,
      km,
      minutes,
      amount: subtotal,
      billedAt: new Date(),
    };
    await shift.save();

    logger.business('NDIS Provider Travel Billed', {
      event: 'ndis_provider_travel_billed',
      organizationId,
      shiftId: String(shift._id),
      invoiceId: String(result.data._id),
      minutes,
      km,
      amount: subtotal,
    });

    return { invoice: result.data, amount: subtotal, shift };
  }
}

module.exports = new ProviderTravelService();
