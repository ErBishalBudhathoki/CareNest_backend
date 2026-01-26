const complianceService = require('../services/complianceService');
const catchAsync = require('../utils/catchAsync');

exports.getSummary = catchAsync(async (req, res) => {
  const { organizationId } = req.params;
  const orgId = organizationId || req.headers['x-organization-id'];

  if (!orgId) {
    return res.status(400).json({ success: false, message: 'Organization ID required' });
  }

  const data = await complianceService.getComplianceSummary(orgId);

  res.status(200).json({
    success: true,
    data
  });
});
