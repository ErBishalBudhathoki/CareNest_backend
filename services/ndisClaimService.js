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
 * Only NDIA-managed claims are batched. There is no public NDIA API: this
 * produces a 16-column CSV the provider uploads to the myplace/PACE portal.
 */

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
  'ClaimType',
  'CancellationReason',
  'ABN',
  'InKindFundingProgram',
  'ClaimReason',
  'RequestedAmount',
];

/** Format a date as DD/MM/YYYY (Australian) — the portal rejects ISO 8601. */
function formatAuDate(value) {
  const d = value ? new Date(value) : new Date();
  const day = String(d.getUTCDate()).padStart(2, '0');
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${day}/${month}/${d.getUTCFullYear()}`;
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
          lines.push({
            clientId: invoice.clientId,
            invoiceId: invoice._id,
            ndisNumber: client?.ndisNumber || '',
            supportNumber: item.supportItemNumber || '',
            serviceDate: d,
            quantity: round2(item.quantity),
            hours: round2(item.quantity),
            unitPrice: round2(item.price),
            gstCode: 'P2',
            claimType: 'DIRECT_SERVICE',
            cancellationReason: '',
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

    const validation = await this.validateLines(lines);

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
  async validateLines(lines) {
    const errors = [];
    const warnings = [];
    const seenRefs = new Set();

    for (const line of lines) {
      const ref = line.claimReference;
      if (!line.ndisNumber) {
        errors.push({ claimReference: ref, field: 'NDISNumber', message: 'Missing participant NDIS number.' });
      }
      if (!line.supportNumber) {
        errors.push({ claimReference: ref, field: 'SupportNumber', message: 'Missing support item number.' });
      }
      if (seenRefs.has(ref)) {
        errors.push({ claimReference: ref, field: 'ClaimReference', message: 'Duplicate claim reference.' });
      }
      seenRefs.add(ref);

      const expected = round2((line.quantity || 0) * (line.unitPrice || 0));
      if (Math.abs(expected - round2(line.requestedAmount)) > 0.001) {
        errors.push({
          claimReference: ref,
          field: 'RequestedAmount',
          message: 'RequestedAmount does not equal Quantity × UnitPrice.',
        });
      }

      // Price cap check — tolerant when the catalog is unavailable.
      if (line.supportNumber && line.unitPrice >= 0) {
        try {
          const result = await priceValidationService.validatePrice(
            line.supportNumber,
            line.unitPrice,
          );
          if (result && result.isValid === false) {
            errors.push({
              claimReference: ref,
              field: 'UnitPrice',
              message: result.message || 'Unit price exceeds the NDIS cap.',
            });
          }
        } catch (_) {
          warnings.push({ claimReference: ref, message: 'Price cap not verified (catalog unavailable).' });
        }
      }
    }

    return { errors, warnings };
  }

  /** Build the 16-column BPR CSV (UTF-8, DD/MM/YYYY). */
  buildCsv(lines, { registrationNumber, abn }) {
    const rows = [BPR_HEADERS.join(',')];
    for (const line of lines) {
      const date = formatAuDate(line.serviceDate);
      rows.push(
        [
          registrationNumber,
          line.ndisNumber,
          date,
          date,
          line.supportNumber,
          line.claimReference,
          round2(line.quantity).toFixed(2),
          round2(line.hours).toFixed(2),
          round2(line.unitPrice).toFixed(2),
          line.gstCode || 'P2',
          line.claimType || 'DIRECT_SERVICE',
          line.cancellationReason || '',
          abn,
          '',
          '',
          round2(line.requestedAmount).toFixed(2),
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
module.exports.formatAuDate = formatAuDate;
module.exports.BPR_HEADERS = BPR_HEADERS;
