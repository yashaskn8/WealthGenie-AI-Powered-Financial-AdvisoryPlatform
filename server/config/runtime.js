import { getMongoFlavor } from './mongoCompatibility.js';

const LOCAL_DEVELOPMENT_ORIGINS = ['http://localhost:5173', 'http://localhost:3000'];

function positiveInteger(value, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

function parseTrustProxy(value, isProduction) {
  if (value === undefined || value === '') return isProduction ? 1 : false;
  if (value === 'false') return false;
  if (value === 'true') return 1;
  const hops = Number(value);
  return Number.isInteger(hops) && hops >= 0 && hops <= 10 ? hops : false;
}

function booleanValue(value, fallback) {
  if (value === undefined || value === '') return fallback;
  return value === 'true';
}

export function getRuntimeConfig(env = process.env) {
  const nodeEnv = env.NODE_ENV || 'development';
  const isProduction = nodeEnv === 'production';
  const configuredOrigins = (env.CORS_ORIGINS || '')
    .split(',')
    .map(origin => origin.trim().replace(/\/+$/, ''))
    .filter(Boolean);

  return Object.freeze({
    nodeEnv,
    isProduction,
    port: positiveInteger(env.PORT, 5000, { max: 65535 }),
    trustProxy: parseTrustProxy(env.TRUST_PROXY, isProduction),
    allowedOrigins: configuredOrigins.length > 0
      ? configuredOrigins
      : (isProduction ? [] : LOCAL_DEVELOPMENT_ORIGINS),
    bodyLimit: env.REQUEST_BODY_LIMIT || '100kb',
    slowRequestMs: positiveInteger(env.SLOW_REQUEST_MS, 3000, { min: 100 }),
    maxInFlightRequests: positiveInteger(env.MAX_IN_FLIGHT_REQUESTS, 250, { min: 1, max: 10000 }),
    requireRedis: booleanValue(env.REQUIRE_REDIS, isProduction),
    // Plan Review is read-only and opt-in in production. Local development can
    // exercise the feature without requiring an extra .env entry.
    agenticPlanReviewEnabled: booleanValue(env.AGENTIC_PLAN_REVIEW_ENABLED, !isProduction),
    agentPlanReview: Object.freeze({
      maxSteps: positiveInteger(env.AGENT_MAX_STEPS, 6, { min: 1, max: 6 }),
      maxToolCalls: positiveInteger(env.AGENT_MAX_TOOL_CALLS, 8, { min: 1, max: 8 }),
      maxToolCallsPerTool: positiveInteger(env.AGENT_MAX_TOOL_CALLS_PER_TOOL, 2, { min: 1, max: 2 }),
      timeoutMs: positiveInteger(env.AGENT_TIMEOUT_MS, 30000, { min: 1000, max: 60000 }),
    }),
    deepHealthTimeoutMs: positiveInteger(env.DEEP_HEALTH_TIMEOUT_MS, 3000, { min: 100, max: 30000 }),
    mongo: Object.freeze({
      flavor: getMongoFlavor(env),
      tlsCAFile: env.MONGODB_TLS_CA_FILE?.trim() || null,
      autoIndex: booleanValue(env.MONGODB_AUTO_INDEX, !isProduction),
      maxPoolSize: positiveInteger(env.MONGODB_MAX_POOL_SIZE, 50, { min: 5, max: 500 }),
      minPoolSize: positiveInteger(env.MONGODB_MIN_POOL_SIZE, isProduction ? 2 : 0, { min: 0, max: 100 }),
      serverSelectionTimeoutMs: positiveInteger(env.MONGODB_SERVER_SELECTION_TIMEOUT_MS, 10000, { min: 1000, max: 60000 }),
      socketTimeoutMs: positiveInteger(env.MONGODB_SOCKET_TIMEOUT_MS, 45000, { min: 1000, max: 300000 }),
      maxIdleTimeMs: positiveInteger(env.MONGODB_MAX_IDLE_TIME_MS, 60000, { min: 1000, max: 600000 }),
    }),
    http: Object.freeze({
      requestTimeoutMs: positiveInteger(env.HTTP_REQUEST_TIMEOUT_MS, 120000, { min: 1000 }),
      headersTimeoutMs: positiveInteger(env.HTTP_HEADERS_TIMEOUT_MS, 65000, { min: 1000 }),
      keepAliveTimeoutMs: positiveInteger(env.HTTP_KEEP_ALIVE_TIMEOUT_MS, 60000, { min: 1000 }),
      shutdownTimeoutMs: positiveInteger(env.SHUTDOWN_TIMEOUT_MS, 10000, { min: 1000, max: 60000 }),
    }),
  });
}

export function assertValidHttpTimeouts(config) {
  if (config.http.headersTimeoutMs <= config.http.keepAliveTimeoutMs) {
    throw new Error('HTTP_HEADERS_TIMEOUT_MS must be greater than HTTP_KEEP_ALIVE_TIMEOUT_MS');
  }
  if (config.http.requestTimeoutMs < config.http.headersTimeoutMs) {
    throw new Error('HTTP_REQUEST_TIMEOUT_MS must be greater than or equal to HTTP_HEADERS_TIMEOUT_MS');
  }
}

export function assertValidRuntimeConfig(config) {
  assertValidHttpTimeouts(config);
  if (config.mongo.minPoolSize > config.mongo.maxPoolSize) {
    throw new Error('MONGODB_MIN_POOL_SIZE must be less than or equal to MONGODB_MAX_POOL_SIZE');
  }
}
