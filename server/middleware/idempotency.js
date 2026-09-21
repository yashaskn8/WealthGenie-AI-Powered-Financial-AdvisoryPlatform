import { getCache, setCache, setCacheNX, delCache, redisAvailable } from '../config/redis.js';
import IdempotencyKey from '../models/IdempotencyKey.js';
import Recommendation from '../models/Recommendation.js';
import { canonicalSha256 } from '../utils/canonicalJson.js';
import { sendError } from './errorHandler.js';

// ARCHITECTURE: No in-memory Map. All idempotency state lives in shared infra.
// Primary: Redis (fast, atomic SET NX). Fallback: MongoDB IdempotencyKey collection.
// When BOTH are unavailable, idempotency protection is bypassed (logged).

/**
 * Idempotency Key middleware for preventing duplicate form submissions and double writes.
 * Supports a short TTL (5 minutes default) for successful responses.
 * Uses atomic SET NX (Redis) or findOneAndUpdate upsert (MongoDB) to prevent race conditions.
 *
 * STATELESS: All state is stored in shared Redis or MongoDB. No per-process fallback.
 */
export const idempotency = (ttlSeconds = 300) => {
  return async (req, res, next) => {
    const key = req.headers['idempotency-key'];
    if (!key) {
      return next();
    }

    // Standardize key by user (to prevent key collision between different users)
    const userId = req.user?.userId || 'anonymous';
    const cacheKey = `idemp:${userId}:${key}`;

    try {
      if (redisAvailable) {
        return handleRedisIdempotency(req, res, next, cacheKey, ttlSeconds);
      }
      // Fallback: MongoDB-backed idempotency
      return handleMongoIdempotency(req, res, next, cacheKey, ttlSeconds);
    } catch (err) {
      console.warn('[Idempotency] Middleware failed (proceeding without safety):', err.message);
      next();
    }
  };
};

const ADVISORY_OPERATION = 'recommendation.create';
const DEFAULT_WAIT_MS = 120000;
const POLL_INTERVAL_MS = 40;

function idempotencyError(status, message, code) {
  const error = new Error(message);
  error.status = status;
  error.clientMessage = message;
  error.code = code;
  return error;
}

function validateAdvisoryKey(key) {
  if (typeof key !== 'string' || key.length < 8 || key.length > 200
      || !/^[A-Za-z0-9._:-]+$/.test(key)) {
    throw idempotencyError(
      400,
      'A valid Idempotency-Key header (8-200 URL-safe characters) is required.',
      'INVALID_IDEMPOTENCY_KEY',
    );
  }
}

function advisoryIdentity({ userId, key }) {
  return `advisory:${canonicalSha256({ operation: ADVISORY_OPERATION, userId: String(userId), key })}`;
}

function advisoryRequestHash({ userId, profileId, payload }) {
  return canonicalSha256({
    operation: ADVISORY_OPERATION,
    userId: String(userId),
    profileId: profileId === null || profileId === undefined ? null : String(profileId),
    payload,
  });
}

function completedResponseFromRecommendation(recommendation) {
  if (!recommendation?.responseSnapshot) return null;
  return {
    status: 200,
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: recommendation.responseSnapshot,
  };
}

async function findCompletedAdvisory(operationId, requestHash) {
  const recommendation = await Recommendation.findOne({ idempotencyOperationId: operationId }).lean();
  if (!recommendation) return null;
  if (recommendation.idempotencyRequestHash !== requestHash) {
    throw idempotencyError(
      409,
      'This Idempotency-Key was already used with a different advisory request.',
      'IDEMPOTENCY_PAYLOAD_CONFLICT',
    );
  }
  const response = completedResponseFromRecommendation(recommendation);
  if (!response) {
    throw idempotencyError(500, 'Completed advisory is missing its response snapshot.', 'IDEMPOTENCY_STATE_CORRUPT');
  }
  return response;
}

async function waitForAdvisory(operationId, requestHash, waitMs) {
  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline) {
    const completed = await findCompletedAdvisory(operationId, requestHash);
    if (completed) return completed;

    const state = await IdempotencyKey.findById(operationId).lean();
    if (!state) return null;
    if (state.requestHash !== requestHash) {
      throw idempotencyError(
        409,
        'This Idempotency-Key is already bound to a different advisory request.',
        'IDEMPOTENCY_PAYLOAD_CONFLICT',
      );
    }
    if (state.status === 'DONE' && state.response) return state.response;
    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  throw idempotencyError(
    409,
    'The matching advisory request is still in progress. Retry with the same Idempotency-Key.',
    'IDEMPOTENCY_IN_PROGRESS',
  );
}

/**
 * Claims the existing Mongo-backed idempotency record for an advisory operation.
 * Completion is written by advisoryPersistence in the same transaction as the
 * Recommendation and AuditRecord. The Recommendation snapshot remains the
 * durable replay source after this short-lived coordination record expires.
 */
