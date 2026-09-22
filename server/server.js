import 'dotenv/config';
import tracingSdk from './config/tracing.js';
import { createServer as createHttpServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';
import { createApp } from './app.js';
import connectDB from './config/db.js';
import { connectRedis, redisAvailable, redisClient } from './config/redis.js';
import { getRuntimeConfig, assertValidRuntimeConfig } from './config/runtime.js';
import { validateEnvironmentConfig } from './config/validateEnv.js';
import { startMarketDataRefreshJobs, stopMarketDataRefreshJobs } from './jobs/marketDataRefresh.js';
import { startPlanReviewWorker, stopPlanReviewWorker } from './agents/planReview/planReviewWorker.js';
import logger from './utils/logger.js';
import { createRuntimeState } from './services/runtimeState.js';
import { warmAdvisoryPersistence } from './services/advisoryPersistence.js';
import AgentRunEvent from './models/AgentRunEvent.js';
import { warmAuthorizationPersistence } from './services/authorizationPersistence.js';

let server = null;
let shuttingDown = false;
let processHandlersInstalled = false;
const runtimeState = createRuntimeState();
let activeConfig = null;

function configureHttpServer(httpServer, config) {
  httpServer.requestTimeout = config.http.requestTimeoutMs;
  httpServer.headersTimeout = config.http.headersTimeoutMs;
  httpServer.keepAliveTimeout = config.http.keepAliveTimeoutMs;
  httpServer.maxRequestsPerSocket = 1000;
}

function closeHttpServer(httpServer) {
  if (!httpServer?.listening) return Promise.resolve();
  return new Promise((resolve, reject) => {
    httpServer.close(error => error ? reject(error) : resolve());
    httpServer.closeIdleConnections?.();
  });
}

async function closeInfrastructure({ stopAgentWorker = false } = {}) {
  stopMarketDataRefreshJobs();
  if (stopAgentWorker) await stopPlanReviewWorker();
  const closers = [];
  if (mongoose.connection.readyState !== 0) closers.push(mongoose.connection.close());
  if (redisClient?.isOpen) closers.push(redisClient.quit());
  closers.push(tracingSdk.shutdown());
  await Promise.allSettled(closers);
}

export async function startServer({ env = process.env } = {}) {
  if (server) return server;
  const validation = validateEnvironmentConfig(env);
  if (!validation.valid) {
    throw new Error(`Invalid environment configuration: ${validation.errors.join('; ')}`);
  }

  const config = getRuntimeConfig(env);
  assertValidRuntimeConfig(config);
  activeConfig = config;
  runtimeState.markStarting();

  try {
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
      // Profile completion persists the profile, recommendation, audit record,
      // and idempotency result atomically. Fail startup early if the local or
      // deployed MongoDB is not transaction-capable instead of returning a
      // 503 only after a user submits the profile.
      requireTransactions: true,
    });
    await warmAdvisoryPersistence();
    if (config.authorization.verifiableActionsEnabled) await warmAuthorizationPersistence();
    await connectRedis({ url: env.REDIS_URL });
    if (config.requireRedis && !redisAvailable) {
      throw new Error('Redis is required in this environment but is unavailable');
    }

    const app = createApp({ env, runtimeState });
    server = createHttpServer(app);
    configureHttpServer(server, config);
    await new Promise((resolve, reject) => {
      const onError = error => {
        server?.off('listening', onListening);
        reject(error);
      };
      const onListening = () => {
        server?.off('error', onError);
        resolve();
      };
      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(config.port);
    });
    startMarketDataRefreshJobs();
    if (config.agentWorkerEnabled && config.agentWorkerMode === 'embedded') {
      startPlanReviewWorker({ runtimeConfig: config, eventModel: AgentRunEvent });
    }
    runtimeState.markReady();
    logger.info('WealthGenie API started', { port: config.port, env: config.nodeEnv });
    return server;
  } catch (error) {
    runtimeState.markStopped();
    await closeHttpServer(server).catch(() => {});
    server = null;
    await closeInfrastructure({ stopAgentWorker: config.agentWorkerMode === 'embedded' });
    throw error;
  }
}

export async function stopServer({ signal = 'manual', timeoutMs } = {}) {
  if (shuttingDown) return;
  shuttingDown = true;
  runtimeState.markDraining();
  const config = activeConfig || getRuntimeConfig(process.env);
  const deadlineMs = timeoutMs || config.http.shutdownTimeoutMs;
  logger.info('Graceful shutdown initiated', { signal, deadlineMs });

  let deadlineTimer;
  const deadline = new Promise((_, reject) => {
    deadlineTimer = setTimeout(() => {
      server?.closeAllConnections?.();
      reject(new Error('Graceful shutdown timed out'));
    }, deadlineMs);
    deadlineTimer.unref?.();
  });

  try {
    await Promise.race([
      (async () => {
        await closeHttpServer(server);
        await closeInfrastructure({ stopAgentWorker: config.agentWorkerMode === 'embedded' });
      })(),
      deadline,
    ]);
    logger.info('Graceful shutdown completed', { signal });
  } finally {
    clearTimeout(deadlineTimer);
    runtimeState.markStopped();
    server = null;
    activeConfig = null;
    shuttingDown = false;
  }
}

async function terminate(signal, error = null) {
  if (error) logger.error('Fatal process error', { signal, message: error.message, stack: error.stack });
  try {
    await stopServer({ signal });
    process.exit(error ? 1 : 0);
  } catch (shutdownError) {
    logger.error('Forced shutdown', { signal, message: shutdownError.message });
    process.exit(1);
  }
}

export function installProcessHandlers() {
  if (processHandlersInstalled) return;
  processHandlersInstalled = true;
  process.once('SIGTERM', () => terminate('SIGTERM'));
  process.once('SIGINT', () => terminate('SIGINT'));
  process.once('uncaughtException', error => terminate('uncaughtException', error));
  process.once('unhandledRejection', reason => {
    const error = reason instanceof Error ? reason : new Error(String(reason));
    terminate('unhandledRejection', error);
  });
}

const isMainModule = process.argv[1]
  && path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1]);

if (isMainModule && process.env.NODE_ENV !== 'test') {
  installProcessHandlers();
  startServer().catch(error => terminate('startup', error));
}

export { runtimeState };
export { default } from './app.js';
