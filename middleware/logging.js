const { v4: uuidv4 } = require('uuid');
const logger = require('../config/logger');

function isInvoiceEndpoint(url = '') {
  const normalized = String(url || '').split('?')[0];
  return normalized.includes('/invoices');
}

function summarizeBodyPayload(body, { sensitive = false } = {}) {
  if (body === null || body === undefined) return undefined;

  if (Buffer.isBuffer(body)) {
    return { type: 'buffer', sizeBytes: body.length };
  }

  if (typeof body === 'string') {
    const summary = { type: 'string', sizeChars: body.length };
    if (!sensitive && body.length <= 300) {
      summary.preview = body;
    }
    return summary;
  }

  if (Array.isArray(body)) {
    return { type: 'array', length: body.length };
  }

  if (typeof body === 'object') {
    const keys = Object.keys(body);
    return {
      type: 'object',
      keyCount: keys.length,
      keys: keys.slice(0, 25),
    };
  }

  return { type: typeof body };
}

function getSafeHeaders(req) {
  return {
    'content-type': req.headers['content-type'],
    'content-length': req.headers['content-length'],
    'x-correlation-id': req.headers['x-correlation-id'],
    accept: req.headers.accept,
  };
}

/**
 * Request and Response Logging Middleware
 * Logs all incoming requests and outgoing responses with timing information
 */
function loggingMiddleware(req, res, next) {
  const start = Date.now();
  const requestId = uuidv4().slice(0, 8);
  const requestUrl = req.originalUrl || req.url;
  const isSensitivePath = isInvoiceEndpoint(requestUrl);
  
  // Extract user information from request
  const userId = req.user?.userId || req.body?.userId || req.query?.userId || req.headers['x-user-id'];
  const organizationId = req.user?.organizationId || req.body?.organizationId || req.query?.organizationId || req.headers['x-organization-id'];
  
  // Log request
  logger.request(req, {
    requestId,
    userId,
    organizationId,
    headers: getSafeHeaders(req),
    query: Object.keys(req.query || {}).length ? req.query : undefined,
    bodySummary: summarizeBodyPayload(req.body, { sensitive: isSensitivePath }),
    sensitivePath: isSensitivePath
  });

  // Log a single response event after response is finalized.
  res.on('finish', () => {
    const duration = Date.now() - start;
    const contentLengthHeader = res.getHeader('content-length');
    const responseSize = Number.parseInt(String(contentLengthHeader || '0'), 10);

    logger.response(req, res, duration, {
      requestId,
      userId: req.user?.userId || userId,
      organizationId: req.user?.organizationId || organizationId,
      responseSummary: {
        hasBody: Number.isFinite(responseSize) ? responseSize > 0 : undefined,
        sizeBytes: Number.isFinite(responseSize) ? responseSize : undefined,
      },
      sensitivePath: isSensitivePath,
    });
  });
  
  next();
}

/**
 * Silent logging middleware that logs at debug level only
 * Use this version when you want minimal logging
 */
function silentLoggingMiddleware(req, res, next) {
  const start = Date.now();
  const requestId = uuidv4().slice(0, 8);
  
  // Log request at debug level
  logger.debug('HTTP Request (Silent)', {
    requestId,
    method: req.method,
    url: req.originalUrl,
    query: req.query,
    bodyKeys: Object.keys(req.body)
  });
  
  // Capture the original methods
  const originalSend = res.send;
  const originalJson = res.json;
  const originalEnd = res.end;
  
  // Override send
  res.send = function(body) {
    const duration = Date.now() - start;
    logger.debug('HTTP Response (Silent)', {
      requestId,
      statusCode: res.statusCode,
      duration,
      hasBody: !!body
    });
    return originalSend.apply(res, arguments);
  };
  
  // Override json
  res.json = function(body) {
    const duration = Date.now() - start;
    logger.debug('HTTP Response (Silent)', {
      requestId,
      statusCode: res.statusCode,
      duration,
      hasBody: !!body
    });
    return originalJson.apply(res, arguments);
  };
  
  // Override end
  res.end = function(chunk) {
    const duration = Date.now() - start;
    logger.debug('HTTP Response (Silent)', {
      requestId,
      statusCode: res.statusCode,
      duration,
      hasBody: !!(chunk && typeof chunk !== 'function')
    });
    return originalEnd.apply(res, arguments);
  };
  
  next();
}

module.exports = {
  loggingMiddleware,
  silentLoggingMiddleware
};
