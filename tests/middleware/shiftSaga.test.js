/**
 * Shift saga tests: completion upserts WorkedTime, cancellation voids it
 * with an audit trail, and the subscriber dispatches durable workflows
 * (idempotent IDs) instead of doing inline DB work.
 */
const mockUpdateOne = jest.fn();
const mockDeleteMany = jest.fn();
const mockInsertOne = jest.fn();
const mockConnect = jest.fn();

jest.mock('mongodb', () => ({
  MongoClient: jest.fn().mockImplementation(() => ({
    connect: (...args) => mockConnect(...args),
    topology: { isConnected: () => true },
    db: jest.fn(() => ({
      collection: jest.fn((name) => {
        if (name === 'workedTime') {
          return { updateOne: mockUpdateOne, deleteMany: mockDeleteMany };
        }
        return { insertOne: mockInsertOne };
      }),
    })),
  })),
  ServerApiVersion: { v1: '1' },
}));

jest.mock('../../config/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
  security: jest.fn(),
}));

const mockStartWorkflow = jest.fn();
jest.mock('../../core/TemporalManager', () => ({
  startWorkflow: (...args) => mockStartWorkflow(...args),
  getTaskQueue: () => 'default-dev',
}));

const {
  upsertWorkedTimeActivity,
  voidShiftArtifactsActivity,
} = require('../../temporal/activities/shift');
const {
  ShiftLifecycleWorkflow,
  ShiftCancelWorkflow,
} = require('../../temporal/workflows/shift');
const workflowIndex = require('../../temporal/workflows/index');

const shift = {
  id: 'shift-1',
  employeeEmail: 'w@x.com',
  clientEmail: 'c@x.com',
  startTime: '2026-09-20T09:00:00Z',
  endTime: '2026-09-20T17:00:00Z',
  breakDuration: 30,
  organizationId: 'org-a',
};

describe('shift activities', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('upserts WorkedTime keyed by shiftId', async () => {
    mockUpdateOne.mockResolvedValue({ acknowledged: true });
    const result = await upsertWorkedTimeActivity({ shift });
    expect(mockUpdateOne).toHaveBeenCalledWith(
      { shiftId: 'shift-1' },
      { $set: expect.objectContaining({ shiftId: 'shift-1', status: 'verified' }) },
      { upsert: true },
    );
    expect(result).toEqual({ shiftId: 'shift-1', timeWorked: 7.5 });
  });

  test('voids WorkedTime and writes an audit trail', async () => {
    mockDeleteMany.mockResolvedValue({ deletedCount: 1 });
    mockInsertOne.mockResolvedValue({ acknowledged: true });
    const result = await voidShiftArtifactsActivity({
      shiftId: 'shift-1',
      organizationId: 'org-a',
    });
    expect(mockDeleteMany).toHaveBeenCalledWith({
      shiftId: 'shift-1',
      organizationId: 'org-a',
    });
    expect(mockInsertOne).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'SHIFT_CANCEL_COMPENSATION' }),
    );
    expect(result).toEqual({ shiftId: 'shift-1', voided: 1 });
  });
});

describe('shift workflows registration', () => {
  test('saga workflows are exported for the worker bundle', () => {
    expect(typeof ShiftLifecycleWorkflow).toBe('function');
    expect(typeof ShiftCancelWorkflow).toBe('function');
    expect(workflowIndex.ShiftLifecycleWorkflow).toBe(ShiftLifecycleWorkflow);
    expect(workflowIndex.ShiftCancelWorkflow).toBe(ShiftCancelWorkflow);
  });
});

describe('ShiftSubscriber adapter', () => {
  let subscriber;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.isolateModules(() => {
      // eslint-disable-next-line global-require
      subscriber = require('../../subscribers/ShiftSubscriber');
    });
    mockStartWorkflow.mockResolvedValue({ workflowId: 'x' });
  });

  test('dispatches lifecycle workflow with stable idempotent ID', async () => {
    await subscriber.handleShiftCompleted({ ...shift });
    expect(mockStartWorkflow).toHaveBeenCalledTimes(1);
    const [name, opts] = mockStartWorkflow.mock.calls[0];
    expect(name).toBe('ShiftLifecycleWorkflow');
    expect(opts.workflowId).toBe('shift-lifecycle-shift-1');
    expect(opts.workflowIdReusePolicy).toBe(
      'WORKFLOW_ID_REUSE_POLICY_REJECT_DUPLICATE',
    );
  });

  test('dispatches cancel compensation workflow', async () => {
    await subscriber.handleShiftCancelled({
      shiftId: 'shift-1',
      organizationId: 'org-a',
    });
    expect(mockStartWorkflow).toHaveBeenCalledTimes(1);
    const [name, opts] = mockStartWorkflow.mock.calls[0];
    expect(name).toBe('ShiftCancelWorkflow');
    expect(opts.workflowId).toBe('shift-cancel-shift-1');
    expect(opts.args).toEqual([{ shiftId: 'shift-1', organizationId: 'org-a' }]);
  });

  test('swallows duplicate-dispatch without throwing', async () => {
    mockStartWorkflow.mockRejectedValue(new Error('WorkflowExecutionAlreadyStarted'));
    await expect(
      subscriber.handleShiftCompleted({ ...shift }),
    ).resolves.toBeUndefined();
  });
});
