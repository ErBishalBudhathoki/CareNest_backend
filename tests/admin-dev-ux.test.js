/**
 * Phase 4: console UX — per-panel state, race guards, theme, keyboard.
 *
 * These are structural assertions on the served page plus a few behavioural
 * ones against the instance endpoint. A full DOM harness is not available
 * (no jsdom in this suite), so the UI contract is asserted the same way the
 * earlier phases assert it: by inspecting the shipped script.
 */
process.env.ADMIN_DEV_USER = process.env.ADMIN_DEV_USER || 'admin';
process.env.ADMIN_DEV_PASSWORD = process.env.ADMIN_DEV_PASSWORD || 'dev-secret';

const request = require('supertest');
const app = require('../app');
const fs = require('fs');
const path = require('path');

const authHeader =
  'Basic ' +
  Buffer.from(`${process.env.ADMIN_DEV_USER}:${process.env.ADMIN_DEV_PASSWORD}`).toString('base64');

const page = () =>
  request(app).get('/admin-dev/ops').set('Authorization', authHeader).then((r) => r.text);

const scriptOf = (html) => {
  const m = html.match(/<script>\n([\s\S]*)\n<\/script>/);
  return m ? m[1] : '';
};

describe('Phase 4 — per-panel state', () => {
  test('every panel owns a status node instead of sharing one banner', async () => {
    const html = await page();
    for (const id of ['kpis', 'analytics', 'users', 'leave', 'certs', 'valkey', 'wf', 'audit', 'orgreset', 'lookup']) {
      expect(html).toContain(`id="panelStatus-${id}"`);
    }
  });

  test('a panel failure no longer routes through the global banner', async () => {
    const js = scriptOf(await page());
    // The old behaviour funnelled every failure into one sticky banner, so
    // simultaneous failures overwrote each other.
    expect(js).not.toMatch(/catch \(e\) \{ alertBox\(e\.message/);
    expect(js).toMatch(/setPanel\('[a-z]+', 'error', e\.message\)/);
  });

  test('the alert region is announced to assistive tech', async () => {
    const html = await page();
    expect(html).toMatch(/role="alert"/);
    expect(html).toMatch(/aria-live="polite"/);
  });
});

describe('Phase 4 — request robustness', () => {
  test('requests abort rather than hanging forever', async () => {
    const js = scriptOf(await page());
    expect(js).toMatch(/AbortController/);
    expect(js).toMatch(/REQUEST_TIMEOUT_MS/);
  });

  test('overlapping loads cannot overwrite each other', async () => {
    const js = scriptOf(await page());
    // Without a sequence guard, a slow earlier request wins over a newer one.
    expect(js).toMatch(/beginSeq/);
    expect(js).toMatch(/isCurrent/);
    expect(js.match(/beginSeq\('(\w+)'\)/g).length).toBeGreaterThanOrEqual(4);
  });

  test('buttons disable while their request is in flight', async () => {
    const html = await page();
    const js = scriptOf(html);
    expect(js).toMatch(/function busy\(/);
    expect(js).toMatch(/runBusy/);
    expect(html).toMatch(/button:disabled/);
  });

  test('a 401 reads as an expired session instead of a blank error', async () => {
    const js = scriptOf(await page());
    expect(js).toMatch(/Session expired/);
  });

  test('the page still assigns no server data via innerHTML', async () => {
    const html = await page();
    const assignments = html
      .split('\n')
      .filter((l) => /\.innerHTML\s*=/.test(l) && !l.trim().startsWith('//'));
    expect(assignments).toEqual([]);
  });
});

describe('Phase 4 — lazy loading', () => {
  test('analytics is not in the first-paint bootstrap', async () => {
    const js = scriptOf(await page());
    // Anchor on the bootstrap statement itself, not the earlier loadStats()
    // call inside refreshAll().
    const bootstrap = js.split('\nloadStats(); loadUsers(1);')[1] || '';
    // Analytics is four aggregate round trips; most visits never open it.
    expect(bootstrap).not.toContain('loadAnalytics()');
    expect(js).toMatch(/analyticsEverLoaded/);
  });

  test('auto-refresh does not drag analytics in on the first tick', async () => {
    const js = scriptOf(await page());
    const refresh = js.slice(js.indexOf('function refreshAll'));
    const block = refresh.slice(0, refresh.indexOf('}'));
    expect(block).toContain('if (analyticsEverLoaded) loadAnalytics()');
  });
});

describe('Phase 4 — presentation and input', () => {
  test('dark mode follows the OS and can be overridden', async () => {
    const html = await page();
    expect(html).toMatch(/prefers-color-scheme: dark/);
    expect(html).toMatch(/data-theme="dark"/);
    expect(html).toMatch(/id="themeToggle"/);
  });

  test('keyboard shortcuts exist and skip while typing', async () => {
    const js = scriptOf(await page());
    expect(js).toMatch(/ev\.key === '\/'/);
    expect(js).toMatch(/ev\.key === 'r'/);
    expect(js).toMatch(/const typing = tag === 'input'/);
  });

  test('search submits on Enter', async () => {
    const js = scriptOf(await page());
    expect(js).toMatch(/ev\.target\.id === 'q'/);
  });

  test('focus is visible', async () => {
    const html = await page();
    expect(html).toMatch(/:focus-visible/);
  });

  test('auto-refresh offers explicit intervals and defaults to off', async () => {
    const html = await page();
    expect(html).toMatch(/id="autoRefresh"/);
    expect(html).toMatch(/<option value="0">off<\/option>/);
  });
});

describe('Phase 4 — deploy identity', () => {
  test('the instance payload names the build answering the request', async () => {
    const res = await request(app)
      .get('/admin-dev/api/ops/instance')
      .set('Authorization', authHeader);
    expect(res.body.data.build).toHaveProperty('revision');
    expect(res.body.data.build).toHaveProperty('service');
    expect(res.body.data.build).toHaveProperty('instance');
    expect(typeof res.body.data.build.uptimeSeconds).toBe('number');
  });

  test('the header renders build identity from that payload', async () => {
    const js = scriptOf(await page());
    expect(js).toMatch(/buildInfo/);
    expect(js).toMatch(/d\.build/);
  });
});