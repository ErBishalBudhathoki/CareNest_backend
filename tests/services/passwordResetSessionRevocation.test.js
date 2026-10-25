const authService = require('../../services/authService');
const User = require('../../models/User');
const { admin } = require('../../firebase-admin-config');
const TemporalManager = require('../../core/TemporalManager');
const auditService = require('../../services/auditService');

jest.mock('../../models/User');
jest.mock('../../firebase-admin-config', () => ({
  admin: {
    auth: jest.fn().mockReturnValue({
      updateUser: jest.fn().mockResolvedValue({}),
      revokeRefreshTokens: jest.fn().mockResolvedValue({}),
      getUserByEmail: jest.fn().mockResolvedValue({ uid: 'mock-firebase-uid' })
    })
  }
}));
jest.mock('../../core/TemporalManager', () => ({
  startWorkflow: jest.fn().mockResolvedValue({}),
  getTaskQueue: jest.fn().mockReturnValue('auth-tasks')
}));
jest.mock('../../services/auditService', () => ({
  createAuditLog: jest.fn().mockResolvedValue({})
}));

describe('Password Reset Session Revocation', () => {
  const testEmail = 'testuser@example.com';
  const newPassword = 'NewSecurePassword123!';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should revoke Firebase refresh tokens and MongoDB refresh tokens on password reset', async () => {
    const mockUser = {
      _id: 'user-123',
      email: testEmail,
      firstName: 'Test',
      firebaseUid: 'firebase-uid-123',
      organizationId: 'org-123',
      refreshTokens: [
        {
          token: 'active-token-1',
          expires: new Date(Date.now() + 100000),
          revoked: null
        },
        {
          token: 'already-revoked-token',
          expires: new Date(Date.now() + 100000),
          revoked: new Date(Date.now() - 50000)
        }
      ]
    };

    jest.spyOn(authService, 'checkEmailExists').mockResolvedValue(mockUser);
    User.updateOne = jest.fn().mockResolvedValue({ modifiedCount: 1 });

    const result = await authService.updatePassword(testEmail, newPassword);

    expect(result).toBe(true);

    // Verify Firebase password update
    const authInstance = admin.auth();
    expect(authInstance.updateUser).toHaveBeenCalledWith('firebase-uid-123', {
      password: newPassword
    });

    // Verify Firebase refresh token revocation (GAP 2)
    expect(authInstance.revokeRefreshTokens).toHaveBeenCalledWith('firebase-uid-123');

    // Verify Mongo updateOne revoked active tokens
    expect(User.updateOne).toHaveBeenCalledWith(
      { email: testEmail },
      expect.objectContaining({
        $set: expect.objectContaining({
          firebaseUid: 'firebase-uid-123',
          refreshTokens: expect.arrayContaining([
            expect.objectContaining({
              token: 'active-token-1',
              revokedByIp: 'PASSWORD_RESET',
              replacedByToken: 'REVOKED_AFTER_RESET'
            })
          ])
        }),
        $unset: expect.objectContaining({
          password: '',
          otp: '',
          otpExpiry: '',
          otpUsed: ''
        })
      })
    );
  });

  it('should handle users without active refresh tokens gracefully during password reset', async () => {
    const mockUserNoTokens = {
      _id: 'user-456',
      email: 'notokens@example.com',
      firstName: 'NoTokens',
      firebaseUid: 'firebase-uid-456',
      organizationId: 'org-456',
      refreshTokens: []
    };

    jest.spyOn(authService, 'checkEmailExists').mockResolvedValue(mockUserNoTokens);
    User.updateOne = jest.fn().mockResolvedValue({ modifiedCount: 1 });

    const result = await authService.updatePassword('notokens@example.com', newPassword);

    expect(result).toBe(true);
    expect(admin.auth().revokeRefreshTokens).toHaveBeenCalledWith('firebase-uid-456');
    expect(User.updateOne).toHaveBeenCalledWith(
      { email: 'notokens@example.com' },
      expect.objectContaining({
        $set: expect.objectContaining({
          firebaseUid: 'firebase-uid-456'
        })
      })
    );
  });
});
