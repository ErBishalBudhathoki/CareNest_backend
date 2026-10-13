const catchAsync = require('../utils/catchAsync');
const ndisClaimService = require('../services/ndisClaimService');
const ndisClaimResultsService = require('../services/ndisClaimResultsService');

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

  importResults = catchAsync(async (req, res) => {
    const org = this._requireOrg(req, res);
    if (!org) return;
    const content = req.body.file ?? req.body.content;
    if (!content) {
      return res.status(400).json({
        success: false,
        code: 'VALIDATION_ERROR',
        message: 'Results file content is required (file or content).',
      });
    }
    const result = await ndisClaimResultsService.importResults(org, req.params.id, content);
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
