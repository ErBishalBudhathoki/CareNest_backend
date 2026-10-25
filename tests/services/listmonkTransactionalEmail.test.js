'use strict';

/**
 * Guards the ways a transactional email can be silently broken by Listmonk:
 *
 *  1. `LISTMONK_TEMPLATE_ID` points at a campaign template (Listmonk seeds id 1
 *     as "Default campaign template") — `/tx` rejects it with 400 "template N
 *     not found" and campaign templates are never modified.
 *  2. The tx template does not print `{{ .Tx.Data.body | Safe }}`, so Listmonk
 *     delivers an empty body, or literal escaped markup.
 *  3. The recipient is not a registered subscriber, so the default subscriber
 *     mode drops the message with a 400. Sends now use `subscriber_mode:
 *     fallback`.
 */

jest.mock('https', () => ({ request: jest.fn() }));

const TX_BODY = '{{ .Tx.Data.body | Safe }}';
const TEMPLATE_ID = 1;

const calls = [];
let responses = [];

function queueResponse(status, json) {
  responses.push({ status, json });
}

function installHttpsMock(https) {
  https.request.mockImplementation((options, cb) => {
    const req = {
      _body: '',
      on: jest.fn((event, handler) => {
        if (event === 'error') req._onError = handler;
        return req;
      }),
      write: jest.fn((chunk) => {
        req._body += chunk;
        return true;
      }),
      end: jest.fn(() => {
        calls.push({
          method: options.method,
          path: options.path,
          body: req._body ? JSON.parse(req._body) : null,
        });

        const next = responses.shift() || { status: 200, json: { data: true } };
        const res = new (require('events').EventEmitter)();
        res.statusCode = next.status;
        cb(res);
        process.nextTick(() => {
          res.emit('data', JSON.stringify(next.json || {}));
          res.emit('end');
        });
      }),
    };
    return req;
  });
}

