const UserOrganization = require('../models/UserOrganization');
const Invoice = require('../models/Invoice');

class CrossOrgService {
  async getCrossOrgRevenue(userId, startDate, endDate) {
    try {
      // 1. Get all organizations where user is owner or has cross_org_access
      const userOrgs = await UserOrganization.find({
        userId,
        isActive: true,
        $or: [
          { role: 'owner' },
          { permissions: 'cross_org_access' }
        ]
      }).populate('organizationId', 'name');

      if (!userOrgs.length) {
        return { totalRevenue: 0, organizationBreakdown: [] };
      }

      const orgIds = userOrgs.map(uo => uo.organizationId._id);

      // 2. Aggregate revenue across these organizations
      const revenueData = await Invoice.aggregate([
        {
          $match: {
            organizationId: { $in: orgIds },
            status: 'paid', // Only count paid invoices
            issueDate: { $gte: new Date(startDate), $lte: new Date(endDate) }
          }
        },
        {
          $group: {
            _id: '$organizationId',
            revenue: { $sum: '$totalAmount' }
          }
        }
      ]);

      // 3. Format result
      let totalRevenue = 0;
      const organizationBreakdown = userOrgs.map(uo => {
        const orgRevenue = revenueData.find(r => r._id.toString() === uo.organizationId._id.toString());
        const revenue = orgRevenue ? orgRevenue.revenue : 0;
        totalRevenue += revenue;
        
        return {
          orgId: uo.organizationId._id,
          orgName: uo.organizationId.name,
          revenue
        };
      });

      // Calculate percentages
      organizationBreakdown.forEach(org => {
        org.percentage = totalRevenue > 0 ? (org.revenue / totalRevenue) * 100 : 0;
      });

      return {
        totalRevenue,
        organizationBreakdown
      };
    } catch (error) {
      throw error;
    }
  }
}

module.exports = new CrossOrgService();
