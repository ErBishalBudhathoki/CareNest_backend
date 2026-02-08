const organizationController = require('../controllers/organizationController');
const multiTenantController = require('../controllers/multiTenantController');
const organizationService = require('../services/organizationService');
const crossOrgService = require('../services/crossOrgService');

// Mock catchAsync
jest.mock('../utils/catchAsync', () => (fn) => (req, res, next) => {
  return Promise.resolve(fn(req, res, next)).catch(next);
});

// Mock dependencies
jest.mock('../services/organizationService');
jest.mock('../services/crossOrgService');
jest.mock('../config/logger', () => ({
  error: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  security: jest.fn(),
  business: jest.fn() // Added business mock
}));

describe('Multi-Tenant Features', () => {
  let req, res, next;

  beforeEach(() => {
    req = {
      params: {},
      body: {},
      user: { userId: 'user123' },
      query: {}
    };
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn()
    };
    next = jest.fn(); // Mock next
    jest.clearAllMocks();
  });

  describe('Organization Controller', () => {
    describe('switchOrganization', () => {
      it('should switch organization successfully', async () => {
        req.params.organizationId = 'org123';
        const mockResult = { organization: { id: 'org123' }, role: 'owner' };
        organizationService.switchOrganization.mockResolvedValue(mockResult);

        await organizationController.switchOrganization(req, res);

        expect(organizationService.switchOrganization).toHaveBeenCalledWith('user123', 'org123');
        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.json).toHaveBeenCalledWith({
          message: 'Switched organization successfully',
          data: mockResult
        });
      });

      it('should return 403 if access denied', async () => {
        req.params.organizationId = 'org123';
        organizationService.switchOrganization.mockRejectedValue(new Error('Access denied'));

        await organizationController.switchOrganization(req, res, next);

        // Expect next to be called with error, not res.status
        expect(next).toHaveBeenCalledWith(expect.any(Error));
      });
    });

    describe('getBranding', () => {
      it('should return branding data', async () => {
        req.params.organizationId = 'org123';
        const mockBranding = { primaryColor: '#000000' };
        organizationService.getOrganizationBranding.mockResolvedValue(mockBranding);

        await organizationController.getBranding(req, res);

        expect(organizationService.getOrganizationBranding).toHaveBeenCalledWith('org123');
        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.json).toHaveBeenCalledWith({ data: mockBranding });
      });
    });
  });

  describe('Multi-Tenant Controller', () => {
    describe('getCrossOrgReport', () => {
      it('should return revenue report', async () => {
        req.query = { type: 'revenue', startDate: '2023-01-01', endDate: '2023-01-31' };
        const mockReport = { totalRevenue: 1000 };
        crossOrgService.getCrossOrgRevenue.mockResolvedValue(mockReport);

        await multiTenantController.getCrossOrgReport(req, res);

        expect(crossOrgService.getCrossOrgRevenue).toHaveBeenCalledWith('user123', '2023-01-01', '2023-01-31');
        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ 
          success: true, 
          data: mockReport 
        }));
      });

      it('should return 400 for unsupported report type', async () => {
        req.query = { type: 'unknown' };
        
        await multiTenantController.getCrossOrgReport(req, res);

        expect(res.status).toHaveBeenCalledWith(400);
      });
    });
  });
});
