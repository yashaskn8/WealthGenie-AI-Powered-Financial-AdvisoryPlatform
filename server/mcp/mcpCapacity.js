import { createHash, randomUUID } from 'node:crypto';
import { redisAvailable, redisClient } from '../config/redis.js';
import logger from '../utils/logger.js';

const RATE_SCRIPT = `
local redisTime = redis.call('TIME')
local now = tonumber(redisTime[1]) * 1000 + math.floor(tonumber(redisTime[2]) / 1000)
local windowMs = tonumber(ARGV[1])
local bucket = math.floor(now / windowMs)
local key = KEYS[1] .. ':' .. bucket
local hits = redis.call('INCR', key)
if hits == 1 then redis.call('PEXPIRE', key, windowMs) end
return { hits, redis.call('PTTL', key), key }
`;

const ACQUIRE_SCRIPT = `
local redisTime = redis.call('TIME')
local now = tonumber(redisTime[1]) * 1000 + math.floor(tonumber(redisTime[2]) / 1000)
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now)
redis.call('ZREMRANGEBYSCORE', KEYS[2], '-inf', now)
local userCount = redis.call('ZCARD', KEYS[1])
local globalCount = redis.call('ZCARD', KEYS[2])
if userCount >= tonumber(ARGV[1]) or globalCount >= tonumber(ARGV[2]) then return 0 end
local expiresAt = now + tonumber(ARGV[3])
redis.call('ZADD', KEYS[1], expiresAt, ARGV[4])
redis.call('ZADD', KEYS[2], expiresAt, ARGV[4])
redis.call('PEXPIRE', KEYS[1], ARGV[3])
redis.call('PEXPIRE', KEYS[2], ARGV[3])
return 1
`;

const RELEASE_SCRIPT = `
local removed = redis.call('ZREM', KEYS[1], ARGV[1])
redis.call('ZREM', KEYS[2], ARGV[1])
return removed
`;

const RENEW_SCRIPT = `
local redisTime = redis.call('TIME')
local now = tonumber(redisTime[1]) * 1000 + math.floor(tonumber(redisTime[2]) / 1000)
local userScore = redis.call('ZSCORE', KEYS[1], ARGV[1])
local globalScore = redis.call('ZSCORE', KEYS[2], ARGV[1])
if not userScore or not globalScore or tonumber(userScore) ~= tonumber(globalScore) or tonumber(userScore) <= now then return 0 end
local expiresAt = now + tonumber(ARGV[2])
redis.call('ZADD', KEYS[1], 'XX', expiresAt, ARGV[1])
redis.call('ZADD', KEYS[2], 'XX', expiresAt, ARGV[1])
redis.call('PEXPIRE', KEYS[1], ARGV[2])
redis.call('PEXPIRE', KEYS[2], ARGV[2])
return 1
`;

const REDIS_PREFIX = 'wg:{mcp}:capacity:';
const MAX_LOCAL_IDENTITIES = 10000;

export class McpCapacityError extends Error {
  constructor(code, status = 429) {
    super(code === 'MCP_CAPACITY_UNAVAILABLE'
      ? 'MCP capacity could not be verified.'
      : 'MCP request capacity is exhausted.');
    this.name = 'McpCapacityError';
    this.code = code;
    this.status = status;
  }
}

function principalHash(userId) {
  return createHash('sha256').update(String(userId)).digest('hex');
}

function redisResult(result) {
  const count = Number(result?.[0]);
  const ttl = Number(result?.[1]);
  if (!Number.isSafeInteger(count) || count < 1 || !Number.isFinite(ttl) || ttl < 0) {
    throw new Error('Malformed distributed MCP capacity response.');
  }
  return count;
}

