const EventEmitter = require('events');
const Redis = require('ioredis');
const logger = require('./logger');

// Check if we should use mock Redis (test only)
const useMockRedis = process.env.NODE_ENV === 'test';

let RedisClass = Redis;
if (useMockRedis) {
  try {
    RedisClass = require('ioredis-mock');
    logger.info('Using ioredis-mock for test environment');
  } catch (err) {
    logger.warn('ioredis-mock not found, falling back to real Redis');
  }
}

function getIsCloudRun() {
  return Boolean(process.env.K_SERVICE);
}

/**
 * Redact credentials from a Redis connection target so it is safe to log.
 *
 * Handles both shapes we accept: a rediss://redis:// URL string and a
 * host/port object. Only the password is replaced — the username and host are
 * kept, because "which account failed to authenticate" is exactly what you need
 * when diagnosing a WRONGPASS, and neither is a secret on its own.
 */
function maskRedisUrl(redisConfig) {
  if (!redisConfig) return null;

  if (typeof redisConfig === 'object') {
    const host = redisConfig.host || 'unknown';
    const port = redisConfig.port || 6379;
    return `${host}:${port}${redisConfig.password ? ' (auth)' : ''}`;
  }

  const raw = String(redisConfig);
  const at = raw.lastIndexOf('@');
  if (at === -1) return raw;

  const schemeEnd = raw.indexOf('://');
  const credStart = schemeEnd === -1 ? 0 : schemeEnd + 3;
  const credentials = raw.slice(credStart, at);
  const remainder = raw.slice(at + 1);

  if (!credentials) return `${raw.slice(0, credStart)}****@${remainder}`;

  const colon = credentials.indexOf(':');
  if (colon === -1) {
    // Token-style credentials (no username/password split) — mask entirely.
    return `${raw.slice(0, credStart)}****@${remainder}`;
  }

  const user = credentials.slice(0, colon);
  return `${raw.slice(0, credStart)}${user}:****@${remainder}`;
}

/**
 * Whether the resolved config points at a real client rather than the
 * DisabledRedisClient fallback. Cheap and synchronous — safe to call per
 * request from /health.
 */
function isRealClient(client) {
  return Boolean(client) && client.isConfigured !== false && client.status !== 'disabled';
}

/**
 * Boot/health self-check describing the resolved Redis posture.
 *
 * Returns booleans and an enum only. No host, no URL, no password — this is
 * surfaced from an unauthenticated /health endpoint, so it must stay inert as
 * far as identifying information goes.
 */
function assertRedisConfigured() {
  const config = resolveRedisRuntimeConfig();
  const target = config.redisConfig;
  const url = typeof target === 'string' ? target : '';
  const enabled = Boolean(config.enableRedisInCloudRun);
  const hasConfig = Boolean(target);

  return {
    enabled,
    hasConfig,
    // 'ready' means we have a real target AND it was not explicitly disabled.
    mode: !enabled ? 'disabled-by-env' : hasConfig ? 'configured' : 'unconfigured',
    isCloudRun: config.isCloudRun,
    tls: url.startsWith('rediss://'),
    client: hasConfig ? 'real' : 'disabled'
  };
}

function logRedisStatus(reason = 'startup') {
  const status = assertRedisConfigured();
  logger.info('[Redis] resolved', {
    reason,
    mode: status.mode,
    isCloudRun: status.isCloudRun,
    tls: status.tls,
    client: status.client
  });
  return status;
}

function getMaxConnections() {
  return getIsCloudRun() ? 2 : 10;
}

function resolveRedisRuntimeConfig() {
  const isCloudRun = getIsCloudRun();
  // Opt-OUT, not opt-in. Valkey is provisioned for this app and is expected to
  // be used, so requiring an extra flag to enable it meant the entire cache and
  // shared rate-limit layer silently stayed inert on Cloud Run (get() returned
  // null, set() reported success while writing nothing). Set
  // ENABLE_REDIS_IN_CLOUDRUN=false to disable it deliberately.
  const enableRedisInCloudRun = process.env.ENABLE_REDIS_IN_CLOUDRUN !== 'false';
  const hasRedisUrl = Boolean(process.env.REDIS_URL);
  const hasRedisHostConfig = Boolean(
    process.env.REDIS_HOST || process.env.REDIS_PORT || process.env.REDIS_PASSWORD
  );
  const shouldUseLocalDefaults = !hasRedisUrl && !hasRedisHostConfig && !isCloudRun;

  const parsedRedisPort = Number.parseInt(process.env.REDIS_PORT || '6379', 10);
  const redisPort = Number.isNaN(parsedRedisPort) ? 6379 : parsedRedisPort;

  let redisConfig = null;
  if (!enableRedisInCloudRun) {
    logger.warn(
      'Redis/Valkey DISABLED by ENABLE_REDIS_IN_CLOUDRUN=false. ' +
        'Caching and shared rate limits are OFF.'
    );
  } else if (hasRedisUrl) {
    redisConfig = process.env.REDIS_URL;
  } else if (hasRedisHostConfig || shouldUseLocalDefaults) {
    redisConfig = {
      host: process.env.REDIS_HOST || 'localhost',
      port: redisPort,
      password: process.env.REDIS_PASSWORD || undefined,
      maxRetriesPerRequest: null,
      retryStrategy: (times) => Math.min(times * 50, 2000)
    };
  }

  // A missing configuration is indistinguishable from a deliberate opt-out
  // unless we say so out loud. Before this flip, a Cloud Run deploy with no
  // REDIS_URL produced a DisabledRedisClient and logged nothing at all.
  if (enableRedisInCloudRun && !redisConfig) {
    logger.warn(
      'No Redis/Valkey configuration resolved — set REDIS_URL (or REDIS_HOST). ' +
        'Caching and shared rate limits are DISABLED.',
      {
        isCloudRun,
        hasRedisUrl,
        hasRedisHostConfig
      }
    );
  }

  return {
    isCloudRun,
    enableRedisInCloudRun,
    redisConfig,
  };
}

