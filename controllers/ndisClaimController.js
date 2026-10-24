const catchAsync = require('../utils/catchAsync');
const ndisClaimService = require('../services/ndisClaimService');
const ndisClaimResultsService = require('../services/ndisClaimResultsService');
const cancellationBillingService = require('../services/cancellationBillingService');
const providerTravelService = require('../services/providerTravelService');

/**
 * NDIS claiming API (Phase 6). Org-scoped.
 */
class NDISClaimController {
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

  generateBatch = catchAsync(async (req, res) => {
    const org = this._requireOrg(req, res);
    if (!org) return;
    try {
      const result = await ndisClaimService.generateBatch(
        org,
        {
          from: req.body.from,
          to: req.body.to,
          allowInvalid: req.body.allowInvalid === true,
        },
        this._actor(req),
      );
      res.status(201).json({
        success: true,
        message: `Generated ${result.lineCount} claim line(s).`,
        data: {
          batch: result.batch,
          csv: result.csv,
          validation: result.validation,
        },
      });
    } catch (error) {
      const code = error.statusCode || 500;
      return res.status(code).json({
        success: false,
        code: error.code || 'CLAIM_GENERATION_FAILED',
        message: error.message,
        data: error.validation ? { validation: error.validation } : undefined,
      });
    }
  });

  listBatches = catchAsync(async (req, res) => {
    const org = this._requireOrg(req, res);
    if (!org) return;
    const batches = await ndisClaimService.listBatches(org);
    res.json({ success: true, data: { batches } });
  });

  getBatch = catchAsync(async (req, res) => {
    const org = this._requireOrg(req, res);
    if (!org) return;
    const result = await ndisClaimService.getBatch(org, req.params.id);
    if (!result) {
      return res.status(404).json({ success: false, code: 'NOT_FOUND', message: 'Claim batch not found.' });
    }
    res.json({ success: true, data: result });
  });

  createProviderTravelCharge = catchAsync(async (req, res) => {
    const org = this._requireOrg(req, res);
    if (!org) return;
    try {
      const result = await providerTravelService.createTravelCharge(
        org,
        {
          shiftId: req.body.shiftId,
          minutes: req.body.minutes,
          km: req.body.km,
          labourSupportNumber: req.body.labourSupportNumber,
          labourSupportName: req.body.labourSupportName,
          labourUnitPrice: req.body.labourUnitPrice,
          nonLabourSupportNumber: req.body.nonLabourSupportNumber,
          nonLabourSupportName: req.body.nonLabourSupportName,
          kmUnitPrice: req.body.kmUnitPrice,
        },
        this._actor(req),
      );
      if (result.notFound) {
        return res.status(404).json({
          success: false,
          code: 'NOT_FOUND',
          message: 'Shift not found.',
        });
      }
      if (result.clientNotFound) {
        return res.status(404).json({
          success: false,
          code: 'CLIENT_NOT_FOUND',
          message: 'Participant not found for this shift.',
        });
      }
      if (result.invalidState) {
        return res.status(409).json({
          success: false,
          code: 'INVALID_STATE',
          message: `Shift is ${result.status}; provider travel cannot be billed.`,
        });
      }
      res.status(201).json({
        success: true,
        message: 'Provider travel invoiced.',
        data: result,
      });
    } catch (error) {
      return res.status(error.statusCode || 500).json({
        success: false,
        code: error.code || 'PROVIDER_TRAVEL_BILLING_FAILED',
        message: error.message,
        data: error.details || undefined,
      });
    }
  });

  createCancellationCharge = catchAsync(async (req, res) => {
    const org = this._requireOrg(req, res);
    if (!org) return;
    try {
      const result = await cancellationBillingService.createCancellationCharge(
        org,
        {
          shiftId: req.body.shiftId,
          reason: req.body.reason,
          cancelledAt: req.body.cancelledAt,
          noticeHours: req.body.noticeHours,
          unitPrice: req.body.unitPrice,
          supportNumber: req.body.supportNumber,
        },
        this._actor(req),
      );
      if (result.notFound) {
        return res.status(404).json({
          success: false,
          code: 'NOT_FOUND',
          message: 'Shift not found.',
        });
      }
      if (result.clientNotFound) {
        return res.status(404).json({
          success: false,
          code: 'CLIENT_NOT_FOUND',
          message: 'Participant not found for this shift.',
        });
      }
      if (result.invalidState) {
        return res.status(409).json({
          success: false,
          code: 'INVALID_STATE',
          message: `Shift is ${result.status}; it cannot be cancelled.`,
        });
      }
      if (result.alreadyBilled) {
        return res.status(409).json({
          success: false,
          code: 'ALREADY_BILLED',
          message: 'This cancellation has already been billed.',
          data: { invoiceId: result.invoiceId },
        });
      }
      if (result.billable === false) {
        return res.json({
          success: true,
          message:
            'Shift cancelled. The notice period is outside the short-notice window, so no fee was raised.',
          data: result,
        });
      }
      res.status(201).json({
        success: true,
        message: 'Cancellation fee invoiced.',
        data: result,
      });
    } catch (error) {
      return res.status(error.statusCode || 500).json({
        success: false,
        code: error.code || 'CANCELLATION_BILLING_FAILED',
        message: error.message,
        data: error.details || undefined,
      });
    }
  });

