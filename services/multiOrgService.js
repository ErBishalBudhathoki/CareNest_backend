const UserOrganization = require('../models/UserOrganization');
const User = require('../models/User');
const Invoice = require('../models/Invoice');
const Client = require('../models/Client');

class MultiOrgService {
  async getRollupStats(userEmail) {
    try {
      // 1. Find user by email
      const user = await User.findOne({ email: userEmail });
      if (!user) {
        throw new Error('User not found');
      }

      // 2. Find all organizations for this user (using userId)
      const userOrgs = await UserOrganization.find({
        userId: user._id.toString(),
        isActive: true
      }).populate('organizationId', 'name').lean();

      if (!userOrgs || userOrgs.length === 0) {
        return [];
      }

      const stats = [];

      for (const userOrg of userOrgs) {
        const orgId = userOrg.organizationId._id || userOrg.organizationId;
        const orgName = userOrg.organizationId.name || 'Unknown Organization';
        
        // Parallel fetch for this org
        const [invoiceCount, clientCount, totalRevenue] = await Promise.all([
          Invoice.countDocuments({ organizationId: orgId }),
          Client.countDocuments({ organizationId: orgId }),
          Invoice.aggregate([
             { $match: { organizationId: orgId, status: 'paid' } },
             { $group: { _id: null, total: { $sum: '$totalAmount' } } }
          ])
        ]);

        stats.push({
          organizationId: orgId,
          organizationName: orgName,
          userRole: userOrg.role,
          invoiceCount,
          clientCount,
          revenue: totalRevenue.length > 0 ? totalRevenue[0].total : 0
        });
      }

      return stats;
    } catch (error) {
      throw new Error(`Error fetching multi-org stats: ${error.message}`);
    }
  }
}

module.exports = new MultiOrgService();