function getConfigKey(config) {
  const redisConfig =
    typeof config.redisConfig === 'string'
      ? config.redisConfig
      : JSON.stringify(config.redisConfig || null);

  return JSON.stringify({
    isCloudRun: config.isCloudRun,
    enableRedisInCloudRun: config.enableRedisInCloudRun,
    redisConfig,
  });
}

// Circuit breaker state
let connectionFailures = 0;
let circuitOpen = false;
let circuitOpenTime = 0;
const CIRCUIT_BREAK_THRESHOLD = 5;
const CIRCUIT_BREAK_RESET_MS = 60000;

// Shared connection pool - minimize connections
let sharedClient = null;
let connectionCount = 0;

class DisabledRedisClient extends EventEmitter {
  constructor() {
    super();
    this.options = {};
    this.status = 'disabled';
    this.isConfigured = false;
  }

  duplicate() {
    return new DisabledRedisClient();
  }

  async call() {
    return null;
  }

  async get() {
    return null;
  }

  async set() {
    return 'OK';
  }

  async del() {
    return 0;
  }

  async exists() {
    return 0;
  }

  async scan() {
    return ['0', []];
  }

  scanStream() {
    const stream = new EventEmitter();
    setImmediate(() => stream.emit('end'));
    return stream;
  }

  async publish() {
    return 0;
  }

  async subscribe(_channel, callback) {
    if (typeof callback === 'function') {
      callback(null, 0);
    }
    return 0;
  }

  async config() {
    return ['maxmemory-policy', 'noeviction'];
  }

  async quit() {
    return 'OK';
  }

  disconnect() {}
}

/**
 * Create or reuse a Redis connection
 * In Cloud Run, we limit connections to avoid hitting Redis Cloud limits
 */
function createRedisClient(url, options) {
  const isCloudRun = getIsCloudRun();
  const maxConnections = getMaxConnections();

  // Check circuit breaker
  if (circuitOpen) {
    const elapsed = Date.now() - circuitOpenTime;
    if (elapsed < CIRCUIT_BREAK_RESET_MS) {
      logger.warn('Redis circuit breaker is open');
      return new DisabledRedisClient();
    }
    logger.info('Attempting to reset Redis circuit breaker');
    circuitOpen = false;
    connectionFailures = 0;
  }

  // In CloudRun, reuse shared connection if possible
  if (isCloudRun && sharedClient && sharedClient.status === 'ready') {
    connectionCount++;
    logger.info('Reusing shared Redis connection', { totalConnections: connectionCount });
    
    // Return a wrapper that uses the shared client
    return createSharedClientWrapper(sharedClient);
  }

  // Check connection limit
  if (connectionCount >= maxConnections) {
    logger.warn('Redis connection limit reached, reusing shared connection');
    if (sharedClient) {
      return createSharedClientWrapper(sharedClient);
    }
    return new DisabledRedisClient();
  }

  // Create new connection
  connectionCount++;
  const client = new RedisClass(url, options);
  
  // Store as shared client for CloudRun
  if (isCloudRun && !sharedClient) {
    sharedClient = client;
  }

  client.on('connect', () => {
    connectionFailures = 0;
    logger.info('Redis connection established', { config: maskRedisUrl(url) });
  });

  client.on('ready', () => {
    logger.info('Redis client ready', { activeConnections: connectionCount });
  });

  client.on('error', (err) => {
    logger.error('Redis client error', { error: err.message });

    if (err.message.includes('ETIMEDOUT') ||
        err.message.includes('ECONNRESET') ||
        err.message.includes('WRONGPASS') ||
        err.message.includes('Command timed out')) {
      connectionFailures++;

      if (connectionFailures >= CIRCUIT_BREAK_THRESHOLD) {
        circuitOpen = true;
        circuitOpenTime = Date.now();
        logger.error('Redis circuit breaker opened', { failures: connectionFailures });
      }
    }
  });

  client.on('close', () => {
    logger.warn('Redis connection closed');
    if (sharedClient === client) {
      sharedClient = null;
      connectionCount = Math.max(0, connectionCount - 1);
    }
  });

  return client;
}

/**
 * Create a wrapper that shares a single connection
 * This reduces connection count but may have limitations for pub/sub
 */