export function createMcpCapacityController({
  config,
  env = process.env,
  getRedisState = () => ({ available: redisAvailable, client: redisClient }),
  now = () => Date.now(),
  scheduleHeartbeat = setInterval,
  cancelHeartbeat = clearInterval,
  keyPrefix = REDIS_PREFIX,
  local = { windows: new Map(), perUser: new Map(), global: 0 },
} = {}) {
  if (!config) throw new TypeError('MCP capacity config is required.');
  const production = env.NODE_ENV === 'production' || config.isProduction;
  let capacityHealthy = true;
  let readinessCache = { expiresAt: 0, ready: false };

  function pruneWindows() {
    const time = now();
    for (const [key, entry] of local.windows) {
      if (entry.expiresAt <= time) local.windows.delete(key);
    }
  }

  async function consumeWindow(keySuffix, limit) {
    if (!capacityHealthy) throw new McpCapacityError('MCP_CAPACITY_UNAVAILABLE', 503);
    const key = `${keyPrefix}rate:${keySuffix}`;
    const redis = getRedisState();
    if (redis?.available && redis.client) {
      let count;
      try {
        count = redisResult(await redis.client.eval(RATE_SCRIPT, {
          keys: [key],
          arguments: [String(config.rateWindowMs)],
        }));
      } catch {
        logger.warn('MCP distributed request budget failed closed', { code: 'MCP_CAPACITY_UNAVAILABLE' });
        throw new McpCapacityError('MCP_CAPACITY_UNAVAILABLE', 503);
      }
      return count <= limit;
    }
    if (production) throw new McpCapacityError('MCP_CAPACITY_UNAVAILABLE', 503);

    pruneWindows();
    const bucket = Math.floor(now() / config.rateWindowMs);
    const localKey = `${keySuffix}:${bucket}`;
    if (!local.windows.has(localKey) && local.windows.size >= MAX_LOCAL_IDENTITIES) {
      throw new McpCapacityError('MCP_CAPACITY_UNAVAILABLE', 503);
    }
    const entry = local.windows.get(localKey) || { count: 0, expiresAt: (bucket + 1) * config.rateWindowMs };
    entry.count += 1;
    local.windows.set(localKey, entry);
    return entry.count <= limit;
  }

  async function checkRequest(userId) {
    if (!userId) throw new McpCapacityError('MCP_CAPACITY_UNAVAILABLE', 503);
    const allowed = await consumeWindow(
      `request:${principalHash(userId)}`,
      config.maxRequestsPerWindow,
    );
    if (!allowed) throw new McpCapacityError('MCP_CAPACITY_EXCEEDED', 429);
  }

  async function acquireToolPermit(userId, toolName, costClass) {
    if (!capacityHealthy) throw new McpCapacityError('MCP_CAPACITY_UNAVAILABLE', 503);
    if (!userId || !/^[a-z][a-z0-9_]{0,63}$/.test(toolName) || !['LOW', 'MEDIUM', 'HIGH'].includes(costClass)) {
      throw new McpCapacityError('MCP_CAPACITY_UNAVAILABLE', 503);
    }
    const hashedPrincipal = principalHash(userId);
    const quota = config.maxToolCallsPerWindow[costClass];
    // Cost-class limits are aggregate for the principal, not separate budgets
    // per tool. Otherwise rotating among several LOW tools could bypass the
    // configured LOW call ceiling.
    const allowed = await consumeWindow(`tool:${hashedPrincipal}:${costClass}`, quota);
    if (!allowed) throw new McpCapacityError('MCP_CAPACITY_EXCEEDED', 429);

    const userKey = `${keyPrefix}concurrent:user:${hashedPrincipal}`;
    const globalKey = `${keyPrefix}concurrent:global`;
    const redis = getRedisState();
    if (redis?.available && redis.client) {
      let acquired;
      const permitToken = randomUUID();
      try {
        acquired = Number(await redis.client.eval(ACQUIRE_SCRIPT, {
          keys: [userKey, globalKey],
          arguments: [
            String(config.maxConcurrentPerUser),
            String(config.maxConcurrentGlobal),
            String(config.permitTtlMs),
            permitToken,
          ],
        }));
        if (acquired !== 0 && acquired !== 1) throw new Error('Malformed distributed MCP permit response.');
      } catch {
        logger.warn('MCP distributed concurrency permit failed closed', { code: 'MCP_CAPACITY_UNAVAILABLE' });
        throw new McpCapacityError('MCP_CAPACITY_UNAVAILABLE', 503);
      }
      if (!acquired) throw new McpCapacityError('MCP_CAPACITY_EXCEEDED', 429);
      let released = false;
      let activeRenewal = null;
      const controller = new AbortController();
      const renewalEveryMs = Math.max(10, Math.floor(config.permitTtlMs / 3));
      const renew = async () => {
        if (released || activeRenewal) return activeRenewal;
        activeRenewal = (async () => {
          const result = Number(await redis.client.eval(RENEW_SCRIPT, {
            keys: [userKey, globalKey],
            arguments: [permitToken, String(config.permitTtlMs)],
          }));
          if (result !== 1) throw new Error('MCP permit ownership was lost before renewal.');
        })();
        try {
          await activeRenewal;
          return true;
        } catch {
          capacityHealthy = false;
          controller.abort(Object.assign(new McpCapacityError('MCP_CAPACITY_UNAVAILABLE', 503), {
            code: 'MCP_CAPACITY_LEASE_LOST',
          }));
          logger.error('MCP distributed permit lease renewal was lost; capacity is unhealthy', { code: 'MCP_CAPACITY_LEASE_LOST' });
          return false;
        } finally {
          activeRenewal = null;
        }
      };
      const heartbeat = scheduleHeartbeat(() => { void renew(); }, renewalEveryMs);
      heartbeat?.unref?.();
      const release = async () => {
        if (released) return false;
        released = true;
        cancelHeartbeat(heartbeat);
        if (activeRenewal) await activeRenewal.catch(() => {});
        try {
          const result = await redis.client.eval(RELEASE_SCRIPT, {
            keys: [userKey, globalKey],
            arguments: [permitToken],
          });
          return Number(result) === 1;
        } catch {
          // The bounded lease TTL is the crash/release recovery mechanism.
          logger.warn('MCP permit release deferred to bounded lease expiry', { code: 'MCP_CAPACITY_RELEASE_DEFERRED' });
          return false;
        }
      };
      release.signal = controller.signal;
      release.token = permitToken;
      return release;
    }

    if (production) throw new McpCapacityError('MCP_CAPACITY_UNAVAILABLE', 503);
    if (local.global >= config.maxConcurrentGlobal) throw new McpCapacityError('MCP_CAPACITY_EXCEEDED', 429);
    const userCount = local.perUser.get(hashedPrincipal) || 0;
    if (userCount >= config.maxConcurrentPerUser) throw new McpCapacityError('MCP_CAPACITY_EXCEEDED', 429);
    local.global += 1;
    local.perUser.set(hashedPrincipal, userCount + 1);
    let released = false;
    return async () => {
      if (released) return false;
      released = true;
      local.global = Math.max(0, local.global - 1);
      const current = local.perUser.get(hashedPrincipal) || 0;
      if (current <= 1) local.perUser.delete(hashedPrincipal);
      else local.perUser.set(hashedPrincipal, current - 1);
      return true;
    };
  }

  return Object.freeze({
    checkRequest,
    acquireToolPermit,
    async probe() {
      if (!config.enabled || !config.remoteEnabled || !production) return true;
      const redis = getRedisState();
      if (!redis?.available || !redis.client || redis.client.isReady === false) {
        capacityHealthy = false;
        return false;
      }
      if (readinessCache.expiresAt > now()) return readinessCache.ready;
      const probeId = randomUUID();
      const prefix = `${keyPrefix}health:${probeId}:`;
      const userKey = `${prefix}user`;
      const globalKey = `${prefix}global`;
      const cleanupKeys = [userKey, globalKey];
      let probeSucceeded = false;
      try {
        await redis.client.get(`${prefix}revocation`);
        const rateResult = await redis.client.eval(RATE_SCRIPT, {
          keys: [`${prefix}rate`],
          arguments: [String(Math.max(1000, config.rateWindowMs))],
        });
        if (redisResult(rateResult) !== 1 || typeof rateResult?.[2] !== 'string') {
          throw new Error('MCP rate contract probe returned an invalid shape.');
        }
        cleanupKeys.push(rateResult[2]);
        const token = randomUUID();
        const acquired = Number(await redis.client.eval(ACQUIRE_SCRIPT, {
          keys: [userKey, globalKey],
          arguments: ['1', '1', String(config.permitTtlMs), token],
        }));
        if (acquired !== 1) throw new Error('MCP acquire contract probe failed.');
        const renewed = Number(await redis.client.eval(RENEW_SCRIPT, {
          keys: [userKey, globalKey], arguments: [token, String(config.permitTtlMs)],
        }));
        if (renewed !== 1) throw new Error('MCP renew contract probe failed.');
        const released = Number(await redis.client.eval(RELEASE_SCRIPT, {
          keys: [userKey, globalKey], arguments: [token],
        }));
        if (released !== 1) throw new Error('MCP release contract probe failed.');
        capacityHealthy = true;
        readinessCache = { expiresAt: now() + 2000, ready: true };
        probeSucceeded = true;
      } catch {
        capacityHealthy = false;
        readinessCache = { expiresAt: now() + 1000, ready: false };
      } finally {
        try {
          await redis.client.del(...cleanupKeys);
        } catch {
          capacityHealthy = false;
          readinessCache = { expiresAt: now() + 1000, ready: false };
        }
      }
      return probeSucceeded && capacityHealthy && readinessCache.ready;
    },
    isReady() {
      if (!config.enabled || !config.remoteEnabled || !production) return true;
      const redis = getRedisState();
      return capacityHealthy && readinessCache.ready && readinessCache.expiresAt > now()
        && Boolean(redis?.available && redis.client?.isReady !== false);
    },
  });
}
