import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import rateLimit from 'express-rate-limit';
import {
  isTokenBlacklisted,
  setRedisAvailable,
  setRedisClient,
  setForceFailClosedInTest,
} from '../config/redis.js';

describe('CLAIM 3 (Step 3) — Fail-Closed Security & Resilient Degrade Suite', () => {

  afterEach(() => {
    setRedisAvailable(false);
    setRedisClient(null);
    setForceFailClosedInTest(false);
  });

  it('1. Token Blacklist FAILS CLOSED (denies access) when Redis is disconnected/unavailable', async () => {
    setRedisAvailable(false);
    setRedisClient(null);
    setForceFailClosedInTest(true);

    await assert.rejects(
      isTokenBlacklisted('some-user-jti-during-outage'),
      { code: 'TOKEN_REVOCATION_UNAVAILABLE' },
      'Token blacklist check MUST fail closed with an explicit unavailable result',
    );
  });

  it('2. Token Blacklist correctly checks Redis when Redis is connected and available', async () => {
    const mockStore = new Map();
    mockStore.set('bl:revoked-jti-123', 'revoked');

    const mockClient = {
      get: async (key) => mockStore.get(key) || null,
    };

    setRedisAvailable(true);
    setRedisClient(mockClient);
    setForceFailClosedInTest(true);

    const isRevoked = await isTokenBlacklisted('revoked-jti-123');
    assert.equal(isRevoked, true, 'Revoked token in Redis must be identified as blacklisted');

    const isValid = await isTokenBlacklisted('valid-live-jti-456');
    assert.equal(isValid, false, 'Non-blacklisted token must be allowed');
  });

  it('3. Token Blacklist FAILS CLOSED on unexpected Redis query exception', async () => {
    const brokenClient = {
      get: async () => {
        throw new Error('ECONNRESET Connection reset by peer');
      },
    };

    setRedisAvailable(true);
    setRedisClient(brokenClient);
    setForceFailClosedInTest(true);

    await assert.rejects(
      isTokenBlacklisted('any-jti-under-error'),
      { code: 'TOKEN_REVOCATION_UNAVAILABLE' },
      'Must fail closed on Redis query exception',
    );
  });

  it('4. authLimiter enforces passOnStoreError: false (fails closed on store errors)', async () => {
    class FailingStore {
      async increment() { throw new Error('Auth Redis Store Offline'); }
      async decrement() {}
      async resetKey() {}
      async resetAll() {}
    }

    const testAuthLimiter = rateLimit({
      store: new FailingStore(),
      passOnStoreError: false,
      max: 10,
      windowMs: 60000,
      validate: false,
    });

    const req = { ip: '127.0.0.1', headers: {}, app: { get: () => false } };
    const res = { setHeader: () => {}, getHeader: () => {} };

    let passedError = null;
    await new Promise((resolve) => {
      testAuthLimiter(req, res, (err) => {
        passedError = err;
        resolve();
      });
    });

    assert.ok(passedError, 'authLimiter MUST propagate error to next() when store fails');
    assert.equal(passedError.message, 'Auth Redis Store Offline');
  });

  it('5. apiLimiter enforces passOnStoreError: true (degrades gracefully on store errors)', async () => {
    class FailingStore {
      async increment() { throw new Error('API Redis Store Offline'); }
      async decrement() {}
      async resetKey() {}
      async resetAll() {}
    }

    const testApiLimiter = rateLimit({
      store: new FailingStore(),
      passOnStoreError: true,
      max: 100,
      windowMs: 60000,
      validate: false,
    });

    const req = { ip: '127.0.0.1', headers: {}, app: { get: () => false } };
    const res = { setHeader: () => {}, getHeader: () => {} };

    let passedError = null;
    await new Promise((resolve) => {
      testApiLimiter(req, res, (err) => {
        passedError = err;
        resolve();
      });
    });

    assert.equal(passedError, undefined, 'apiLimiter MUST NOT propagate error when store fails (degrade gracefully)');
  });
});
