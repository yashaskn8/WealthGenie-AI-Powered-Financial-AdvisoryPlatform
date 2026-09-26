import { Router } from 'express';
import mongoose from 'mongoose';
import { redisClient, redisAvailable } from '../config/redis.js';
import { checkMLHealth } from '../services/mlClient.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import logger from '../utils/logger.js';
import { verifyPersistenceIndexes } from '../services/persistenceIndexReadiness.js';
import { verifyAgentRuntimePersistence } from '../services/planHealthPersistence.js';

function withTimeout(promise, timeoutMs, label) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timeout`)), timeoutMs);
      timer.unref?.();
    }),
  ]).finally(() => clearTimeout(timer));
}

export function createHealthRouter({
  runtimeState = null,
  requireRedis = false,
  requireAgentRuntimePersistence = false,
  timeoutMs = 3000,
  verifyAgentRuntime = verifyAgentRuntimePersistence,
} = {}) {
  const router = Router();

/**
 * GET /health/deep
 * Performs a deep health check of Database, Redis, and ML microservice.
 *
 * Semantics:
 * Database and lifecycle readiness are always critical. Redis is also critical
 * when REQUIRE_REDIS is enabled (the production default). ML remains optional
 * because advisory routes have a deterministic rule-based fallback.
 */
  router.get('/deep', asyncHandler(async (req, res) => {
  // Internal tracking with criticality flag
  const checks = {
    database: { status: 'DOWN', critical: true },
    redis:    { status: 'DOWN', critical: false },
    ml:       { status: 'DOWN', critical: false },
  };

  // 1. Check MongoDB (critical)
  try {
    const isDbConnected = mongoose.connection.readyState === 1;
    if (isDbConnected) {
      await withTimeout(mongoose.connection.db.admin().ping(), timeoutMs, 'Mongo ping');
      checks.database.status = 'UP';
    }
  } catch (err) {
    logger.warn('Database health check failed', { message: err.message });
  }

  // 2. Check Redis (non-critical)
  try {
    if (redisAvailable && redisClient) {
      const pingRes = await withTimeout(redisClient.ping(), timeoutMs, 'Redis ping');
      if (pingRes === 'PONG') {
        checks.redis.status = 'UP';
      }
    }
  } catch (err) {
    logger.warn('Redis health check failed', { message: err.message });
  }

  // 3. Check ML Microservice (non-critical)
  //    Any successful HTTP response means the service is running.
  //    Possible status values from ML: "ok", "model_not_loaded", "healthy",
  //    "ready", "UP".  All indicate the process is alive.
  try {
    const mlHealth = await checkMLHealth(req.correlationId);
    if (mlHealth) {
      // ML service responded over HTTP — it is reachable and alive
      checks.ml.status = 'UP';
    }
  } catch (err) {
    logger.warn('ML service health check failed', { message: err.message });
  }

  // Determine overall status
  checks.redis.critical = requireRedis;
  const criticalDown = Object.values(checks).some(svc => svc.critical && svc.status === 'DOWN');
  const lifecycleReady = runtimeState ? runtimeState.isReady() : true;

  const allUp = Object.values(checks).every(svc => svc.status === 'UP');

  // Build backward-compatible response (flat strings for services)
  const health = {
    status: criticalDown || !lifecycleReady ? 'DOWN' : (allUp ? 'UP' : 'DEGRADED'),
    timestamp: new Date().toISOString(),
    correlationId: req.correlationId || null,
    lifecycle: runtimeState?.snapshot() || null,
    services: {
      database: checks.database.status,
      redis: checks.redis.status,
      ml: checks.ml.status,
    }
  };

  // Critical dependency or lifecycle failure triggers 503.
  res.status(criticalDown || !lifecycleReady ? 503 : 200).json(health);
  }));

/**
 * GET /health
 * Simple liveness probe for load balancer.
 */
  router.get('/', (_req, res) => {
  res.status(200).json({ status: 'UP', timestamp: new Date().toISOString() });
  });

/**
 * GET /health/ready
 * Readiness probe - returns 200 only when the database is connected and responsive.
 * Container orchestrators use this to decide when to route traffic.
 */
  router.get('/ready', asyncHandler(async (_req, res) => {
    const reasons = [];
    if (runtimeState && !runtimeState.isReady()) reasons.push(`Application lifecycle is ${runtimeState.snapshot().phase}`);
    if (mongoose.connection.readyState !== 1) reasons.push('Database not connected');
    if (requireRedis && (!redisAvailable || !redisClient?.isReady)) reasons.push('Redis not connected');
    if (mongoose.connection.readyState === 1) {
      try {
        await verifyPersistenceIndexes();
      } catch {
        reasons.push('Required persistence indexes are not ready');
      }
      if (requireAgentRuntimePersistence) {
        try {
          await verifyAgentRuntime({ force: true });
        } catch {
          reasons.push('Required agent queue-admission persistence is not ready');
        }
      }
    } else if (requireAgentRuntimePersistence) {
      reasons.push('Required agent queue-admission persistence is not ready');
    }
    if (reasons.length > 0) {
      return res.status(503).json({
        status: 'NOT_READY',
        reasons,
        lifecycle: runtimeState?.snapshot() || null,
        timestamp: new Date().toISOString(),
      });
    }
    return res.status(200).json({
      status: 'READY',
      lifecycle: runtimeState?.snapshot() || null,
      timestamp: new Date().toISOString(),
    });
  }));

/**
 * GET /health/live
 * Liveness probe - returns 200 if the process is alive.
 * Container orchestrators use this to decide whether to restart the container.
 */
  router.get('/live', (_req, res) => {
  res.status(200).json({
    status: 'ALIVE',
    uptime_seconds: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
  });
  });

  return router;
}

const router = createHealthRouter();
export default router;
