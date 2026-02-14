jest.mock('../../models/JWTSecret', () => ({
  countDocuments: jest.fn(),
  updateMany: jest.fn(),
  findOne: jest.fn(),
  getActiveKey: jest.fn(),
  getValidKeys: jest.fn(),
  createKey: jest.fn(),
  rotateKeys: jest.fn(),
  cleanupOldKeys: jest.fn(),
  revokeKey: jest.fn(),
  find: jest.fn()
}));

const JWTSecret = require('../../models/JWTSecret');
const keyRotationService = require('../../services/jwtKeyRotationService');

function queryResult(doc) {
  return {
    sort: jest.fn().mockResolvedValue(doc)
  };
}

describe('JWTKeyRotationService initialization', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    keyRotationService.initialized = false;
    keyRotationService.activeKey = null;
    keyRotationService.validKeys = [];
    keyRotationService.lastCacheUpdate = 0;
    if (keyRotationService.rotationInterval) {
      clearInterval(keyRotationService.rotationInterval);
      keyRotationService.rotationInterval = null;
    }

    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('promotes most recent valid key when active key is expired', async () => {
    const validKey = {
      keyId: 'key_valid_1',
      activate: jest.fn().mockResolvedValue(undefined)
    };

    JWTSecret.countDocuments.mockResolvedValue(2);
    JWTSecret.updateMany.mockResolvedValue({ modifiedCount: 1 });
    JWTSecret.findOne
      .mockImplementationOnce(() => queryResult(null))
      .mockImplementationOnce(() => queryResult(validKey));
    JWTSecret.getActiveKey.mockResolvedValue({
      keyId: 'key_valid_1',
      isActive: () => true
    });
    JWTSecret.getValidKeys.mockResolvedValue([{ keyId: 'key_valid_1' }]);

    await keyRotationService.initialize({ keyLifetimeDays: 90 });

    expect(JWTSecret.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'active' }),
      expect.objectContaining({
        $set: expect.objectContaining({ status: 'revoked' })
      })
    );
    expect(validKey.activate).toHaveBeenCalledTimes(1);
    expect(keyRotationService.initialized).toBe(true);
    expect(keyRotationService.activeKey.keyId).toBe('key_valid_1');
  });

  it('creates a new initial key when no active or valid keys exist', async () => {
    const createInitialKeySpy = jest
      .spyOn(keyRotationService, 'createInitialKey')
      .mockResolvedValue({ keyId: 'key_initial_test' });

    JWTSecret.countDocuments.mockResolvedValue(1);
    JWTSecret.updateMany.mockResolvedValue({ modifiedCount: 0 });
    JWTSecret.findOne
      .mockImplementationOnce(() => queryResult(null))
      .mockImplementationOnce(() => queryResult(null));
    JWTSecret.getActiveKey.mockResolvedValue({
      keyId: 'key_initial_test',
      isActive: () => true
    });
    JWTSecret.getValidKeys.mockResolvedValue([{ keyId: 'key_initial_test' }]);

    await keyRotationService.initialize({ keyLifetimeDays: 90 });

    expect(createInitialKeySpy).toHaveBeenCalledTimes(1);
    expect(keyRotationService.initialized).toBe(true);
    expect(keyRotationService.activeKey.keyId).toBe('key_initial_test');
  });
});