function createSharedClientWrapper(client) {
  const wrapper = new EventEmitter();
  wrapper.isConfigured = true;
  wrapper.status = client.status;
  wrapper.options = client.options;
  
  // Pass through common methods
  const methods = ['call', 'get', 'set', 'del', 'exists', 'scan', 'scanStream', 
                   'publish', 'subscribe', 'config', 'quit', 'disconnect'];
  
  methods.forEach(method => {
    wrapper[method] = (...args) => client[method](...args);
  });
  
  wrapper.duplicate = () => {
    // Instead of creating a new connection, return the same wrapper
    logger.debug('Redis duplicate() called - returning shared connection');
    return createSharedClientWrapper(client);
  };
  
  // Forward events
  ['connect', 'ready', 'error', 'close', 'reconnecting'].forEach(event => {
    client.on(event, (...args) => wrapper.emit(event, ...args));
  });
  
  return wrapper;
}

// Parse connection options
function parseConnectionOptions(redisUrl) {
  const options = {
    maxRetriesPerRequest: null,
    connectTimeout: 20000,
    commandTimeout: 15000,
    keepAlive: 10000,
    enableOfflineQueue: true, // MUST be true for Cloud Run cold starts so initial requests don't instantly fail while connecting
    retryStrategy: (times) => {
      if (times > 3) {
        logger.error('Redis connection retry limit exceeded', { attempts: times });
        return null;
      }
      return Math.min(times * 2000, 10000);
    }
  };

  if (typeof redisUrl === 'string') {
    if (redisUrl.startsWith('rediss://')) {
      // Secure by default: only allow self-signed certs if explicitly requested via ENV
      options.tls = { 
        rejectUnauthorized: process.env.REDIS_REJECT_UNAUTHORIZED === 'false' ? false : true 
      };
    }
  }

  return options;
}

let redis;
let redisConfigKey = null;

function attachRedisMetadata(client, runtimeConfig) {
  client.isConfigured = Boolean(runtimeConfig.redisConfig);
  client.getConnectionStats = () => ({
    isCloudRun: runtimeConfig.isCloudRun,
    connectionCount,
    maxConnections: getMaxConnections(),
    circuitOpen,
    sharedClientActive: !!sharedClient
  });
  client.refreshConfiguration = refreshConfiguration;
  return client;
}

function closeRedisClient(client) {
  if (!client || client instanceof DisabledRedisClient) {
    return;
  }

  try {
    if (typeof client.quit === 'function') {
      client.quit().catch(() => {});
    } else if (typeof client.disconnect === 'function') {
      client.disconnect();
    }
  } catch {
    // Ignore cleanup failures during config refresh.
  }
}

function buildRedisClient(runtimeConfig) {
  if (!runtimeConfig.redisConfig) {
    logger.warn(
      'Redis is not configured. Redis-backed features will use in-memory or no-op behavior.',
      { isCloudRun: runtimeConfig.isCloudRun, nodeEnv: process.env.NODE_ENV || 'development' }
    );
    return attachRedisMetadata(new DisabledRedisClient(), runtimeConfig);
  }

  if (typeof runtimeConfig.redisConfig === 'string') {
    const connectionOptions = parseConnectionOptions(runtimeConfig.redisConfig);
    const client = createRedisClient(runtimeConfig.redisConfig, connectionOptions);
    client.connectionOptions = connectionOptions;
    client.redisUrl = runtimeConfig.redisConfig;
    return attachRedisMetadata(client, runtimeConfig);
  }

  const connectionOptions = {
    ...runtimeConfig.redisConfig,
    ...parseConnectionOptions(null),
  };
  const client = createRedisClient(connectionOptions, connectionOptions);
  client.connectionOptions = connectionOptions;
  return attachRedisMetadata(client, runtimeConfig);
}

function refreshConfiguration(force = false) {
  const runtimeConfig = resolveRedisRuntimeConfig();
  const nextConfigKey = getConfigKey(runtimeConfig);

  if (!force && redis && redisConfigKey === nextConfigKey) {
    return redis;
  }

  if (force || redisConfigKey !== nextConfigKey) {
    closeRedisClient(redis);
    if (sharedClient && sharedClient !== redis) {
      closeRedisClient(sharedClient);
      sharedClient = null;
    }
    connectionCount = 0;
  }

  redis = buildRedisClient(runtimeConfig);
  redisConfigKey = nextConfigKey;
  return redis;
}

function getRedisClient() {
  return refreshConfiguration();
}

const redisProxy = new Proxy(new EventEmitter(), {
  get(_target, property) {
    // Diagnostics are served off the proxy itself so callers can require the
    // module and reach them without triggering a client build.
    if (property === 'maskRedisUrl') return maskRedisUrl;
    if (property === 'assertRedisConfigured') return assertRedisConfigured;
    if (property === 'logRedisStatus') return logRedisStatus;
    if (property === 'isRealClient') return isRealClient;

    const client = getRedisClient();
    const value = client[property];
    return typeof value === 'function' ? value.bind(client) : value;
  },
  set(_target, property, value) {
    const client = getRedisClient();
    client[property] = value;
    return true;
  },
});

module.exports = redisProxy;
