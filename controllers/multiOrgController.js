const multiOrgService = require('../services/multiOrgService');
const { catchAsync } = require('../utils/errorHandler');

exports.getRollup = catchAsync(async (req, res) => {
  const userEmail = req.user.email;
  const data = await multiOrgService.getRollupStats(userEmail);
  res.status(200).json({ success: true, data });
});
