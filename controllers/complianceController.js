const complianceService = require('../services/complianceService');
const catchAsync = require('../utils/catchAsync');

exports.getSummary = catchAsync(async (req, res) => {
  // Try to get organizationId from params, query, or user context
  const organizationId = req.params.organizationId || req.query.organizationId || req.user.organizationId;

  if (!organizationId) {
    return res.status(400).json({ success: false, message: 'Organization ID required' });
  }

  const data = await complianceService.getComplianceSummary(organizationId);

  res.status(200).json({
    success: true,
    data
  });
});
