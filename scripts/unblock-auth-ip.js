/**
 * Inspect and clear the auth middleware's brute-force IP blocks.
 *
 * `authenticateUser` counts failed authentication attempts per IP and blocks an
 * IP for an hour after 5 failures in 15 minutes. That state lives in the running
 * server process, so it cannot be cleared from the database — and the
 * `/api/security/dashboard/unblock-ip` endpoint is unreachable from a blocked
 * machine, because `authenticateUser` refuses the request before it can be
 * handled. This script talks to the `/admin-dev` ops surface instead, which sits
 * outside `authenticateUser` and authenticates with HTTP basic auth, so a
 * blocked IP can clear its own block.
 *
 * Usage:
 *   node scripts/unblock-auth-ip.js                 # show blocked IPs + attempts
 *   node scripts/unblock-auth-ip.js 203.0.113.7     # clear one IP
 *   node scripts/unblock-auth-ip.js --all           # clear every blocked IP
 *
 * Environment (backend/.env, or the repo-root .env):
 *   ADMIN_DEV_USER      basic-auth user for /admin-dev (default: admin)
 *   ADMIN_DEV_PASSWORD  basic-auth password for /admin-dev (required)
 *   DEVELOPMENT_URL     base URL of the target API
 *   API_BASE_URL        overrides DEVELOPMENT_URL
 *
 * Never prints any credential.
 */

const path = require('path');
const crypto = require('crypto');

require('dotenv').config({ path: path.join(__dirname, '../.env') });
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const BASE_URL = (
  process.env.API_BASE_URL ||
  process.env.DEVELOPMENT_URL ||
  process.env.PRODUCTION_URL ||
  ''
).replace(/\/+$/, '');
const ADMIN_USER = process.env.ADMIN_DEV_USER || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_DEV_PASSWORD || '';

// Mirrors requireCsrf() in routes/adminDevRoutes.js.
function csrfToken() {
  return crypto
    .createHmac('sha256', ADMIN_PASSWORD)
    .update('admin-dev-csrf-v1')
    .digest('hex');
}

function authHeader() {
  return `Basic ${Buffer.from(`${ADMIN_USER}:${ADMIN_PASSWORD}`).toString('base64')}`;
}

async function call(pathname, { method = 'GET', body } = {}) {
  const headers = { Authorization: authHeader() };
  if (method !== 'GET') headers['x-admin-dev-csrf'] = csrfToken();
  if (body) headers['Content-Type'] = 'application/json';

  const response = await fetch(`${BASE_URL}${pathname}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await response.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch (_) {
    payload = { raw: text };
  }
  return { status: response.status, payload };
}

async function main() {
  if (!BASE_URL) {
    console.error(
      'No API base URL. Set DEVELOPMENT_URL or API_BASE_URL (see .env).',
    );
    process.exit(1);
  }
  if (!ADMIN_PASSWORD) {
    console.error(
      'ADMIN_DEV_PASSWORD is not set. Cannot authenticate against /admin-dev.',
    );
    process.exit(1);
  }

  const arg = process.argv[2];
  const target = arg && !arg.startsWith('--') ? arg : '';
  const clearAll = arg === '--all';

  if (!target && !clearAll) {
    const { status, payload } = await call('/admin-dev/api/ops/auth-blocks');
    if (status !== 200) {
      console.error(`Failed to read auth blocks (HTTP ${status}).`);
      console.error(JSON.stringify(payload, null, 2));
      process.exit(1);
    }
    const data = payload.data || {};
    console.log(`Target: ${BASE_URL}`);
    console.log(`Blocked IPs: ${data.count ?? 0}`);
    for (const entry of data.blockedIPs || []) {
      console.log(`  ${entry.ip}  (until ${entry.expiresAt})`);
    }
    if ((data.failedAttempts || []).length > 0) {
      console.log('Recent failed attempts:');
      for (const entry of data.failedAttempts) {
        console.log(`  ${entry.ip}  ${entry.attempts} attempt(s)`);
      }
    }
    console.log(
      '\nTo clear: node scripts/unblock-auth-ip.js <ip> | --all',
    );
    return;
  }

  const { status, payload } = await call(
    '/admin-dev/api/ops/auth-blocks/unblock',
    { method: 'POST', body: clearAll ? {} : { ip: target } },
  );

  if (status !== 200) {
    console.error(`Unblock failed (HTTP ${status}).`);
    console.error(JSON.stringify(payload, null, 2));
    process.exit(1);
  }

  if (clearAll) {
    console.log(`Cleared ${payload.count ?? 0} blocked IP(s).`);
    for (const ip of payload.cleared || []) console.log(`  ${ip}`);
  } else {
    console.log(
      payload.unblocked
        ? `Unblocked ${payload.ip}.`
        : `${payload.ip} was not blocked.`,
    );
  }
}

main().catch((error) => {
  console.error('Unblock failed:', error.message);
  process.exit(1);
});
