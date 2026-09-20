// Mock dependencies must be at the very top before any requires
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
const mockStartWorkflow = jest.fn().mockResolvedValue({ workflowId: 'test-wf-id' });
jest.mock('../../core/TemporalManager', () => ({
  startWorkflow: mockStartWorkflow
}));


// Now require the modules
const EventBus = require('../../core/EventBus');
const ShiftSubscriber = require('../../subscribers/ShiftSubscriber');
const QueueManager = require('../../core/QueueManager');

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

    // The subscriber is a thin adapter: DB work moved into the
    // ShiftLifecycleWorkflow activities (unit-tested separately), so no
    // direct collection access happens here anymore.
    const { getDatabase } = require('../../config/database');
    const db = await getDatabase();
    expect(db.collection).not.toHaveBeenCalledWith('workedTime');

    // Verify saga dispatch: stable idempotent ID, duplicate protection,
    // env-aware queue (never hardcoded 'default').
    const TemporalManager = require('../../core/TemporalManager');
    expect(TemporalManager.startWorkflow).toHaveBeenCalledWith(
      'ShiftLifecycleWorkflow',
      expect.objectContaining({
        workflowId: 'shift-lifecycle-shift-123',
        workflowIdReusePolicy: 'WORKFLOW_ID_REUSE_POLICY_REJECT_DUPLICATE',
        args: [expect.objectContaining({ shift: expect.objectContaining({ id: 'shift-123' }) })],
      })
    );
    const [, opts] = mockStartWorkflow.mock.calls[0];
    expect(opts).not.toHaveProperty('taskQueue', 'default');
  });
});
