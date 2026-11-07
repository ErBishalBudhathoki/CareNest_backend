'use strict';

/**
 * Single source of truth for dev/prod namespace isolation.
 *
 * Valkey and Cloudflare R2 are currently SHARED infrastructure between the dev
 * and prod backends (different Valkey hosts, but the same R2 account/bucket and
 * no key prefix). A missing prefix means a dev cache write, rate-limit reset or
 * R2 upload can collide with a prod object. Everything that writes a shared
 * key MUST go through scopeKey() (Valkey) or scopePath() (R2).
 *
 * The discriminator is deliberately conservative: only an explicit production
 * marker is treated as prod, so an unset/misspelled NODE_ENV can never make a
 * dev process write into prod's namespace.
 */
const RAW_ENV = String(
  process.env.APP_ENV || process.env.NODE_ENV || 'development'
).trim().toLowerCase();

const ENV_SCOPE = RAW_ENV === 'production' || RAW_ENV === 'prod' ? 'prod' : 'dev';

const KNOWN_SCOPES = ['dev', 'prod', 'staging', 'test'];

function _clean(key) {
  return String(key == null ? '' : key);
}

/**
 * Prefix a Valkey key with the environment. Idempotent: a key that already
 * starts with a known scope is returned unchanged, so double-wrapping at a
 * call site cannot produce `dev:dev:rl:...`.
 */
function scopeKey(key) {
  const clean = _clean(key);
  const head = clean.split(':')[0];
  if (KNOWN_SCOPES.includes(head)) return clean;
  return `${ENV_SCOPE}:${clean}`;
}

/**
 * Prefix an R2 object path with the environment (e.g. `dev/invoices/x.pdf`).
 * Idempotent for the same reason as scopeKey().
 */
function scopePath(key) {
  const clean = _clean(key).replace(/^\/+/, '');
  const head = clean.split('/')[0];
  if (KNOWN_SCOPES.includes(head)) return clean;
  return `${ENV_SCOPE}/${clean}`;
}

/**
 * Ordered list of keys to try when reading an object that may have been
 * written before scoping was introduced. Scoped first, legacy last.
 */
function readCandidatePaths(key) {
  const clean = _clean(key).replace(/^\/+/, '');
  const scoped = scopePath(clean);
  const candidates = [scoped];
  if (scoped !== clean) candidates.push(clean);
  return [...new Set(candidates)];
}

/**
 * Ordered list of Valkey keys to try on read (scoped first, legacy fallback).
 */
function readCandidateKeys(key) {
  const clean = _clean(key);
  const scoped = scopeKey(clean);
  const candidates = [scoped];
  if (scoped !== clean) candidates.push(clean);
  return [...new Set(candidates)];
}

/**
 * Reject a key that explicitly belongs to a DIFFERENT environment. Legacy
 * (unscoped) keys are allowed for backwards compatibility with objects written
 * before scoping was introduced; new writes always carry a scope.
 */
function isKeyForCurrentScope(key) {
  const clean = _clean(key).replace(/^\/+/, '');
  const head = clean.split(/[/:]/)[0];
  if (KNOWN_SCOPES.includes(head)) return head === ENV_SCOPE;
  return true;
}

/**
 * Only a genuine "object missing" response should trigger the legacy-key
 * fallback. A 403/500 must NOT be swallowed into a second read of a different
 * object, otherwise real permission/outage failures get masked.
 */
function isObjectNotFoundError(error) {
  const status = error && error.$metadata && error.$metadata.httpStatusCode;
  const code = (error && (error.name || error.Code || error.code)) || '';
  return (
    status === 404 ||
    ['NotFound', 'NotFoundError', 'NoSuchKey', 'NoSuchBucket'].includes(code)
  );
}

module.exports = {
  ENV_SCOPE,
  RAW_ENV,
  KNOWN_SCOPES,
  scopeKey,
  scopePath,
  readCandidatePaths,
  readCandidateKeys,
  isKeyForCurrentScope,
  isObjectNotFoundError,
};
