const EventBus = require('../../core/EventBus');
const ShiftSubscriber = require('../../subscribers/ShiftSubscriber');
const QueueManager = require('../../core/QueueManager');

// Mock dependencies
jest.mock('../../config/redis', () => {
  const Redis = require('ioredis-mock');
  const client = new Redis();
  client.isConfigured = true;
  client.status = 'ready';
  return client;
});
jest.mock('../../config/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn()
}));
jest.mock('../../config/database', () => ({
  getDatabase: jest.fn().mockResolvedValue({
    collection: jest.fn().mockReturnValue({
      updateOne: jest.fn().mockResolvedValue({ acknowledged: true })
    })
  })
}));
jest.mock('../../core/QueueManager', () => ({
  addJob: jest.fn().mockResolvedValue({ id: 'job-123' })
}));

describe('Integration: Shift Completion Flow', () => {
  beforeAll(() => {
    // Initialize subscriber
    ShiftSubscriber.subscribe();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  test('shift.completed event should trigger timesheet update and invoice job', async () => {
    const shiftData = {
      id: 'shift-123',
      employeeEmail: 'test@example.com',
      clientEmail: 'client@example.com',
      startTime: new Date().toISOString(),
      endTime: new Date().toISOString(),
      breakDuration: 30,
      organizationId: 'org-1'
    };

    // Publish event
    EventBus.publish('shift.completed', shiftData);

    // Wait for async handlers (EventBus emits synchronously for local, but handlers are async)
    // We need to wait a tick
    await new Promise(resolve => setTimeout(resolve, 100));

    // Verify DB update (Timesheet)
    const { getDatabase } = require('../../config/database');
    const db = await getDatabase();
    expect(db.collection).toHaveBeenCalledWith('workedTime');
    expect(db.collection('workedTime').updateOne).toHaveBeenCalled();

    // Verify Queue Job (Invoice)
    expect(QueueManager.addJob).toHaveBeenCalledWith(
      'invoice-generation', 
      'generate-preview', 
      expect.objectContaining({
        shiftId: 'shift-123',
        organizationId: 'org-1'
      })
    );
  });
});
