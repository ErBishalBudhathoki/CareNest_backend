const workerService = require('../services/workerService');
const complianceService = require('../services/complianceService');
const multiOrgService = require('../services/multiOrgService');
const Shift = require('../models/Shift');
const ActiveTimer = require('../models/ActiveTimer');
const Expense = require('../models/Expense');
const LeaveBalance = require('../models/LeaveBalance');
const EmployeeDocument = require('../models/EmployeeDocument');
const UserOrganization = require('../models/UserOrganization');
const Invoice = require('../models/Invoice');
const Client = require('../models/Client');

// Mock Mongoose Models
jest.mock('../models/Shift');
jest.mock('../models/ActiveTimer');
jest.mock('../models/Expense');
jest.mock('../models/LeaveBalance');
jest.mock('../models/EmployeeDocument');
jest.mock('../models/UserOrganization');
jest.mock('../models/Invoice');
jest.mock('../models/Client');
jest.mock('../models/User'); // Added User mock

describe('Persona Services Tests', () => {
  const mockOrgId = 'org-123';
  const mockUserEmail = 'worker@test.com';

  // Import User model
  const User = require('../models/User');

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Setup User mock
    User.findOne.mockResolvedValue({
      _id: 'user-123',
      email: mockUserEmail,
      toString: () => 'user-123'
    });
  });

  describe('WorkerService', () => {
    it('should return dashboard data', async () => {
      // Mock Data
      ActiveTimer.findOne.mockReturnValue({ lean: jest.fn().mockResolvedValue({ startTime: new Date() }) });
      Shift.find.mockReturnValue({ sort: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([{ id: 'shift1' }]) }) });
      Shift.findOne.mockReturnValue({ sort: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue({ id: 'nextShift' }) }) });
      Expense.find.mockReturnValue({ sort: jest.fn().mockReturnValue({ limit: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([]) }) }) });
      LeaveBalance.find.mockReturnValue({ lean: jest.fn().mockResolvedValue([]) });

      const data = await workerService.getDashboardData(mockUserEmail, mockOrgId);

      expect(data).toHaveProperty('activeTimer');
      expect(data).toHaveProperty('todayShifts');
      expect(data.todayShifts).toHaveLength(1);
      expect(ActiveTimer.findOne).toHaveBeenCalledWith(expect.objectContaining({ userEmail: mockUserEmail }));
    });
  });

  describe('ComplianceService', () => {
    it('should return compliance summary', async () => {
      EmployeeDocument.find.mockReturnValue({ lean: jest.fn().mockResolvedValue([]) });

      const data = await complianceService.getComplianceSummary(mockOrgId);

      expect(data).toHaveProperty('complianceScore');
      expect(data).toHaveProperty('expiringDocs');
      expect(EmployeeDocument.find).toHaveBeenCalledTimes(2); // Expiring and Expired
    });
  });

  describe('MultiOrgService', () => {
    it('should return rollup stats', async () => {
      // Setup chainable mock for populate().lean()
      const mockChain = {
        populate: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue([
            { organizationId: { _id: 'org1', name: 'Org 1' }, role: 'admin' },
            { organizationId: { _id: 'org2', name: 'Org 2' }, role: 'user' }
          ])
        })
      };
      
      UserOrganization.find.mockReturnValue(mockChain);

      Invoice.countDocuments = jest.fn().mockResolvedValue(10);
      Client.countDocuments = jest.fn().mockResolvedValue(5);
      Invoice.aggregate = jest.fn().mockResolvedValue([{ total: 1000 }]);

      const stats = await multiOrgService.getRollupStats(mockUserEmail);

      expect(stats).toHaveLength(2);
      expect(stats[0]).toHaveProperty('invoiceCount', 10);
      expect(stats[0]).toHaveProperty('revenue', 1000);
    });
  });
});