export async function claimAdvisoryIdempotency({
  key,
  userId,
  profileId,
  payload,
  waitMs = DEFAULT_WAIT_MS,
}) {
  validateAdvisoryKey(key);
  const operationId = advisoryIdentity({ userId, key });
  const requestHash = advisoryRequestHash({ userId, profileId, payload });

  const completed = await findCompletedAdvisory(operationId, requestHash);
  if (completed) return { state: 'REPLAY', operationId, requestHash, response: completed };

  try {
    await IdempotencyKey.create({
      _id: operationId,
      status: 'LOCK',
      operation: ADVISORY_OPERATION,
      userId,
      profileId: profileId || null,
      requestHash,
      response: null,
    });
    return { state: 'CLAIMED', operationId, requestHash };
  } catch (error) {
    if (error.code !== 11000) throw error;
    const response = await waitForAdvisory(operationId, requestHash, waitMs);
    if (response) return { state: 'REPLAY', operationId, requestHash, response };

    // A stale lock expired without a committed recommendation. One caller may
    // safely attempt to claim it again; the unique recommendation operation ID
    // remains the final duplicate barrier.
    return claimAdvisoryIdempotency({ key, userId, profileId, payload, waitMs });
  }
}

export async function releaseAdvisoryIdempotency(claim) {
  if (!claim || claim.state !== 'CLAIMED') return;
  await IdempotencyKey.deleteOne({
    _id: claim.operationId,
    status: 'LOCK',
    requestHash: claim.requestHash,
  });
}

/**
 * Redis-backed idempotency using atomic SET NX.
 */
async function handleRedisIdempotency(req, res, next, cacheKey, ttlSeconds) {
  // Attempt atomic lock: SET key "LOCK" NX EX 10
  const acquired = await setCacheNX(cacheKey, 'LOCK', 10);

  if (!acquired) {
    const cached = await getCache(cacheKey);

    if (!cached || cached === 'LOCK') {
      return sendError(
        req,
        res,
        409,
        'A duplicate request is already in progress. Please wait.',
        'IDEMPOTENCY_IN_PROGRESS',
      );
    }

    // Return original cached response
    res.status(cached.status);
    if (cached.headers) {
      for (const [hk, hv] of Object.entries(cached.headers)) {
        res.setHeader(hk, hv);
      }
    }
    res.setHeader('X-Cache-Lookup', 'HIT - Idempotent');
    return res.send(cached.body);
  }

  // Lock acquired — intercept res.send to save response
  const originalSend = res.send;
  res.send = function (body) {
    if (res.statusCode >= 200 && res.statusCode < 300) {
      const responseData = {
        status: res.statusCode,
        headers: { 'content-type': res.getHeader('content-type') },
        body: body
      };
      setCache(cacheKey, responseData, ttlSeconds).catch(() => {});
    } else {
      delCache(cacheKey).catch(() => {});
    }
    return originalSend.apply(this, arguments);
  };

  next();
}

/**
 * MongoDB-backed idempotency fallback using findOneAndUpdate with upsert.
 * Uses the IdempotencyKey model with a TTL index for automatic cleanup.
 */
async function handleMongoIdempotency(req, res, next, cacheKey, ttlSeconds) {
  try {
    // Attempt atomic lock via insert — MongoDB E11000 duplicate key error = already exists
    await IdempotencyKey.create({ _id: cacheKey, status: 'LOCK', response: null });

    // Lock acquired — intercept res.send to save response in MongoDB BEFORE sending
    const originalSend = res.send;
    res.send = function (body) {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        const responseData = {
          status: res.statusCode,
          headers: { 'content-type': res.getHeader('content-type') },
          body: body
        };
        // Await write to MongoDB before sending response to ensure
        // subsequent requests see the cached response (not LOCK).
        IdempotencyKey.findByIdAndUpdate(cacheKey, {
          status: 'DONE',
          response: responseData
        }).catch(() => {}).finally(() => {
          originalSend.call(res, body);
        });
        return res;
      } else {
        IdempotencyKey.findByIdAndDelete(cacheKey).catch(() => {});
        return originalSend.apply(this, arguments);
      }
    };

    next();
  } catch (err) {
    if (err.code === 11000) {
      // Document already exists — check if it has a cached response
      const doc = await IdempotencyKey.findById(cacheKey).lean();

      if (!doc || doc.status === 'LOCK') {
        return sendError(
          req,
          res,
          409,
          'A duplicate request is already in progress. Please wait.',
          'IDEMPOTENCY_IN_PROGRESS',
        );
      }

      // Return cached response
      const cached = doc.response;
      res.status(cached.status);
      if (cached.headers) {
        for (const [hk, hv] of Object.entries(cached.headers)) {
          res.setHeader(hk, hv);
        }
      }
      res.setHeader('X-Cache-Lookup', 'HIT - Idempotent');
      return res.send(cached.body);
    }

    console.warn('[Idempotency] MongoDB fallback failed (proceeding without safety):', err.message);
    next();
  }
}
