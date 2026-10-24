const Shift = require('../models/Shift');
const Client = require('../models/Client');
const {
  InvoiceManagementService: invoiceManagementService,
} = require('./invoiceManagementService');
const { priceValidationService } = require('./priceValidationService');
const rules = require('../config/ndisBillingRules');
const logger = require('../config/logger');

const MS_PER_HOUR = 60 * 60 * 1000;

function round2(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function isNdiaManaged(fundingType) {
  const funding = String(fundingType || '').toLowerCase();
  return funding === 'ndia_managed' || funding === 'combination';
}

/**
 * NDIS short-notice cancellation billing.
 *
 * Creates a client invoice for a cancelled shift when the notice period is
 * inside the participant's funding-route window. The invoice line carries
 * `claimType: CANCELLATION` and `cancellationReason: NSCC`, so the existing
 * claim-batch generator exports it as a cancellation claim.
 */
class CancellationBillingService {
  /**
   * @param {string} organizationId
   * @param {Object} input - { shiftId, reason, cancelledAt, noticeHours?, unitPrice? }
   * @param {string} actor
   */
  async createCancellationCharge(organizationId, input = {}, actor = '') {
    const shift = await Shift.findOne({
      _id: input.shiftId,
      organizationId,
      isActive: { $ne: false },
    });
    if (!shift) return { notFound: true };

    if (shift.cancellation?.invoiceId) {
      return {
        alreadyBilled: true,
        invoiceId: shift.cancellation.invoiceId.toString(),
      };
    }
    if (shift.status === 'completed') {
      return { invalidState: true, status: shift.status };
    }

    const reason = String(input.reason || 'NSCC').toUpperCase();
    if (!['NSCC', 'NSDH'].includes(reason)) {
      const err = new Error('reason must be NSCC or NSDH.');
      err.statusCode = 400;
      err.code = 'INVALID_CANCELLATION_REASON';
      throw err;
    }

    const cancelledAt = input.cancelledAt ? new Date(input.cancelledAt) : new Date();
    if (Number.isNaN(cancelledAt.getTime())) {
      const err = new Error('cancelledAt must be a valid date.');
      err.statusCode = 400;
      err.code = 'INVALID_CANCELLED_AT';
      throw err;
    }

    const shiftStart = new Date(shift.startTime);
    const shiftEnd = new Date(shift.endTime);
    const noticeHours =
      input.noticeHours != null
        ? Number(input.noticeHours)
        : round2((shiftStart.getTime() - cancelledAt.getTime()) / MS_PER_HOUR);
    if (!Number.isFinite(noticeHours) || noticeHours < 0) {
      const err = new Error('noticeHours must be a non-negative number.');
      err.statusCode = 400;
      err.code = 'INVALID_NOTICE_HOURS';
      throw err;
    }

    const client = await Client.findOne({
      _id: shift.clientId,
      organizationId,
    }).lean();
    if (!client) return { clientNotFound: true };

    const fundingType = String(client.fundingType || 'plan_managed').toLowerCase();
    const threshold =
      rules.shortNoticeHours[fundingType] ??
      rules.shortNoticeHours.plan_managed;
    // NSDH (did not show / no access) is billable regardless of notice.
    const shortNotice = reason === 'NSDH' || noticeHours < threshold;

    const baseCancellation = {
      cancelledAt,
      cancelledBy: actor || '',
      reason,
      noticeHours,
      shortNotice,
      billable: false,
      feeAmount: 0,
    };

    if (!shortNotice) {
      shift.status = 'cancelled';
      shift.cancellation = baseCancellation;
      await shift.save();
      return {
        billable: false,
        reason: 'NOT_SHORT_NOTICE',
        noticeHours,
        thresholdHours: threshold,
        shift,
      };
    }

    const support = (shift.supportItems || [])[0] || {};
    const supportItemNumber = support.itemNumber || input.supportNumber;
    if (!supportItemNumber) {
      const err = new Error(
        'The cancelled shift has no support item, so a cancellation charge cannot be priced.',
      );
      err.statusCode = 422;
      err.code = 'MISSING_SUPPORT_ITEM';
      throw err;
    }

    let unitPrice = Number(input.unitPrice);
    if (!Number.isFinite(unitPrice) || unitPrice <= 0) {
      try {
        const validation = await priceValidationService.validatePrice(
          supportItemNumber,
          0,
          client.clientState || 'NSW',
          'standard',
          shiftStart,
        );
        unitPrice = Number(validation?.priceCap);
      } catch (_) {
        const err = new Error(
          'The NDIS price guide is unavailable, so the cancellation fee cannot be priced. Please retry.',
        );
        err.statusCode = 503;
        err.code = 'PRICE_CATALOG_UNAVAILABLE';
        throw err;
      }
    }
    if (!Number.isFinite(unitPrice) || unitPrice <= 0) {
      const err = new Error(
        `No NDIS price cap is available for support item ${supportItemNumber}.`,
      );
      err.statusCode = 422;
      err.code = 'PRICE_CAP_NOT_FOUND';
      throw err;
    }

    const isSleepover = String(shift.shiftType || '').toLowerCase() === 'sleepover';
    const hours = Math.max(
      0,
      round2(
        (shiftEnd.getTime() - shiftStart.getTime()) / MS_PER_HOUR -
          (Number(shift.breakDuration) || 0) / 60,
      ),
    );
    const quantity = isSleepover ? 1 : hours;
    const unit = isSleepover ? 'E' : 'H';
    if (quantity <= 0) {
      const err = new Error('The cancelled shift has no billable duration.');
      err.statusCode = 422;
      err.code = 'ZERO_DURATION_SHIFT';
      throw err;
    }

    const amount = round2(quantity * unitPrice * (rules.cancellationRate || 1));
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
      lineItems: [
        {
          supportItemNumber,
          supportItemName: support.itemName || support.supportItemName || 'Cancellation',
          price: round2(unitPrice),
          quantity,
          unit,
          totalPrice: amount,
          date: shiftStart,
          organizationId,
          claimType: 'CANCELLATION',
          cancellationReason: reason,
          authorisedBy: actor || 'system',
          participantApproved: 'Y',
        },
      ],
      financialSummary: {
        subtotal: amount,
        taxAmount: 0,
        discountAmount: 0,
        expenseAmount: 0,
        totalAmount: amount,
        currency: 'AUD',
        exchangeRate: 1.0,
        paymentTerms: 30,
      },
      metadata: {
        invoiceType: 'client',
        generationMethod: 'ndis_cancellation',
        category: 'NDIS cancellation',
        shiftId: String(shift._id),
        cancellationReason: reason,
        servicePeriod: { from: shiftStart, to: shiftEnd },
        noticeHours,
        shortNoticeHours: threshold,
        internalNotes: `${reason} cancellation for shift ${shift._id}`,
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
            changes: { source: 'ndis_cancellation', reason },
            reason: 'NDIS short-notice cancellation charged',
          },
        ],
      },
      deletion: { isDeleted: false, canRestore: true },
    };

    const result = await invoiceManagementService.createInvoice(invoiceData);
    if (!result.success) {
      const err = new Error(result.error || 'Failed to create cancellation invoice');
      err.statusCode = result.statusCode || 500;
      err.code = result.errorCode || 'CANCELLATION_INVOICE_FAILED';
      err.details = result.planValidation || null;
      throw err;
    }

    shift.status = 'cancelled';
    shift.cancellation = {
      ...baseCancellation,
      billable: true,
      feeAmount: amount,
      invoiceId: result.data._id,
    };
    await shift.save();

    logger.business('NDIS Cancellation Billed', {
      event: 'ndis_cancellation_billed',
      organizationId,
      shiftId: String(shift._id),
      invoiceId: String(result.data._id),
      reason,
      amount,
      noticeHours,
    });

    return {
      billable: true,
      reason,
      noticeHours,
      thresholdHours: threshold,
      invoice: result.data,
      amount,
      shift,
    };
  }
}

module.exports = new CancellationBillingService();
module.exports.isNdiaManaged = isNdiaManaged;
