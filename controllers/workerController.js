const workerService = require('../services/workerService');
const { catchAsync } = require('../utils/errorHandler');

exports.getDashboard = catchAsync(async (req, res) => {
  // Use organizationId from params or header
  const orgId = req.params.organizationId || req.headers['x-organization-id'];
  
  // Use email from authenticated user
  const userEmail = req.user.email;
  
  if (!orgId) {
      return res.status(400).json({
          success: false,
          message: 'Organization ID is required'
      });
  }

  const data = await workerService.getDashboardData(userEmail, orgId);

  res.status(200).json({
    success: true,
    data
  });
});
