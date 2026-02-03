const User = require('../models/User');
const Organization = require('../models/Organization');
const catchAsync = require('../utils/catchAsync');
const mongoose = require('mongoose');
const logger = require('../config/logger');

class InitController {
  /**
   * Get initial user data for dashboard
   * Replaces legacy /initData/:email endpoint
   */
  getInitData = catchAsync(async (req, res) => {
    const { email } = req.params;
    
    if (!email) {
      return res.status(400).json({
        success: false,
        code: 'VALIDATION_ERROR',
        message: 'Email is required'
      });
    }

    // Use lean() to retrieve plain JS object
    const user = await User.findOne({ email: email, isActive: true }).lean();

    if (!user) {
      return res.status(404).json({
        success: false,
        code: 'USER_NOT_FOUND',
        message: 'User not found'
      });
    }

    let organizationDetails = null;
    if (user.organizationId) {
      if (mongoose.Types.ObjectId.isValid(user.organizationId)) {
        organizationDetails = await Organization.findById(user.organizationId).lean();
      } else {
        logger.warn(`Invalid OrganizationObjectId for user ${email}: ${user.organizationId}`);
      }
    }

    logger.business('Retrieved initial user data', {
      action: 'init_data',
      email,
      organizationId: user.organizationId
    });

    // Replicate exact legacy response structure
    return res.status(200).json({
      success: true,
      code: 'INIT_DATA_RETRIEVED',
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      role: user.role,
      abn: user.abn || null,
      organizationId: user.organizationId,
      organizationName: user.organizationName || (organizationDetails ? organizationDetails.name : null),
      organization: organizationDetails ? {
        id: organizationDetails._id.toString(),
        name: organizationDetails.name,
        code: organizationDetails.code
      } : null,
      photoData: user.profilePic || null,
      permissions: user.roles || []
    });
  });
  /**
   * Legacy authentication check
   * GET /hello/:email
   * Note: This is a legacy endpoint used by the frontend for user lookup during login.
   */
  hello = catchAsync(async (req, res) => {
    const { email } = req.params;
    
    if (!email) {
      return res.status(400).json({ message: 'Email is required' });
    }

    const user = await User.findOne({ email: email }).lean();

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Security: Remove sensitive fields
    delete user.password;
    delete user.__v;

    // Return raw user object to match legacy frontend expectation
    return res.status(200).json(user);
  });
}

module.exports = new InitController();
