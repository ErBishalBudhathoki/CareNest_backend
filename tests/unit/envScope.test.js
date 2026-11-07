'use strict';

/**
 * Regression guard for dev/prod isolation on SHARED Valkey / R2.
 *
 * These tests deliberately re-require the module with different process.env
 * values, because the scope is resolved once at module load (matching how the
 * real process boots on Cloud Run).
 */

const ORIGINAL_APP_ENV = process.env.APP_ENV;
const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

function loadScope({ appEnv, nodeEnv } = {}) {
  jest.resetModules();
  if (appEnv === undefined) delete process.env.APP_ENV;
  else process.env.APP_ENV = appEnv;
  if (nodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = nodeEnv;
  return require('../../utils/envScope');
}

afterAll(() => {
  if (ORIGINAL_APP_ENV === undefined) delete process.env.APP_ENV;
  else process.env.APP_ENV = ORIGINAL_APP_ENV;
  if (ORIGINAL_NODE_ENV === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = ORIGINAL_NODE_ENV;
});

describe('envScope: discriminator is conservative', () => {
  const cases = [
    [{ appEnv: 'production' }, 'prod'],
    [{ appEnv: 'prod' }, 'prod'],
    [{ appEnv: 'PRODUCTION' }, 'prod'],
    [{ nodeEnv: 'production' }, 'prod'],
    [{ appEnv: 'development' }, 'dev'],
    [{ nodeEnv: 'staging' }, 'dev'],
    [{ appEnv: 'Productionn' }, 'dev'], // typo must never escalate to prod
    [{}, 'dev'], // unset env defaults to dev
  ];

  test.each(cases)('env %p resolves to %s', (env, expected) => {
    expect(loadScope(env).ENV_SCOPE).toBe(expected);
  });

  test('APP_ENV takes precedence over NODE_ENV', () => {
    expect(loadScope({ appEnv: 'development', nodeEnv: 'production' }).ENV_SCOPE).toBe('dev');
  });
});

describe('envScope: Valkey keys', () => {
  test('dev and prod rate-limit keys cannot collide', () => {
    const dev = loadScope({ nodeEnv: 'development' });
    const prod = loadScope({ nodeEnv: 'production' });
    expect(dev.scopeKey('rl:login:user@example.com')).toBe('dev:rl:login:user@example.com');
    expect(prod.scopeKey('rl:login:user@example.com')).toBe('prod:rl:login:user@example.com');
    expect(dev.scopeKey('rl:login:user@example.com')).not.toBe(prod.scopeKey('rl:login:user@example.com'));
  });

  test('scoping is idempotent (no dev:dev: double prefix)', () => {
    const dev = loadScope({ nodeEnv: 'development' });
    const once = dev.scopeKey('http:resp:/api/invoices');
    expect(dev.scopeKey(once)).toBe(once);
  });

  test('readCandidateKeys is scoped-first with legacy fallback', () => {
    const dev = loadScope({ nodeEnv: 'development' });
    expect(dev.readCandidateKeys('rl:login:x')).toEqual(['dev:rl:login:x', 'rl:login:x']);
  });

  test('reset scripts only touch the current scope namespace', () => {
    const prod = loadScope({ nodeEnv: 'production' });
    expect(prod.scopeKey('rl:')).toBe('prod:rl:');
    expect(prod.scopeKey('rl:')).not.toContain('dev:');
  });
});

describe('envScope: R2 object paths', () => {
  test('dev and prod uploads land in different namespaces', () => {
    const dev = loadScope({ nodeEnv: 'development' });
    const prod = loadScope({ nodeEnv: 'production' });
    const key = 'invoices/org-1/inv-1.pdf';
    expect(dev.scopePath(key)).toBe(`dev/${key}`);
    expect(prod.scopePath(key)).toBe(`prod/${key}`);
  });

  test('leading slashes are stripped and scoping is idempotent', () => {
    const dev = loadScope({ nodeEnv: 'development' });
    expect(dev.scopePath('/logos/a.png')).toBe('dev/logos/a.png');
    expect(dev.scopePath('dev/logos/a.png')).toBe('dev/logos/a.png');
    expect(dev.scopePath(dev.scopePath('logos/a.png'))).toBe('dev/logos/a.png');
  });

  test('readCandidatePaths is scoped-first with legacy fallback', () => {
    const prod = loadScope({ nodeEnv: 'production' });
    expect(prod.readCandidatePaths('claimBatches/org/batch.csv')).toEqual([
      'prod/claimBatches/org/batch.csv',
      'claimBatches/org/batch.csv',
    ]);
  });

  test('an explicitly cross-environment key is rejected', () => {
    const dev = loadScope({ nodeEnv: 'development' });
    const prod = loadScope({ nodeEnv: 'production' });
    expect(dev.isKeyForCurrentScope('prod/invoices/a.pdf')).toBe(false);
    expect(prod.isKeyForCurrentScope('dev/invoices/a.pdf')).toBe(false);
    expect(dev.isKeyForCurrentScope('dev/invoices/a.pdf')).toBe(true);
    expect(prod.isKeyForCurrentScope('prod/invoices/a.pdf')).toBe(true);
    // Legacy unscoped objects stay readable for backwards compatibility.
    expect(dev.isKeyForCurrentScope('invoices/a.pdf')).toBe(true);
    expect(prod.isKeyForCurrentScope('invoices/a.pdf')).toBe(true);
  });
});

describe('envScope: legacy fallback only on not-found', () => {
  const { isObjectNotFoundError } = require('../../utils/envScope');

  test.each([
    { $metadata: { httpStatusCode: 404 } },
    { name: 'NoSuchKey' },
    { name: 'NotFound' },
    { Code: 'NoSuchBucket' },
  ])('treats %p as missing', (error) => {
    expect(isObjectNotFoundError(error)).toBe(true);
  });

  test.each([
    { $metadata: { httpStatusCode: 403 }, name: 'AccessDenied' },
    { $metadata: { httpStatusCode: 500 }, name: 'InternalError' },
    new Error('network timeout'),
    null,
  ])('does NOT mask %p as missing', (error) => {
    expect(isObjectNotFoundError(error)).toBe(false);
  });
});
