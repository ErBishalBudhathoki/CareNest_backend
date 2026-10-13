const crypto = require('crypto');
const ClaimBatch = require('../models/ClaimBatch');
const ClaimLine = require('../models/ClaimLine');
const Client = require('../models/Client');
const Organization = require('../models/Organization');
const Invoice = require('../models/Invoice');
const { priceValidationService } = require('./priceValidationService');
const logger = require('../config/logger');

/**
 * NDIS Bulk Payment Request (BPR) generation (Phase 6).
 * See docs/NDIS_DEPTH_ROADMAP.md section 5.
 *
 * Column layout follows the myplace provider portal 2026-27 template exactly
 * (16 columns, fixed order). A missing column, wrong header, or wrong date
 * format rejects the whole file.
 *
 * Only NDIA-managed claims are batched. There is no public NDIA API: this
 * produces the CSV the provider uploads to the myplace/PACE portal.
 */

// Exact 2026-27 myplace BPR header order. Do not reorder.
const BPR_HEADERS = [
  'RegistrationNumber',
  'NDISNumber',
  'SupportsDeliveredFrom',
  'SupportsDeliveredTo',
  'SupportNumber',
  'ClaimReference',
  'Quantity',
  'Hours',
  'UnitPrice',
  'GSTCode',
  'AuthorisedBy',
  'ParticipantApproved',
  'InKindFundingProgramCode',
  'ClaimType',
  'CancellationReason',
  'ABN',
];

const GST_CODES = ['P1', 'P2'];
const CLAIM_TYPES = ['STANDARD', 'CANCELLATION', 'REPORT'];
const CANCELLATION_REASONS = ['NSCC', 'NSDH'];
const ABN_WEIGHTS = [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19];

