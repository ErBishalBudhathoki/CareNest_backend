import http from 'k6/http';
import { check, sleep } from 'k6';

// Phase 4 load probe against the dev Cloud Run endpoint.
// It exercises the shared Valkey rate limiter + App Check gate path without
// needing a valid App Check token (every probe is rejected with 401, which is
// still a full round-trip through middleware, limiter and gate).
export const options = {
  stages: [
    { duration: '30s', target: 50 },
    { duration: '60s', target: 200 },
    { duration: '30s', target: 0 },
  ],
  thresholds: {
    http_req_duration: ['p(95)<2000'],
    http_req_failed: ['rate<0.05'],
  },
};

const BASE = __ENV.BASE_URL || 'https://backend-dev-406509736623.australia-southeast1.run.app';

// 401/400 from the auth probe are expected outcomes (no App Check token);
// k6 should only count genuine failures (5xx/network) as failed.
http.setResponseCallback(http.expectedStatuses(200, 400, 401, 429));

export default function () {
  const r1 = http.get(`${BASE}/api/health`);
  check(r1, { 'health 200': (r) => r.status === 200 });

  const r2 = http.post(
    `${BASE}/api/auth/login`,
    JSON.stringify({ email: 'probe@example.com', password: 'wrong' }),
    { headers: { 'Content-Type': 'application/json' } }
  );
  check(r2, { 'login gated (401/400)': (r) => r.status === 401 || r.status === 400 });

  sleep(0.3);
}
