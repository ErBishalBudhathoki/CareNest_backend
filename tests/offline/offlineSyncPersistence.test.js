/**
 * Milestone 7.1: Persistent Offline Sync Queue & Conflict Detection Unit Tests
 */

jest.mock('../../config/logger', () => ({
  warn: jest.fn(),
  error: jest.fn(),
  info: jest.fn(),
  business: jest.fn(),
}));

const mockQueueCreate = jest.fn();
const mockQueueFindOne = jest.fn();
const mockQueueUpdateOne = jest.fn();
jest.mock('../../models/OfflineSyncQueue', () => ({
  create: (...args) => mockQueueCreate(...args),
  findOne: (...args) => mockQueueFindOne(...args),
  updateOne: (...args) => mockQueueUpdateOne(...args),
}));

const mockWorkedTimeFindById = jest.fn();
jest.mock('../../models/WorkedTime', () => ({
  findById: (...args) => mockWorkedTimeFindById(...args),
}));

const offlineSyncService = require('../../services/offlineSyncService');

describe('Milestone 7.1: Persistent Offline Sync Queue & Conflict Detection', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Persistent Queue Operations', () => {
    it('persists queued offline data in OfflineSyncQueue collection', async () => {
      const queueDoc = {
        _id: 'q_doc_1',
        queueId: 'QUEUE-123456',
        organizationId: 'org_test',
        userId: 'worker_01',
        dataType: 'worked_time',
        action: 'create',
        status: 'queued',
      };
      mockQueueCreate.mockResolvedValue(queueDoc);

      const result = await offlineSyncService.queueOfflineData({
        organizationId: 'org_test',
        userId: 'worker_01',
        dataType: 'worked_time',
        action: 'create',
        payload: {
          clockIn: '2026-04-01T09:00:00Z',
          clockOut: '2026-04-01T17:00:00Z',
        },
      });

      expect(result.success).toBe(true);
      expect(result.data.queueId).toBe('QUEUE-123456');
      expect(mockQueueCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: 'org_test',
          userId: 'worker_01',
          dataType: 'worked_time',
          action: 'create',
          status: 'queued',
        })
      );
    });

    it('returns existing queue record on idempotent replay with same idempotencyKey', async () => {
      const existingQueueDoc = {
        _id: 'q_doc_2',
        queueId: 'QUEUE-EXISTS',
        organizationId: 'org_test',
        idempotencyKey: 'idemp-offline-99',
        status: 'queued',
      };
      mockQueueFindOne.mockResolvedValue(existingQueueDoc);

      const result = await offlineSyncService.queueOfflineData({
        organizationId: 'org_test',
        userId: 'worker_01',
        idempotencyKey: 'idemp-offline-99',
        dataType: 'worked_time',
        action: 'create',
        payload: { clockIn: '2026-04-01T09:00:00Z', clockOut: '2026-04-01T17:00:00Z' },
      });

      expect(result.success).toBe(true);
      expect(result.isIdempotentReplay).toBe(true);
      expect(result.data.queueId).toBe('QUEUE-EXISTS');
      expect(mockQueueCreate).not.toHaveBeenCalled();
    });
  });

  describe('Deterministic Conflict Detection', () => {
    it('flags version mismatch conflict when server record has newer updatedAt', async () => {
      mockWorkedTimeFindById.mockReturnValue({
        lean: async () => ({
          _id: 'wt_999',
          updatedAt: new Date('2026-04-02T12:00:00Z'),
          version: 2,
        }),
      });

      const conflictCheck = await offlineSyncService.detectConflict({
        dataType: 'worked_time',
        action: 'update',
        payload: {
          id: 'wt_999',
          updatedAt: '2026-04-01T10:00:00Z', // older than server
          version: 1,
        },
      });

      expect(conflictCheck.hasConflict).toBe(true);
      expect(conflictCheck.data.conflictType).toBe('version_mismatch');
      expect(conflictCheck.data.conflictFields).toContain('updatedAt');
    });

    it('allows sync without conflict when server version is not newer', async () => {
      mockWorkedTimeFindById.mockReturnValue({
        lean: async () => ({
          _id: 'wt_999',
          updatedAt: new Date('2026-04-01T08:00:00Z'), // older than client
          version: 1,
        }),
      });

      const conflictCheck = await offlineSyncService.detectConflict({
        dataType: 'worked_time',
        action: 'update',
        payload: {
          id: 'wt_999',
          updatedAt: '2026-04-01T10:00:00Z', // newer than server
          version: 2,
        },
      });

      expect(conflictCheck.hasConflict).toBe(false);
    });
  });
});
