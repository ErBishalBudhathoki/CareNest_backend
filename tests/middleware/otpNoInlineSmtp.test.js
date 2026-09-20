/**
 * OTP delivery regression: sendOTP must NOT send email inline.
 *
 * history: the handler awaited a Gmail SMTP send AFTER generateOTP had
 * already queued delivery via authNotificationWorkflow — SMTP latency or
 * failure broke login-adjacent requests, and success delivered TWO OTP
 * emails. Delivery now belongs solely to the workflow (with retries).
 */
const mockGenerateOTP = jest.fn();
jest.mock('../../services/authService', () => ({
  generateOTP: (...args) => mockGenerateOTP(...args),
}));

jest.mock('../../config/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
  security: jest.fn(),
  business: jest.fn(),
}));

jest.mock('../../models/User', () => ({
  findOne: jest.fn(),
}));

jest.mock('../../models/UserOrganization', () => ({
  findOne: jest.fn(),
}));

const AuthController = require('../../controllers/authController');

const flush = () => new Promise((resolve) => setTimeout(resolve, 20));

function mockRes() {
  const res = {};
  res.statusCode = 200;
  res.payload = null;
  res.status = jest.fn((code) => {
    res.statusCode = code;
    return res;
  });
  res.json = jest.fn((payload) => {
    res.payload = payload;
    return res;
  });
  return res;
}

describe('sendOTP (no inline SMTP)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGenerateOTP.mockResolvedValue('123456');
  });

  test('responds 200 after queuing delivery, without awaiting SMTP', async () => {
    const res = mockRes();
    await AuthController.sendOTP(
      { body: { email: 'user@example.com' }, ip: '1.1.1.1' },
      res,
    );
    await flush();
    expect(mockGenerateOTP).toHaveBeenCalledWith('user@example.com');
    expect(res.statusCode).toBe(200);
    expect(res.payload).toEqual({ message: 'OTP sent successfully' });
  });

  test('rejects missing email with 400 without touching the service', async () => {
    const res = mockRes();
    await AuthController.sendOTP({ body: {}, ip: '1.1.1.1' }, res);
    await flush();
    expect(mockGenerateOTP).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(400);
  });
});
