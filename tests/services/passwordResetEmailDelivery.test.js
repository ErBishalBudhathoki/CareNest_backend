'use strict';

/**
 * A password reset email is only delivered by Listmonk when the recipient is a
 * registered subscriber in its default subscriber mode. Signup registers the
 * address, but accounts created before that did not, so generateOTP must
 * register it before handing the email to the Temporal worker.
 */

jest.mock('../../models/User');
jest.mock('../../models/Client');
jest.mock('../../models/Organization');
jest.mock('../../models/UserOrganization');
jest.mock('../../services/auditService', () => ({
  createAuditLog: jest.fn().mockResolvedValue({}),
}));
jest.mock('../../services/emailService', () => ({
  addSubscriber: jest.fn().mockResolvedValue({ data: { id: 1 } }),
  sendEmail: jest.fn(),
}));
jest.mock('../../core/TemporalManager', () => ({
  startWorkflow: jest.fn().mockResolvedValue({ workflowId: 'wf-1' }),
  getTaskQueue: jest.fn().mockReturnValue('auth-tasks'),
}));
jest.mock('../../firebase-admin-config', () => ({
  admin: {
    auth: jest.fn().mockReturnValue({
      generateEmailVerificationLink: jest.fn(),
      getUserByEmail: jest.fn().mockResolvedValue({ uid: 'firebase-uid' }),
      updateUser: jest.fn().mockResolvedValue({}),
      revokeRefreshTokens: jest.fn().mockResolvedValue({}),
    }),
  },
}));

const authService = require('../../services/authService');
const User = require('../../models/User');
const emailService = require('../../services/emailService');
const TemporalManager = require('../../core/TemporalManager');

describe('password reset email delivery', () => {
  const email = 'ada@example.com';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('registers the recipient with Listmonk before the reset email is dispatched', async () => {
    jest.spyOn(authService, 'checkEmailExists').mockResolvedValue({
      _id: 'user-1',
      email,
      firstName: 'Ada',
      lastName: 'Lovelace',
      organizationId: 'org-1',
    });
    User.updateOne = jest.fn().mockResolvedValue({ modifiedCount: 1 });

    const otp = await authService.generateOTP(email);

    expect(otp).toMatch(/^\d{6}$/);
    expect(emailService.addSubscriber).toHaveBeenCalledWith(email, 'Ada Lovelace');

    const addSubscriberOrder = emailService.addSubscriber.mock.invocationCallOrder[0];
    const workflowOrder = TemporalManager.startWorkflow.mock.invocationCallOrder[0];
    expect(addSubscriberOrder).toBeLessThan(workflowOrder);

    const [, workflowArgs] = TemporalManager.startWorkflow.mock.calls[0];
    expect(workflowArgs.args[0]).toMatchObject({
      type: 'PASSWORD_RESET',
      data: { email, otp },
    });
  });

  it('falls back to the email when the user has no name', async () => {
    jest.spyOn(authService, 'checkEmailExists').mockResolvedValue({
      _id: 'user-2',
      email,
      organizationId: 'org-1',
    });
    User.updateOne = jest.fn().mockResolvedValue({ modifiedCount: 1 });

    await authService.generateOTP(email);

    expect(emailService.addSubscriber).toHaveBeenCalledWith(email, email);
  });
});
