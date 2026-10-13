const ClaimBatch = require('../models/ClaimBatch');
const ClaimLine = require('../models/ClaimLine');
const logger = require('../config/logger');

/**
 * Bulk Payment Results File (BPRF) import + reconciliation (Phase 6).
 * See docs/NDIS_DEPTH_ROADMAP.md section 5.
 *
 * The BPRF column layout varies; the parser is deliberately tolerant — it
 * locates the claim-reference column and a status/reason column by header name
 * (case-insensitive) and falls back to positional parsing.
 */

/** Minimal RFC-4180 CSV row splitter. */
function splitCsvRow(row) {
  const fields = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < row.length; i += 1) {
    const char = row[i];
    if (inQuotes) {
      if (char === '"') {
        if (row[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      fields.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  fields.push(current);
  return fields.map((f) => f.trim());
}

function normalizeStatus(raw) {
  const value = String(raw || '').trim().toLowerCase();
  if (!value) return 'accepted';
  if (['accepted', 'approved', 'paid', 'success', 'ok', 'processed'].includes(value)) {
    return 'accepted';
  }
  if (['rejected', 'declined', 'failed', 'error', 'invalid'].includes(value)) {
    return 'rejected';
  }
  return 'accepted';
}

class NDISClaimResultsService {
  /**
   * Import a BPRF and update claim lines.
   * @param {string} organizationId
   * @param {string} batchId
   * @param {string} fileContent - raw CSV (or base64 CSV)
   */
  async importResults(organizationId, batchId, fileContent) {
    const batch = await ClaimBatch.findOne({ _id: batchId, organizationId });
    if (!batch) return { notFound: true };

    const csv = this._decode(fileContent);
    const rows = csv
      .split(/\r?\n/)
      .map((r) => r.trim())
      .filter((r) => r.length > 0);

    if (rows.length === 0) {
      return { batch, results: [], summary: { accepted: 0, rejected: 0, unmatched: 0 } };
    }

    const header = splitCsvRow(rows[0]).map((h) => h.toLowerCase());
    const refIndex = this._findColumn(header, ['claimreference', 'claim reference', 'reference']);
    const statusIndex = this._findColumn(header, ['status', 'result', 'outcome']);
    const reasonIndex = this._findColumn(header, ['reason', 'error', 'message', 'rejectionreason']);
    const hasHeader = refIndex !== -1;

    const dataRows = hasHeader ? rows.slice(1) : rows;
    const refCol = hasHeader ? refIndex : 0;
    const statusCol = hasHeader ? statusIndex : 1;
    const reasonCol = hasHeader ? reasonIndex : 2;

    const summary = { accepted: 0, rejected: 0, unmatched: 0 };
    const results = [];

    for (const row of dataRows) {
      const fields = splitCsvRow(row);
      const claimReference = fields[refCol];
      if (!claimReference) continue;

      const status = normalizeStatus(statusCol >= 0 ? fields[statusCol] : 'accepted');
      const reason = reasonCol >= 0 ? fields[reasonCol] || '' : '';

      const line = await ClaimLine.findOne({ claimReference, organizationId });
      if (!line) {
        summary.unmatched += 1;
        results.push({ claimReference, status, matched: false });
        continue;
      }

      line.status = status === 'rejected' ? 'rejected' : 'reconciled';
      line.rejectionReason = status === 'rejected' ? reason : '';
      await line.save();

      if (status === 'rejected') summary.rejected += 1;
      else summary.accepted += 1;
      results.push({ claimReference, status, matched: true });
    }

    // Determine batch status.
    if (summary.rejected === 0 && summary.accepted > 0) {
      batch.status = 'reconciled';
    } else if (summary.accepted === 0 && summary.rejected > 0) {
      batch.status = 'failed';
    } else if (summary.rejected > 0 && summary.accepted > 0) {
      batch.status = 'partial';
    }
    batch.reconciledAt = new Date();
    await batch.save();

    logger.business('NDIS Claim Results Imported', {
      event: 'ndis_claim_results_imported',
      organizationId,
      batchId: String(batchId),
      ...summary,
    });

    return { batch, results, summary };
  }

  _findColumn(header, candidates) {
    for (let i = 0; i < header.length; i += 1) {
      const h = header[i].replace(/[^a-z]/g, '');
      if (candidates.some((c) => h === c.replace(/[^a-z]/g, ''))) return i;
    }
    return -1;
  }

  _decode(content) {
    if (typeof content !== 'string') return '';
    // Heuristic: base64 payloads have no commas/newlines early on.
    if (!content.includes(',') && !content.includes('\n') && /^[A-Za-z0-9+/=\s]+$/.test(content)) {
      try {
        return Buffer.from(content, 'base64').toString('utf8');
      } catch (_) {
        return content;
      }
    }
    return content;
  }
}

module.exports = new NDISClaimResultsService();