  submitBatch = catchAsync(async (req, res) => {    const org = this._requireOrg(req, res);
    if (!org) return;
    const result = await ndisClaimService.submitBatch(
      org,
      req.params.id,
      {
        portalReference: req.body.portalReference,
        submittedAt: req.body.submittedAt,
      },
      this._actor(req),
    );
    if (result.notFound) {
      return res.status(404).json({ success: false, code: 'NOT_FOUND', message: 'Claim batch not found.' });
    }
    if (result.invalidState) {
      return res.status(409).json({
        success: false,
        code: 'INVALID_STATE',
        message: `Claim batch is ${result.status}; it cannot be submitted.`,
        data: { status: result.status },
      });
    }
    res.json({ success: true, message: 'Claim batch marked submitted.', data: { batch: result.batch } });
  });

  recordRemittance = catchAsync(async (req, res) => {
    const org = this._requireOrg(req, res);
    if (!org) return;
    const result = await ndisClaimService.recordRemittance(
      org,
      req.params.id,
      {
        paidAmount: req.body.paidAmount,
        paidAt: req.body.paidAt,
        reference: req.body.reference,
        notes: req.body.notes,
      },
      this._actor(req),
    );
    if (result.notFound) {
      return res.status(404).json({ success: false, code: 'NOT_FOUND', message: 'Claim batch not found.' });
    }
    if (result.invalidState) {
      return res.status(409).json({
        success: false,
        code: 'INVALID_STATE',
        message: `Claim batch is ${result.status}; remittance cannot be recorded.`,
        data: { status: result.status },
      });
    }
    res.json({
      success: true,
      message: 'Remittance recorded.',
      data: { batch: result.batch, outstanding: result.outstanding },
    });
  });

  resubmitRejected = catchAsync(async (req, res) => {
    const org = this._requireOrg(req, res);
    if (!org) return;
    try {
      const result = await ndisClaimService.resubmitRejected(
        org,
        req.params.id,
        this._actor(req),
      );
      if (result.notFound) {
        return res.status(404).json({ success: false, code: 'NOT_FOUND', message: 'Claim batch not found.' });
      }
      if (result.alreadyResubmitted) {
        return res.status(409).json({
          success: false,
          code: 'ALREADY_RESUBMITTED',
          message: 'This batch already has a resubmission batch.',
          data: { batchId: result.batchId },
        });
      }
      if (result.noRejected) {
        return res.status(409).json({
          success: false,
          code: 'NO_REJECTED_LINES',
          message: 'This batch has no rejected lines to resubmit.',
        });
      }
      res.status(201).json({
        success: true,
        message: `Resubmitted ${result.lineCount} rejected line(s).`,
        data: { batch: result.batch, csv: result.csv, validation: result.validation },
      });
    } catch (error) {
      return res.status(error.statusCode || 500).json({
        success: false,
        code: error.code || 'CLAIM_RESUBMISSION_FAILED',
        message: error.message,
        data: error.validation ? { validation: error.validation } : undefined,
      });
    }
  });

  importResults = catchAsync(async (req, res) => {    const org = this._requireOrg(req, res);
    if (!org) return;
    const content = req.body.file ?? req.body.content;
    if (!content) {
      return res.status(400).json({
        success: false,
        code: 'VALIDATION_ERROR',
        message: 'Results file content is required (file or content).',
      });
    }
    const result = await ndisClaimResultsService.importResults(
      org,
      req.params.id,
      content,
      this._actor(req),
    );
    if (result.notFound) {
      return res.status(404).json({ success: false, code: 'NOT_FOUND', message: 'Claim batch not found.' });
    }
    res.json({
      success: true,
      message: 'Results imported.',
      data: { batch: result.batch, summary: result.summary },
    });
  });
}

module.exports = new NDISClaimController();