describe('Listmonk transactional email dispatch', () => {
  let service;
  let originalNodeEnv;
  let originalTemplateId;

  beforeEach(() => {
    calls.length = 0;
    responses = [];
    originalNodeEnv = process.env.NODE_ENV;
    originalTemplateId = process.env.LISTMONK_TEMPLATE_ID;
    // _dispatchTx is a no-op under NODE_ENV=test (jest default).
    process.env.NODE_ENV = 'development';
    process.env.LISTMONK_TEMPLATE_ID = String(TEMPLATE_ID);
    jest.resetModules();
    // resetModules() rebuilds the mocked core module, so grab the live instance
    // before the service requires it.
    const https = require('https');
    installHttpsMock(https);
    service = require('../../services/listmonkService');
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    if (originalTemplateId === undefined) {
      delete process.env.LISTMONK_TEMPLATE_ID;
    } else {
      process.env.LISTMONK_TEMPLATE_ID = originalTemplateId;
    }
  });

  it('rewrites a tx template that never outputs data.body', async () => {
    queueResponse(200, {
      data: { id: TEMPLATE_ID, name: 'Legacy', subject: '', type: 'tx', body: '<html><body></body></html>' },
    });
    queueResponse(200, { data: { id: TEMPLATE_ID } });
    queueResponse(200, { data: true });

    const result = await service.sendEmail('user@example.com', 'Password Reset', '<p>code 123456</p>');

    expect(result).toEqual({ data: true });

    const [, putTemplate, tx] = calls;
    expect(putTemplate.method).toBe('PUT');
    expect(putTemplate.path).toContain(`/templates/${TEMPLATE_ID}`);
    expect(putTemplate.body).toMatchObject({ type: 'tx', body: TX_BODY });

    expect(tx.method).toBe('POST');
    expect(tx.path).toContain('/tx');
    expect(tx.body).toMatchObject({
      subscriber_email: 'user@example.com',
      subscriber_mode: 'fallback',
      template_id: TEMPLATE_ID,
      subject: 'Password Reset',
      content_type: 'html',
    });
    expect(tx.body.data.body).toBe('<p>code 123456</p>');
  });

  it('repairs a template that renders the body without the Safe pipe', async () => {
    queueResponse(200, {
      data: { id: TEMPLATE_ID, name: 'Escaping', subject: '', type: 'tx', body: '{{ .Tx.Data.body }}' },
    });
    queueResponse(200, { data: { id: TEMPLATE_ID } });
    queueResponse(200, { data: true });

    await service.sendEmail('user@example.com', 'Verify', '<p>otp</p>');

    expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(1);
    expect(calls.find((c) => c.method === 'PUT').body.body).toBe(TX_BODY);
  });

  it('leaves a correct template untouched and checks it only once per process', async () => {
    queueResponse(200, {
      data: { id: TEMPLATE_ID, name: 'CareNest', subject: '', type: 'tx', body: `<html>${TX_BODY}</html>` },
    });
    queueResponse(200, { data: true });

    await service.sendEmail('a@example.com', 'One', '<p>one</p>');
    await service.sendEmail('b@example.com', 'Two', '<p>two</p>');

    expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(0);
    expect(calls.filter((c) => c.method === 'GET')).toHaveLength(1);
    expect(calls.filter((c) => c.method === 'POST' && c.path.includes('/tx'))).toHaveLength(2);
  });

  it('ignores a campaign template and uses an existing tx template instead', async () => {
    // Listmonk's seeded final state: id 1 is "Default campaign template" and
    // the only tx template is a separate record.
    queueResponse(200, {
      data: { id: TEMPLATE_ID, name: 'Default campaign template', subject: '', type: 'campaign', body: '{{ template "content" . }}' },
    });
    queueResponse(200, {
      total: 3,
      data: [
        { id: TEMPLATE_ID, name: 'Default campaign template', type: 'campaign', body: 'x' },
        { id: 3, name: 'CareNest Transactional', type: 'tx', body: `<html>${TX_BODY}</html>` },
      ],
    });
    queueResponse(200, { data: true });

    await service.sendEmail('user@example.com', 'Subject', '<p>body</p>');

    // The campaign record is never modified.
    expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(0);

    const tx = calls.find((c) => c.method === 'POST' && c.path.includes('/tx'));
    expect(tx.body.template_id).toBe(3);
  });

  it('repairs an existing tx template found while redirecting away from a campaign id', async () => {
    queueResponse(200, {
      data: { id: TEMPLATE_ID, name: 'Default campaign template', type: 'campaign', body: '{{ template "content" . }}' },
    });
    queueResponse(200, {
      data: [{ id: 3, name: 'Sample transactional template', type: 'tx', body: '{{ .Tx.Data.body }}' }],
    });
    queueResponse(200, { data: { id: 3 } });
    queueResponse(200, { data: true });

    await service.sendEmail('user@example.com', 'Subject', '<p>body</p>');

    const put = calls.find((c) => c.method === 'PUT');
    expect(put.path).toContain('/templates/3');
    expect(put.body.body).toBe(TX_BODY);

    const tx = calls.find((c) => c.method === 'POST' && c.path.includes('/tx'));
    expect(tx.body.template_id).toBe(3);
  });

  it('creates a tx template when the configured id does not exist and none exists', async () => {
    // Listmonk answers a missing template with 400, not 404.
    queueResponse(400, { message: 'Template not found' });
    queueResponse(200, { total: 0, data: [] });
    queueResponse(200, { data: { id: 9 } });
    queueResponse(200, { data: true });

    await service.sendEmail('user@example.com', 'Subject', '<p>body</p>');

    const created = calls.find((c) => c.method === 'POST' && c.path.includes('/templates'));
    expect(created.body).toMatchObject({ type: 'tx', body: TX_BODY });

    const tx = calls.find((c) => c.method === 'POST' && c.path.includes('/tx'));
    expect(tx.body.template_id).toBe(9);
  });

  it('still sends when the template check cannot be performed', async () => {
    queueResponse(403, { message: 'invalid API credentials' });
    queueResponse(200, { data: true });

    const result = await service.sendEmail('user@example.com', 'Subject', '<p>body</p>');

    expect(result).toEqual({ data: true });
    expect(calls.filter((c) => c.method === 'POST' && c.path.includes('/tx'))).toHaveLength(1);
  });
});
