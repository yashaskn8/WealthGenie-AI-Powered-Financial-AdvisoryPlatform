import rateLimit from 'express-rate-limit';
import RedisStore from 'rate-limit-redis';
import { redisClient, redisAvailable } from '../config/redis.js';
import logger from '../utils/logger.js';
import { sendError } from './errorHandler.js';

function rateLimitHandler(message, code) {
  return (req, res) => sendError(req, res, 429, message, code);
}

class HybridStore {
  constructor(options = {}) {
    this.options = options;
    this.redisStore = null;
    this.hits = new Map();
    this.windowMs = options.windowMs || 60000;
  }

  init(options) {
    if (options && options.windowMs) {
      this.windowMs = options.windowMs;
      this.options.windowMs = options.windowMs;
    }
    if (this.redisStore && this.redisStore.init) {
      this.redisStore.init(options);
    }
  }

  getStore() {
    if (redisAvailable && redisClient) {
      if (!this.redisStore) {
        this.redisStore = new RedisStore({
          sendCommand: (...args) => {
            const flatArgs = args.flat(Infinity).filter(a => a !== undefined && a !== null).map(a => String(a));
            return redisClient.sendCommand(flatArgs);
          },
          prefix: this.options.prefix || 'rl:',
        });
        if (this.redisStore.init) {
          this.redisStore.init({ windowMs: this.windowMs });
        }
      }
      return this.redisStore;
    }
    return null;
  }

  async increment(key) {
    const store = this.getStore();
    if (store) return store.increment(key);

    const now = Date.now();
    const windowMs = this.options.windowMs || this.windowMs || 60000;
    const entry = this.hits.get(key) || { count: 0, resetTime: new Date(now + windowMs) };

    if (now > entry.resetTime.getTime()) {
      entry.count = 1;
      entry.resetTime = new Date(now + windowMs);
    } else {
      entry.count += 1;
    }

    this.hits.set(key, entry);
    return { totalHits: entry.count, resetTime: entry.resetTime };
  }

  async decrement(key) {
    const store = this.getStore();
    if (store) return store.decrement(key);
    const entry = this.hits.get(key);
    if (entry && entry.count > 0) entry.count -= 1;
  }

  async resetKey(key) {
    const store = this.getStore();
    if (store) return store.resetKey(key);
    this.hits.delete(key);
  }

  async resetAll() {
    const store = this.getStore();
    if (store && store.resetAll) {
      await store.resetAll();
    }
    this.hits.clear();
  }
}

// Strict limiter for authentication endpoints (registration, login)
// SECURITY: passOnStoreError is explicitly FALSE - auth endpoints MUST fail closed
// if the rate-limit store encounters an error to prevent brute-force attacks.
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes window
  max: 100, // High threshold for cluster tests
  message: { error: 'Authentication rate limit exceeded or store unavailable. Try again in 15 minutes.' },
  handler: rateLimitHandler(
    'Authentication rate limit exceeded or store unavailable. Try again in 15 minutes.',
    'AUTH_RATE_LIMIT_EXCEEDED',
  ),
  standardHeaders: true,
  legacyHeaders: false,
  store: new HybridStore({ prefix: 'rl:auth:', windowMs: 15 * 60 * 1000 }),
  passOnStoreError: false, // SECURITY: Fail-closed on auth store error
  validate: { singleCount: false },
  skip: () => process.env.DISABLE_RATE_LIMIT === 'true',
});

// Standard API rate limiter (protects database/CPU resource consumption)
// AVAILABILITY: passOnStoreError is TRUE - non-auth API endpoints degrade gracefully
export const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute window
  max: 1000, // High threshold for cluster load tests
  message: { error: 'Rate limit exceeded.' },
  handler: rateLimitHandler('Rate limit exceeded.', 'RATE_LIMIT_EXCEEDED'),
  store: new HybridStore({ prefix: 'rl:api:', windowMs: 60 * 1000 }),
  passOnStoreError: true, // Degrade gracefully for general read endpoints
  validate: { singleCount: false },
  skip: () => process.env.DISABLE_RATE_LIMIT === 'true',
});

// Factory function for dedicated endpoint rate limiters (Chat, Monte Carlo, Portfolio Optimisation)
export function createEndpointRateLimiter(options = {}) {
  const { windowMs = 60 * 1000, max = 10, message = 'Endpoint rate limit exceeded.' } = options;
  return rateLimit({
    windowMs,
    max,
    message: { error: 'Rate Limit Exceeded', message },
    handler: rateLimitHandler(message, 'ENDPOINT_RATE_LIMIT_EXCEEDED'),
    standardHeaders: true,
    legacyHeaders: false,
    store: new HybridStore({ prefix: 'rl:ep:', windowMs }),
    passOnStoreError: true,
    skip: () => process.env.DISABLE_RATE_LIMIT === 'true',
  });
}

export { HybridStore };
