const ActiveTimerController = require('../controllers/activeTimerController');
// Remove top-level messaging require to avoid hoisting issues with mocks
// const { messaging } = require('../firebase-admin-config'); 
const logger = require('../config/logger');

// Mock Models
const ActiveTimer = require('../models/ActiveTimer');
const WorkedTime = require('../models/WorkedTime');
const User = require('../models/User');
const FcmToken = require('../models/FcmToken');

// Mock catchAsync to allow awaiting in tests
jest.mock('../utils/catchAsync', () => (fn) => (req, res, next) => {
  return Promise.resolve(fn(req, res, next)).catch(next);
});

jest.mock('../models/ActiveTimer');
jest.mock('../models/WorkedTime');
jest.mock('../models/User');
jest.mock('../models/FcmToken');
// Manual mock for firebase-admin-config
jest.mock('../firebase-admin-config', () => ({
  messaging: {
    sendEachForMulticast: jest.fn(),
    send: jest.fn()
  }
}));
jest.mock('../config/logger');

describe('Active Timers Endpoints', () => {
  let req, res, next;
  let mockQuery;
  let messaging; // Define messaging here

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Require messaging inside beforeEach to get the mocked version
    messaging = require('../firebase-admin-config').messaging;

    req = { body: {}, params: {} };
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn()
    };
    next = jest.fn(); // Mock next function
    
    // Helper to mock chainable mongoose queries
    mockQuery = (result) => ({
      lean: jest.fn().mockResolvedValue(result),
      select: jest.fn().mockReturnThis(),
      sort: jest.fn().mockReturnThis(),
      then: (resolve) => Promise.resolve(result).then(resolve),
      catch: (reject) => Promise.resolve(result).catch(reject)
    });

    // Default mocks for Mongoose models
    ActiveTimer.find.mockImplementation(() => mockQuery([]));
    ActiveTimer.findOne.mockImplementation(() => mockQuery(null));
    
    // Ensure findOneAndDelete is mocked
    ActiveTimer.findOneAndDelete = jest.fn().mockImplementation(() => mockQuery(null));
    
    ActiveTimer.create.mockImplementation((data) => Promise.resolve({ ...data, _id: 'newId' }));

    User.find.mockImplementation(() => mockQuery([]));
    User.findOne.mockImplementation(() => mockQuery(null));

    FcmToken.find.mockImplementation(() => mockQuery([]));
    FcmToken.deleteMany.mockResolvedValue({ deletedCount: 0 });

    WorkedTime.create.mockResolvedValue({});
  });

  describe('startTimer', () => {
    it('should return 400 if required fields are missing', async () => {
      req.body = { userEmail: 'test@example.com' }; // Missing clientEmail
      await ActiveTimerController.startTimer(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
    });

    it('should return 409 if user already has an active timer', async () => {
      req.body = { userEmail: 'test@example.com', clientEmail: 'client@example.com', organizationId: 'org1' };
      
      const mockTimer = { _id: 'timer1' };
      ActiveTimer.findOne.mockImplementation(() => mockQuery(mockTimer));

      await ActiveTimerController.startTimer(req, res);
      expect(res.status).toHaveBeenCalledWith(409);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
    });

    it('should start timer and notify user and admins successfully', async () => {
      req.body = { userEmail: 'test@example.com', clientEmail: 'client@example.com', organizationId: 'org1' };
      // ActiveTimer.findOne returns null (no active timer)
      
      const newTimer = { _id: 'newTimerId', ...req.body };
      ActiveTimer.create.mockResolvedValue(newTimer);

      // Mock User FCM token lookup
      User.findOne.mockImplementation(() => mockQuery({ fcmToken: 'userToken' }));
      
      // Mock Admin lookup
      // Implementation uses: User.find({...}).select(...).lean()
      const adminUsers = [{ email: 'admin@example.com', fcmToken: 'adminToken' }];
      User.find.mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue(adminUsers)
        })
      });

      messaging.sendEachForMulticast.mockResolvedValue({ successCount: 1, failureCount: 0 });

      await ActiveTimerController.startTimer(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true, timerId: 'newTimerId' }));
      expect(ActiveTimer.create).toHaveBeenCalled();
      expect(messaging.sendEachForMulticast).toHaveBeenCalled();
    });

    it('should handle notification errors gracefully when starting timer', async () => {
      req.body = { userEmail: 'test@example.com', clientEmail: 'client@example.com', organizationId: 'org1' };
      ActiveTimer.create.mockResolvedValue({ _id: 'newTimerId', ...req.body });

      User.findOne.mockImplementation(() => mockQuery({ fcmToken: 'userToken' }));
      
      const adminUsers = [{ email: 'admin@example.com', fcmToken: 'adminToken' }];
      User.find.mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue(adminUsers)
        })
      });

      messaging.sendEachForMulticast
        .mockRejectedValueOnce(new Error('FCM Error'))
        .mockRejectedValueOnce(new Error('Multicast Error'));

      await ActiveTimerController.startTimer(req, res);

      expect(logger.error).toHaveBeenCalledWith('Failed to notify employee', expect.anything());
      // Should still return success for timer start
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('should return 500 on database error', async () => {
      req.body = { userEmail: 'test@example.com', clientEmail: 'client@example.com', organizationId: 'org1' };
      ActiveTimer.findOne.mockImplementation(() => { throw new Error('DB Connection Failed'); });

      await ActiveTimerController.startTimer(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.any(Error));
    });
  });

  describe('stopTimer', () => {
    it('should return 400 if required fields are missing', async () => {
      req.body = { userEmail: 'test@example.com' };
      await ActiveTimerController.stopTimer(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('should return 404 if no active timer found', async () => {
      req.body = { userEmail: 'test@example.com', organizationId: 'org1' };
      // findOneAndDelete defaults to null in beforeEach
      
      await ActiveTimerController.stopTimer(req, res);
      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('should stop timer, record worked time, and notify successfully', async () => {
      req.body = { userEmail: 'test@example.com', organizationId: 'org1' };
      const startTime = new Date(Date.now() - 3600000); // 1 hour ago
      const timerDoc = { 
        userEmail: 'test@example.com', 
        clientEmail: 'client@example.com', 
        startTime: startTime 
      };
      
      ActiveTimer.findOneAndDelete.mockImplementation(() => mockQuery(timerDoc));

      User.findOne.mockImplementation(() => mockQuery({ fcmToken: 'userToken' }));
      
      const adminUsers = [{ email: 'admin@example.com', fcmToken: 'adminToken' }];
      User.find.mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue(adminUsers)
        })
      });

      messaging.sendEachForMulticast.mockResolvedValue({ successCount: 1, failureCount: 0 });

      await ActiveTimerController.stopTimer(req, res);

      expect(WorkedTime.create).toHaveBeenCalledWith(expect.objectContaining({
        userEmail: 'test@example.com',
        totalSeconds: expect.closeTo(3600, -5) // Approx 3600 seconds
      }));
      expect(res.status).toHaveBeenCalledWith(200);
      expect(messaging.sendEachForMulticast).toHaveBeenCalled();
    });
  });

  describe('getActiveTimers', () => {
    it('should return active timers for organization', async () => {
      req.params = { organizationId: 'org1' };
      const mockTimers = [{ userEmail: 'user1' }, { userEmail: 'user2' }];
      
      ActiveTimer.find.mockReturnValue({
        lean: jest.fn().mockResolvedValue(mockTimers)
      });

      await ActiveTimerController.getActiveTimers(req, res);

      expect(ActiveTimer.find).toHaveBeenCalledWith({ organizationId: 'org1' });
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ 
        success: true, 
        activeTimers: mockTimers, 
        count: 2 
      }));
    });

    it('should return 500 on database error', async () => {
      req.params = { organizationId: 'org1' };
      ActiveTimer.find.mockImplementation(() => { throw new Error('DB Error'); });

      await ActiveTimerController.getActiveTimers(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.any(Error));
    });
  });
});
