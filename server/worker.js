import 'dotenv/config';
import tracingSdk from './config/tracing.js';
import mongoose from 'mongoose';
import connectDB from './config/db.js';
import { connectRedis, redisAvailable, redisClient } from './config/redis.js';
import { getRuntimeConfig, assertValidRuntimeConfig } from './config/runtime.js';
import { validateEnvironmentConfig } from './config/validateEnv.js';
import { createPlanReviewWorker } from './agents/planReview/planReviewWorker.js';
import AgentRunEvent from './models/AgentRunEvent.js';
import { createWorkerHealthServer } from './services/workerHealthServer.js';
import { verifyPlanReviewPersistenceIndexes } from './services/planReviewPersistence.js';
import { startPlanHealthScheduler, stopPlanHealthScheduler } from './services/planHealthScheduler.js';
import logger from './utils/logger.js';

let healthServer = null;
let worker = null;
let stopping = false;

async function closeWorkerInfrastructure(config) {
  await stopPlanHealthScheduler();
  if (worker) await worker.stop({ graceMs: config.agentPlanReview.shutdownGraceMs });
  worker = null;
  await healthServer?.close().catch(() => {});
  healthServer = null;
  const closers = [];
  if (mongoose.connection.readyState !== 0) closers.push(mongoose.connection.close());
  if (redisClient?.isOpen) closers.push(redisClient.quit());
  closers.push(tracingSdk.shutdown());
  await Promise.allSettled(closers);
}

export async function startWorker({ env = process.env } = {}) {
  const validation = validateEnvironmentConfig(env);
  if (!validation.valid) throw new Error(`Invalid environment configuration: ${validation.errors.join('; ')}`);
  const config = getRuntimeConfig(env);
  assertValidRuntimeConfig(config);
  if (config.agentWorkerMode !== 'external') throw new Error('The standalone worker requires AGENT_WORKER_MODE=external');

  await connectDB({
    uri: env.MONGODB_URI,
    env,
    options: {
      autoIndex: config.mongo.autoIndex,
      maxPoolSize: config.mongo.maxPoolSize,
      minPoolSize: config.mongo.minPoolSize,
      serverSelectionTimeoutMS: config.mongo.serverSelectionTimeoutMs,
      socketTimeoutMS: config.mongo.socketTimeoutMs,
      maxIdleTimeMS: config.mongo.maxIdleTimeMs,
    },
    requireTransactions: true,
  });
  if (config.agenticPlanReviewEnabled) await verifyPlanReviewPersistenceIndexes();
  await connectRedis({ url: env.REDIS_URL });
  if (config.requireRedis && !redisAvailable) throw new Error('Redis is required in this environment but is unavailable');

  worker = createPlanReviewWorker({ runtimeConfig: config, eventModel: AgentRunEvent });
  worker.start({ intervalMs: Number(env.AGENT_WORKER_POLL_MS) || 500 });
  if (config.planHealth.enabled) startPlanHealthScheduler({ config: config.planHealth });
  healthServer = createWorkerHealthServer({
    port: config.agentPlanReview.healthPort,
    stateProvider: () => worker?.state(),
    requireRedis: config.requireRedis,
    requirePlanReviewIndexes: config.agenticPlanReviewEnabled,
  });
  await healthServer.listen();
  logger.info('WealthGenie agent worker started', { healthPort: config.agentPlanReview.healthPort });
  return { worker, healthServer };
}

export async function stopWorker({ config = getRuntimeConfig(process.env), signal = 'manual' } = {}) {
  if (stopping) return;
  stopping = true;
  logger.info('Agent worker shutdown initiated', { signal });
  try {
    await closeWorkerInfrastructure(config);
    logger.info('Agent worker shutdown completed', { signal });
  } finally {
    stopping = false;
  }
}

const isMainModule = process.argv[1] && process.argv[1].endsWith('worker.js');
if (isMainModule && process.env.NODE_ENV !== 'test') {
  let config = null;
  const terminate = async (signal, error = null) => {
    if (error) logger.error('Agent worker fatal error', { signal, message: error.message });
    try {
      await stopWorker({ config: config || getRuntimeConfig(process.env), signal });
      process.exit(error ? 1 : 0);
    } catch (shutdownError) {
      logger.error('Agent worker forced shutdown', { signal, message: shutdownError.message });
      process.exit(1);
    }
  };
  process.once('SIGTERM', () => void terminate('SIGTERM'));
  process.once('SIGINT', () => void terminate('SIGINT'));
  process.once('uncaughtException', error => void terminate('uncaughtException', error));
  process.once('unhandledRejection', reason => void terminate('unhandledRejection', reason instanceof Error ? reason : new Error(String(reason))));
  startWorker().then(() => { config = getRuntimeConfig(process.env); }).catch(error => void terminate('startup', error));
}