/** Format a date as YYYY/MM/DD — the portal's required format (not ISO/DD-MM). */
function formatNdisDate(value) {
  const d = value ? new Date(value) : new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}/${m}/${day}`;
}

function round2(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

/** Escape a CSV field (RFC 4180). */
function csvEscape(value) {
  const s = value === null || value === undefined ? '' : String(value);
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/** True when a support item's unit is hourly (Hours column) vs per-each (Quantity). */
function isHourlyUnit(unit) {
  if (!unit) return false;
  const u = String(unit).trim().toLowerCase();
  return u === 'h' || u === 'hr' || u === 'hour' || u === 'hours' || u.includes('hour');
}

/** ATO ABN checksum validation (11 digits). */
function isValidAbn(abn) {
  const digits = String(abn || '').replace(/\s/g, '');
  if (!/^\d{11}$/.test(digits)) return false;
  const nums = digits.split('').map((d) => parseInt(d, 10));
  nums[0] -= 1;
  const sum = nums.reduce((acc, n, i) => acc + n * ABN_WEIGHTS[i], 0);
  return sum % 89 === 0;
}

class NDISClaimService {
  /**
   * Generate a claim batch for NDIA-managed clients in a period.
   *
   * @param {string} organizationId
   * @param {Object} opts - { from, to, allowInvalid }
   * @param {string} actor
   */
  async generateBatch(organizationId, opts = {}, actor = '') {
    const from = new Date(opts.from);
    const to = new Date(opts.to);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to < from) {
      const err = new Error('Invalid period: from/to are required and to >= from.');
      err.statusCode = 400;
      throw err;
    }

    const org = await Organization.findOne({
      $or: [{ _id: this._objectIdOrNull(organizationId) }, { organizationCode: organizationId }],
    });
    const registrationNumber = org?.ndisRegistration?.registrationNumber || '';
    const abn = org?.abn || '';

    // NDIA-managed participants only.
    const clients = await Client.find({
      organizationId,
      fundingType: 'ndia_managed',
    }).lean();
    const clientById = new Map(clients.map((c) => [c._id.toString(), c]));
    const clientIds = clients.map((c) => c._id);

    let lines = [];
    if (clientIds.length > 0) {
      const invoices = await Invoice.find({
        organizationId,
        clientId: { $in: clientIds.map((id) => id.toString()) },
      }).lean();

      for (const invoice of invoices) {
        for (const item of invoice.lineItems || []) {
          const serviceDate = item.date || invoice.createdAt || from;
          const d = new Date(serviceDate);
          if (d < from || d > to) continue;

          const client = clientById.get(String(invoice.clientId));
          const hourly = isHourlyUnit(item.unit);
          const quantity = round2(item.quantity);
          lines.push({
            clientId: invoice.clientId,
            invoiceId: invoice._id,
            ndisNumber: client?.ndisNumber || '',
            supportNumber: item.supportItemNumber || '',
            serviceDate: d,
            unit: item.unit || '',
            isHourly: hourly,
            quantity: hourly ? 0 : quantity,
            hours: hourly ? quantity : 0,
            unitPrice: round2(item.price),
            gstCode: 'P2',
            claimType: 'STANDARD',
            cancellationReason: '',
            authorisedBy: '',
            participantApproved: 'Y',
            inKindFundingProgramCode: '',
            requestedAmount: round2((item.quantity || 0) * (item.price || 0)),
          });
        }
      }
    }

    const batchHash = crypto.randomBytes(4).toString('hex');
    const shortOrg = String(organizationId).slice(-6);

    // Assign unique claim references (checked against existing lines).
    const existingRefs = new Set(
      (await ClaimLine.find({ organizationId }, 'claimReference').lean()).map(
        (l) => l.claimReference,
      ),
    );
    lines = lines.map((line, index) => {
      let ref;
      let seq = index + 1;
      do {
        ref = `CN-${shortOrg}-${batchHash}-${String(seq).padStart(6, '0')}`;
        seq += 1000000; // bump until unique
      } while (existingRefs.has(ref));
      existingRefs.add(ref);
      return { ...line, claimReference: ref };
    });

    const validation = await this.validateLines(lines, { registrationNumber, abn });

    if (validation.errors.length > 0 && !opts.allowInvalid) {
      const err = new Error('Claim batch failed pre-export validation.');
      err.statusCode = 422;
      err.code = 'CLAIM_VALIDATION_FAILED';
      err.validation = validation;
      throw err;
    }

    const totalAmount = round2(lines.reduce((sum, l) => sum + l.requestedAmount, 0));

    const batch = await ClaimBatch.create({
      organizationId,
      period: { from, to },
      status: 'generated',
      fundingType: 'ndia_managed',
      registrationNumber,
      abn,
      totals: { lines: lines.length, amount: totalAmount },
      generatedBy: actor,
      generatedAt: new Date(),
      createdBy: actor,
    });

    if (lines.length > 0) {
      await ClaimLine.insertMany(
        lines.map((l) => ({
          batchId: batch._id,
          organizationId,
          clientId: l.clientId,
          ndisNumber: l.ndisNumber,
          invoiceId: l.invoiceId,
          supportNumber: l.supportNumber,
          serviceDate: l.serviceDate,
          quantity: l.quantity,
          hours: l.hours,
          unitPrice: l.unitPrice,
          gstCode: l.gstCode,
          claimType: l.claimType,
          cancellationReason: l.cancellationReason,
          authorisedBy: l.authorisedBy,
          participantApproved: l.participantApproved,
          inKindFundingProgramCode: l.inKindFundingProgramCode,
          claimReference: l.claimReference,
          requestedAmount: l.requestedAmount,
        })),
      );
    }

    const csv = this.buildCsv(lines, { registrationNumber, abn });
    batch.fileRef = Buffer.from(csv, 'utf8').toString('base64');
    await batch.save();

    logger.business('NDIS Claim Batch Generated', {
      event: 'ndis_claim_batch_generated',
      organizationId,
      batchId: batch._id.toString(),
      lines: lines.length,
      amount: totalAmount,
    });

    return { batch, csv, validation, lineCount: lines.length };
  }

  /**
   * Pre-export validation gate (mirrors the portal's reject reasons).
   * @returns {{ errors: Array, warnings: Array }}
   */
  async validateLines(lines, { registrationNumber, abn } = {}) {
    const errors = [];
    const warnings = [];

    // Batch-level (provider) checks.
    if (registrationNumber !== undefined) {
      const reg = String(registrationNumber).trim();
      if (!/^\d{6,9}$/.test(reg)) {
        errors.push({
          claimReference: '',
          field: 'RegistrationNumber',
          message: 'RegistrationNumber must be 6–9 digits.',
        });
      }
    }
    if (abn !== undefined) {
      if (!isValidAbn(abn)) {
        errors.push({
          claimReference: '',
          field: 'ABN',
          message: 'ABN must be 11 digits and pass the ATO checksum.',
        });
      }
    }

    const seenRefs = new Set();
    for (const line of lines) {
      const ref = line.claimReference;

      if (!/^\d{9}$/.test(String(line.ndisNumber || '').trim())) {
        errors.push({ claimReference: ref, field: 'NDISNumber', message: 'NDISNumber must be 9 digits.' });
      }
      if (!line.supportNumber) {
        errors.push({ claimReference: ref, field: 'SupportNumber', message: 'Missing support item number.' });
      }
      if (ref && String(ref).length > 50) {
        errors.push({ claimReference: ref, field: 'ClaimReference', message: 'ClaimReference exceeds 50 characters.' });
      }
      if (seenRefs.has(ref)) {
        errors.push({ claimReference: ref, field: 'ClaimReference', message: 'Duplicate claim reference.' });
      }
      seenRefs.add(ref);

      if (!GST_CODES.includes(line.gstCode || 'P2')) {
        errors.push({ claimReference: ref, field: 'GSTCode', message: 'GSTCode must be P1 or P2.' });
      }

      const claimType = line.claimType || 'STANDARD';
      if (!CLAIM_TYPES.includes(claimType)) {
        errors.push({ claimReference: ref, field: 'ClaimType', message: 'ClaimType must be STANDARD, CANCELLATION or REPORT.' });
      }

      const reason = String(line.cancellationReason || '').trim();
      if (claimType === 'CANCELLATION') {
        if (!CANCELLATION_REASONS.includes(reason)) {
          errors.push({ claimReference: ref, field: 'CancellationReason', message: 'CancellationReason must be NSCC or NSDH for a CANCELLATION claim.' });
        }
      } else if (reason) {
        errors.push({ claimReference: ref, field: 'CancellationReason', message: 'CancellationReason is only allowed for CANCELLATION claims.' });
      }

      // Quantity and Hours are mutually exclusive: exactly one must be present.
      const hasQty = Number(line.quantity) > 0;
      const hasHours = Number(line.hours) > 0;
      if (hasQty && hasHours) {
        errors.push({ claimReference: ref, field: 'Quantity/Hours', message: 'Quantity and Hours are mutually exclusive.' });
      } else if (!hasQty && !hasHours) {
        errors.push({ claimReference: ref, field: 'Quantity/Hours', message: 'Provide either Quantity or Hours.' });
      }

      if (line.participantApproved && !['Y', 'N'].includes(line.participantApproved)) {
        errors.push({ claimReference: ref, field: 'ParticipantApproved', message: 'ParticipantApproved must be Y or N.' });
      }

      // Price cap check — tolerant when the catalog is unavailable.
      if (line.supportNumber && line.unitPrice >= 0) {
        try {
          const result = await priceValidationService.validatePrice(
            line.supportNumber,
            line.unitPrice,
          );
          if (result && result.isValid === false) {
            errors.push({ claimReference: ref, field: 'UnitPrice', message: result.message || 'Unit price exceeds the NDIS cap.' });
          }
        } catch (_) {
          warnings.push({ claimReference: ref, message: 'Price cap not verified (catalog unavailable).' });
        }
      }
    }

    return { errors, warnings };
  }

  /**
   * Build the 16-column BPR CSV (UTF-8, YYYY/MM/DD), exactly per the myplace
   * 2026-27 template.
   */
  buildCsv(lines, { registrationNumber, abn }) {
    const rows = [BPR_HEADERS.join(',')];
    for (const line of lines) {
      const date = formatNdisDate(line.serviceDate);
      const hourly = line.isHourly !== undefined ? line.isHourly : Number(line.hours) > 0;
      rows.push(
        [
          registrationNumber,
          line.ndisNumber,
          date,
          date,
          line.supportNumber,
          line.claimReference,
          hourly ? '' : round2(line.quantity).toFixed(2),
          hourly ? round2(line.hours).toFixed(2) : '',
          round2(line.unitPrice).toFixed(2),
          line.gstCode || 'P2',
          line.authorisedBy || '',
          line.participantApproved || 'Y',
          line.inKindFundingProgramCode || '',
          line.claimType || 'STANDARD',
          line.cancellationReason || '',
          abn,
        ]
          .map(csvEscape)
          .join(','),
      );
    }
    return rows.join('\r\n');
  }

  async listBatches(organizationId) {
    return ClaimBatch.find({ organizationId }).sort({ createdAt: -1 });
  }

  async getBatch(organizationId, batchId) {
    const batch = await ClaimBatch.findOne({ _id: batchId, organizationId });
    if (!batch) return null;
    const lines = await ClaimLine.find({ batchId: batch._id, organizationId });
    return { batch, lines };
  }

  _objectIdOrNull(value) {
    const mongoose = require('mongoose');
    return mongoose.Types.ObjectId.isValid(value) ? value : null;
  }
}

module.exports = new NDISClaimService();
module.exports.formatNdisDate = formatNdisDate;
module.exports.isValidAbn = isValidAbn;
module.exports.isHourlyUnit = isHourlyUnit;
module.exports.BPR_HEADERS = BPR_HEADERS;
