const UserOrganization = require('../models/UserOrganization');
const Invoice = require('../models/Invoice');
const Client = require('../models/Client');

class MultiOrgService {
  async getRollupStats(userEmail) {
    try {
      // 1. Find all organizations for this user
      const userOrgs = await UserOrganization.find({
        email: userEmail,
        status: 'active'
      }).lean();

      const stats = [];

      for (const org of userOrgs) {
        const orgId = org.organizationId;
        
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
          organizationName: org.organizationName || orgId,
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
