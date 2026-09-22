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

function enumValue(value, fallback, allowed) {
  const normalized = String(value || fallback).trim().toLowerCase();
  return allowed.includes(normalized) ? normalized : fallback;
}

export function getRuntimeConfig(env = process.env) {
  const nodeEnv = env.NODE_ENV || 'development';
  const isProduction = nodeEnv === 'production';
  const configuredOrigins = (env.CORS_ORIGINS || '')
    .split(',')
    .map(origin => origin.trim().replace(/\/+$/, ''))
    .filter(Boolean);

  const agentWorkerMode = enumValue(
    env.AGENT_WORKER_MODE,
    isProduction ? 'external' : 'embedded',
    ['embedded', 'external'],
  );
  const agentIdentityProvider = enumValue(env.AGENT_IDENTITY_PROVIDER, 'development', ['development', 'oidc', 'spiffe']);
  const agentWorkflowBackend = enumValue(env.AGENT_WORKFLOW_BACKEND, 'mongo', ['mongo', 'temporal']);
  const agentApprovalProvider = enumValue(env.AGENT_APPROVAL_PROVIDER, isProduction ? 'webauthn' : 'development', ['development', 'webauthn']);
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
    agentWorkerEnabled: booleanValue(env.AGENT_WORKER_ENABLED, true),
    agentWorkerMode,
    agentIdentityProvider,
    agentWorkflowBackend,
    agentStreamEnabled: booleanValue(env.AGENT_STREAM_ENABLED, !isProduction),
    agentEvolutionEnabled: booleanValue(env.AGENT_EVOLUTION_ENABLED, false),
    agentResearchEnabled: booleanValue(env.AGENT_RESEARCH_ENABLED, false),
    authorization: Object.freeze({
      verifiableActionsEnabled: booleanValue(env.AGENT_VERIFIABLE_ACTIONS_ENABLED, false),
      webauthnApprovalEnabled: booleanValue(env.AGENT_WEBAUTHN_APPROVAL_ENABLED, false),
      ap2ResearchEnabled: booleanValue(env.AGENT_AP2_RESEARCH_ENABLED, false),
      approvalProvider: agentApprovalProvider,
      webauthnOrigin: env.WEBAUTHN_ORIGIN?.trim() || null,
      webauthnRpId: env.WEBAUTHN_RP_ID?.trim() || null,
      mandateTtlSeconds: positiveInteger(env.AGENT_MANDATE_TTL_SECONDS, 300, { min: 1, max: 900 }),
    }),
    agentPlanReview: Object.freeze({
      maxSteps: positiveInteger(env.AGENT_MAX_STEPS, 6, { min: 1, max: 6 }),
      maxToolCalls: positiveInteger(env.AGENT_MAX_TOOL_CALLS, 8, { min: 1, max: 8 }),
      maxToolCallsPerTool: positiveInteger(env.AGENT_MAX_TOOL_CALLS_PER_TOOL, 2, { min: 1, max: 2 }),
      timeoutMs: positiveInteger(env.AGENT_TIMEOUT_MS, 30000, { min: 1000, max: 60000 }),
      maxAttempts: positiveInteger(env.AGENT_MAX_ATTEMPTS, 2, { min: 1, max: 2 }),
      maxModelCalls: positiveInteger(env.AGENT_MAX_MODEL_CALLS, 2, { min: 0, max: 2 }),
      maxInputTokens: positiveInteger(env.AGENT_MAX_INPUT_TOKENS, 4000, { min: 1, max: 4000 }),
      maxOutputTokens: positiveInteger(env.AGENT_MAX_OUTPUT_TOKENS, 1200, { min: 1, max: 1200 }),
      maxTotalTokens: positiveInteger(env.AGENT_MAX_TOTAL_TOKENS, 5200, { min: 1, max: 5200 }),
      leaseMs: positiveInteger(env.AGENT_LEASE_MS, 60000, { min: 10000, max: 300000 }),
      heartbeatMs: positiveInteger(env.AGENT_HEARTBEAT_MS, 15000, { min: 1000, max: 100000 }),
      shutdownGraceMs: positiveInteger(env.AGENT_SHUTDOWN_GRACE_MS, 10000, { min: 1000, max: 60000 }),
      maxQueuedRunsPerUser: positiveInteger(env.MAX_QUEUED_AGENT_RUNS_PER_USER, 3, { min: 1, max: 100 }),
      maxActiveRunsPerUser: positiveInteger(env.MAX_ACTIVE_AGENT_RUNS_PER_USER, 1, { min: 1, max: 20 }),
      maxGlobalQueuedRuns: positiveInteger(env.MAX_GLOBAL_QUEUED_RUNS, 1000, { min: 1, max: 100000 }),
      queuePriority: 'INTERACTIVE_PLAN_REVIEW',
      healthPort: positiveInteger(env.AGENT_WORKER_HEALTH_PORT, 5050, { min: 1024, max: 65535 }),
    }),
    planHealth: Object.freeze({
      enabled: booleanValue(env.PLAN_HEALTH_SCHEDULER_ENABLED, true),
      batchSize: positiveInteger(env.PLAN_HEALTH_BATCH_SIZE, 100, { min: 1, max: 1000 }),
      intervalMs: positiveInteger(env.PLAN_HEALTH_INTERVAL_MS, 86400000, { min: 3600000, max: 604800000 }),
      leaseMs: positiveInteger(env.PLAN_HEALTH_LEASE_MS, 300000, { min: 30000, max: 3600000 }),
      jitterMs: positiveInteger(env.PLAN_HEALTH_JITTER_MS, 900000, { min: 0, max: 3600000 }),
      concurrency: positiveInteger(env.PLAN_HEALTH_CONCURRENCY, 4, { min: 1, max: 20 }),
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
  if (config.isProduction && config.agentWorkerMode !== 'external') {
    throw new Error('AGENT_WORKER_MODE must be external in production');
  }
  if (config.authorization.verifiableActionsEnabled && config.isProduction) {
    if (!config.authorization.webauthnApprovalEnabled || config.authorization.approvalProvider !== 'webauthn') {
      throw new Error('Production verifiable actions require WebAuthn approval and no development provider.');
    }
    if (!config.authorization.webauthnOrigin || !config.authorization.webauthnRpId) {
      throw new Error('Production WebAuthn approval requires WEBAUTHN_ORIGIN and WEBAUTHN_RP_ID');
    }
  }
  if (config.agentWorkerMode === 'embedded' && config.agentWorkerEnabled === false) {
    return;
  }
  if (config.agentPlanReview.heartbeatMs >= config.agentPlanReview.leaseMs) {
    throw new Error('AGENT_HEARTBEAT_MS must be less than AGENT_LEASE_MS');
  }
}
