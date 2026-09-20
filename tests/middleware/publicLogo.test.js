/**
 * Public logo endpoint tests: logos/ streams without auth, everything
 * else is rejected (no open proxy), and logo uploads emit public-proxy
 * URLs instead of raw R2 locations.
 */
const express = require('express');
const request = require('supertest');

const mockS3Send = jest.fn();
jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn().mockImplementation(() => ({ send: mockS3Send })),
  GetObjectCommand: jest.fn((params) => params),
  PutObjectCommand: jest.fn((params) => params),
}));

jest.mock('../../utils/logger', () => ({
  createLogger: () => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    security: jest.fn(),
  }),
}));

const {
  buildPublicLogoUrl,
} = require('../../controllers/fileController');
const uploadController = require('../../controllers/uploadController');

const makeFilesApp = () => {
  const t = express();
  t.use(express.json());
  // eslint-disable-next-line global-require
  t.use('/files', require('../../routes/files'));
  return t;
};

function streamBody(text) {
  return {
    pipe: jest.fn((res) => res.json({ streamed: text })),
  };
}

describe('public logo endpoint', () => {
  let app;

  beforeAll(() => {
    process.env.NODE_ENV = 'test';
    process.env.R2_ACCOUNT_ID = 'test-acct';
    process.env.R2_ACCESS_KEY_ID = 'test-key';
    process.env.R2_SECRET_ACCESS_KEY = 'test-secret';
    process.env.R2_BUCKET_NAME = 'test-bucket';
    app = makeFilesApp();
  });

  afterAll(() => {
    delete process.env.R2_ACCOUNT_ID;
    delete process.env.R2_ACCESS_KEY_ID;
    delete process.env.R2_SECRET_ACCESS_KEY;
    delete process.env.R2_BUCKET_NAME;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockS3Send.mockResolvedValue({
      ContentType: 'image/png',
      ContentLength: 4,
      Body: streamBody('logo-bytes'),
    });
  });

  const logoUrl =
    'https://test-acct.r2.cloudflarestorage.com/test-bucket/logos/logo-1.png';

  test('streams logos/ keys without authentication', async () => {
    const res = await request(app).get(
      `/files/public?url=${encodeURIComponent(logoUrl)}`,
    );
    expect(res.status).toBe(200);
    expect(mockS3Send).toHaveBeenCalledTimes(1);
    expect(res.headers['cache-control']).toContain('public');
  });

  test('rejects non-logos keys with 400 (no open proxy)', async () => {
    const res = await request(app).get(
      `/files/public?url=${encodeURIComponent(
        'https://test-acct.r2.cloudflarestorage.com/test-bucket/receipts/r.jpg',
      )}`,
    );
    expect(res.status).toBe(400);
    expect(mockS3Send).not.toHaveBeenCalled();
  });

  test('rejects missing url with 400', async () => {
    const res = await request(app).get('/files/public');
    expect(res.status).toBe(400);
    expect(mockS3Send).not.toHaveBeenCalled();
  });

  test('rejects unsupported hosts with 400', async () => {
    const res = await request(app).get(
      `/files/public?url=${encodeURIComponent('https://evil.com/logos/x.png')}`,
    );
    expect(res.status).toBe(400);
    expect(mockS3Send).not.toHaveBeenCalled();
  });

  test('accepts legacy custom-domain logo URLs when configured', async () => {
    process.env.R2_PUBLIC_DOMAIN = 'assets.example.com';
    const res = await request(app).get(
      `/files/public?url=${encodeURIComponent('https://assets.example.com/logos/old.png')}`,
    );
    expect(res.status).toBe(200);
    expect(mockS3Send).toHaveBeenCalledTimes(1);
    delete process.env.R2_PUBLIC_DOMAIN;
  });
});

describe('uploadLogo URL shape', () => {
  test('emits public-proxy URL for R2 uploads', async () => {
    const req = {
      protocol: 'https',
      get: jest.fn(() => 'api.example.com'),
      file: {
        location:
          'https://test-acct.r2.cloudflarestorage.com/test-bucket/logos/l.png',
      },
    };
    const res = {};
    res.status = jest.fn(() => res);
    res.json = jest.fn((p) => {
      res.payload = p;
      return res;
    });
    await uploadController.uploadLogo(req, res, () => {});
    // catchAsync is fire-and-forget; flush before asserting.
    await new Promise((r) => setTimeout(r, 20));
    expect(res.payload.fileUrl).toBe(
      'https://api.example.com/api/files/public?url=' +
        encodeURIComponent(
          'https://test-acct.r2.cloudflarestorage.com/test-bucket/logos/l.png',
        ),
    );
  });

  test('buildPublicLogoUrl helper format', () => {
    const req = { protocol: 'https', get: () => 'api.example.com' };
    expect(buildPublicLogoUrl(req, 'https://x/logos/a.png')).toBe(
      'https://api.example.com/api/files/public?url=' +
        encodeURIComponent('https://x/logos/a.png'),
    );
  });
});
