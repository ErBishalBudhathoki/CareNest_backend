'use strict';

/**
 * P1 regression: ndisClaimService.generateBatch has supported idempotencyKey
 * since Milestone 7.1, but the controller never passed one. A retried POST
 * therefore created a second (usually empty) claim batch for the same period.
 */

jest.mock('../../utils/catchAsync', () => (fn) => fn);

const mockGenerateBatch = jest.fn();
jest.mock('../../services/ndisClaimService', () => ({
  generateBatch: (...args) => mockGenerateBatch(...args),
}));
jest.mock('../../services/ndisClaimResultsService', () => ({}));
jest.mock('../../services/cancellationBillingService', () => ({}));
jest.mock('../../services/providerTravelService', () => ({}));

const controller = require('../../controllers/ndisClaimController');

function request(body = {}, headers = {}) {
  return {
    user: { organizationId: 'org1', email: 'admin@example.org' },
    body: { from: '2026-04-01', to: '2026-04-30', ...body },
    get: (name) => headers[name.toLowerCase()] || undefined,
  };
}

function response() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGenerateBatch.mockResolvedValue({
    batch: { _id: 'b1' },
    csv: 'RegistrationNumber,...',
    validation: { errors: [], warnings: [] },
    lineCount: 1,
  });
});

describe('NDISClaimController.generateBatch idempotency', () => {
  test('derives a stable key from the canonical period when none is supplied', async () => {
    const res = response();
    await controller.generateBatch(request(), res);

    expect(mockGenerateBatch).toHaveBeenCalledWith(
      'org1',
      expect.objectContaining({
        idempotencyKey: 'claim:org1:2026-04-01:2026-04-30:valid',
      }),
      'admin@example.org',
    );
    expect(res.status).toHaveBeenCalledWith(201);
  });

  test('the same period expressed as DD/MM/YYYY produces the same key', async () => {
    await controller.generateBatch(request({ from: '01/04/2026', to: '30/04/2026' }), response());

    expect(mockGenerateBatch).toHaveBeenCalledWith(
      'org1',
      expect.objectContaining({
        idempotencyKey: 'claim:org1:2026-04-01:2026-04-30:valid',
      }),
      'admin@example.org',
    );
  });

  test('an explicit x-idempotency-key header wins over the derived key', async () => {
    await controller.generateBatch(
      request({}, { 'x-idempotency-key': 'client-uuid-42' }),
      response(),
    );
    expect(mockGenerateBatch).toHaveBeenCalledWith(
      'org1',
      expect.objectContaining({ idempotencyKey: 'client-uuid-42' }),
      'admin@example.org',
    );
  });

  test('regenerate:true is the explicit opt-out for a deliberate re-run', async () => {
    await controller.generateBatch(request({ regenerate: true }), response());
    expect(mockGenerateBatch.mock.calls[0][1].idempotencyKey).toBeUndefined();
  });

  test('allowInvalid is part of the key so a relaxed retry cannot replay a strict batch', async () => {
    await controller.generateBatch(request({ allowInvalid: true }), response());
    expect(mockGenerateBatch.mock.calls[0][1].idempotencyKey).toBe(
      'claim:org1:2026-04-01:2026-04-30:invalid',
    );
  });

  test('an idempotent replay returns 200 and flags it in the payload', async () => {
    mockGenerateBatch.mockResolvedValue({
      batch: { _id: 'b-existing' },
      csv: null,
      validation: { errors: [], warnings: [] },
      lineCount: 0,
      isIdempotentReplay: true,
    });
    const res = response();
    await controller.generateBatch(request(), res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('already generated'),
        data: expect.objectContaining({ isIdempotentReplay: true }),
      }),
    );
  });
});
