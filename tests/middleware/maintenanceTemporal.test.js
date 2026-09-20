/**
 * Maintenance activities: JWT rotation policy check + NDIS catalog sync.
 */
const mockRotateKeys = jest.fn();
const mockInitialize = jest.fn();
jest.mock('../../services/jwtKeyRotationService', () => ({
  initialize: (...args) => mockInitialize(...args),
  rotateKeys: (...args) => mockRotateKeys(...args),
  getValidKeys: jest.fn().mockReturnValue([]),
}));

const mockSyncIfChanged = jest.fn();
jest.mock('../../services/ndisCatalogSyncService', () => ({
  syncIfChanged: (...args) => mockSyncIfChanged(...args),
}));

const mockFindOne = jest.fn();
jest.mock('../../models/JWTSecret', () => ({
  findOne: (...args) => mockFindOne(...args),
}));

jest.mock('../../config/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
  security: jest.fn(),
}));

const {
  jwtRotationCheckActivity,
  ndisCatalogSyncActivity,
} = require('../../temporal/activities/maintenance');
const {
  JwtRotationCheckWorkflow,
  NdisCatalogSyncWorkflow,
} = require('../../temporal/workflows/maintenance');
const workflowIndex = require('../../temporal/workflows/index');

const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString();

function armLatestKey(createdAt) {
  mockFindOne.mockReturnValue({
    sort: jest.fn(() => ({
      lean: jest.fn().mockResolvedValue(
        createdAt ? { createdAt, activatedAt: createdAt } : null,
      ),
    })),
  });
}

describe('jwtRotationCheckActivity', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockInitialize.mockResolvedValue({ success: true });
  });

  test('skips rotation for a fresh key', async () => {
    armLatestKey(daysAgo(5));
    const result = await jwtRotationCheckActivity({ maxKeyAgeDays: 30 });
    expect(result.rotated).toBe(false);
    expect(mockRotateKeys).not.toHaveBeenCalled();
  });

  test('rotates an overdue key', async () => {
    armLatestKey(daysAgo(45));
    mockRotateKeys.mockResolvedValue({ newKey: { keyId: 'k-new' } });
    const result = await jwtRotationCheckActivity({ maxKeyAgeDays: 30 });
    expect(result).toEqual({ rotated: true, newKeyId: 'k-new' });
    expect(mockRotateKeys).toHaveBeenCalledWith({ rotationType: 'scheduled' });
  });

  test('rotates when no key exists', async () => {
    armLatestKey(null);
    mockRotateKeys.mockResolvedValue({ newKey: { keyId: 'k-first' } });
    const result = await jwtRotationCheckActivity({ maxKeyAgeDays: 30 });
    expect(result.rotated).toBe(true);
  });
});

describe('ndisCatalogSyncActivity', () => {
  test('passes through skipped flag', async () => {
    mockSyncIfChanged.mockResolvedValue({ skipped: true });
    const result = await ndisCatalogSyncActivity({ reason: 'scheduled' });
    expect(result.skipped).toBe(true);
    expect(mockSyncIfChanged).toHaveBeenCalledWith({ reason: 'scheduled' });
  });

  test('passes through sync results', async () => {
    mockSyncIfChanged.mockResolvedValue({ skipped: false, updated: 12 });
    const result = await ndisCatalogSyncActivity({ reason: 'scheduled' });
    expect(result.skipped).toBe(false);
  });
});

describe('maintenance workflows registration', () => {
  test('workflows are exported for the worker bundle', () => {
    expect(typeof JwtRotationCheckWorkflow).toBe('function');
    expect(typeof NdisCatalogSyncWorkflow).toBe('function');
    expect(workflowIndex.JwtRotationCheckWorkflow).toBe(
      JwtRotationCheckWorkflow,
    );
    expect(workflowIndex.NdisCatalogSyncWorkflow).toBe(
      NdisCatalogSyncWorkflow,
    );
  });
});
