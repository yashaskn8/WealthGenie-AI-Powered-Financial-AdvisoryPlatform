import { createServer } from 'node:http';
import mongoose from 'mongoose';
import { redisAvailable, redisClient } from '../config/redis.js';
import { verifyPlanReviewPersistenceIndexes } from './planReviewPersistence.js';
import { verifyAgentRuntimePersistence, verifyPlanHealthPersistence } from './planHealthPersistence.js';

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function mongoReady() {
  if (mongoose.connection.readyState !== 1 || !mongoose.connection.db) return false;
  try {
    await mongoose.connection.db.admin().ping();
    return true;
  } catch {
    return false;
  }
}

export function createWorkerHealthServer({
  port = 5050,
  stateProvider,
  requireRedis = false,
  requirePlanReviewIndexes = false,
  requirePlanHealthPersistence = false,
  requireAgentRuntimePersistence: configuredAgentRuntimePersistence = false,
  requirePhase5Persistence = false,
  verifyAgentRuntime = verifyAgentRuntimePersistence,
  verifyPlanHealth = verifyPlanHealthPersistence,
} = {}) {
  const server = createServer(async (req, res) => {
    if (req.url === '/health/live') return json(res, 200, { status: 'ALIVE' });
    if (req.url !== '/health/ready') return json(res, 404, { status: 'NOT_FOUND' });

    const state = stateProvider?.() || { ready: false, draining: false };
    let checkpointIndexesReady = !requirePlanReviewIndexes;
    if (requirePlanReviewIndexes && mongoose.connection.readyState === 1) {
      try {
        await verifyPlanReviewPersistenceIndexes();
        checkpointIndexesReady = true;
      } catch {
        checkpointIndexesReady = false;
      }
    }
    let planHealthPersistenceReady = !requirePlanHealthPersistence;
    const requireAgentRuntimePersistence = configuredAgentRuntimePersistence || requirePhase5Persistence;
    let agentRuntimePersistenceReady = !requireAgentRuntimePersistence;
    if (requireAgentRuntimePersistence && mongoose.connection.readyState === 1) {
      try {
        await verifyAgentRuntime({ force: true });
        agentRuntimePersistenceReady = true;
      } catch {
        agentRuntimePersistenceReady = false;
      }
    }
    if (requirePlanHealthPersistence && mongoose.connection.readyState === 1) {
      try {
        await verifyPlanHealth({ force: true });
        planHealthPersistenceReady = true;
      } catch {
        planHealthPersistenceReady = false;
      }
    }
    const checks = {
      mongo: await mongoReady(),
      checkpointStore: mongoose.connection.readyState === 1 && checkpointIndexesReady,
      queue: mongoose.connection.readyState === 1 && (!requirePlanReviewIndexes || agentRuntimePersistenceReady),
      redis: !requireRedis || Boolean(redisAvailable && redisClient?.isReady),
      worker: Boolean(state.ready) && !state.draining,
      planHealthPersistence: mongoose.connection.readyState === 1 && planHealthPersistenceReady,
      agentRuntimePersistence: !requireAgentRuntimePersistence
        || mongoose.connection.readyState === 1 && agentRuntimePersistenceReady,
      planHealthScheduler: !requirePlanHealthPersistence || Boolean(state.planHealth?.ready)
        && Boolean(state.planHealth?.schedulerHealthy) && !state.planHealth?.draining,
    };
    const ready = Object.values(checks).every(Boolean);
    return json(res, ready ? 200 : 503, {
      status: ready ? 'READY' : 'NOT_READY',
      planReviewEnabled: requirePlanReviewIndexes,
      planHealthEnabled: requirePlanHealthPersistence,
      subsystems: {
        planReview: {
          enabled: requirePlanReviewIndexes,
          pollerRunning: Boolean(state.running),
          draining: Boolean(state.draining),
          indexesReady: checkpointIndexesReady && (!requirePlanReviewIndexes || agentRuntimePersistenceReady),
        },
        planHealth: {
          enabled: requirePlanHealthPersistence,
          lifecycle: state.planHealth?.lifecycle || 'STOPPED',
          schedulerStarted: Boolean(state.planHealth?.running),
          schedulerHealthy: Boolean(state.planHealth?.schedulerHealthy),
          draining: Boolean(state.planHealth?.draining),
          lastRunStartedAt: state.planHealth?.lastRunStartedAt || null,
          lastRunCompletedAt: state.planHealth?.lastRunCompletedAt || null,
          lastRunStatus: state.planHealth?.lastRunStatus || 'STOPPED',
          leaseHealth: state.planHealth?.leaseHealth || 'UNKNOWN',
          indexesReady: planHealthPersistenceReady,
        },
      },
      checks,
      timestamp: new Date().toISOString(),
    });
  });

  return {
    server,
    listen() {
      return new Promise((resolve, reject) => {
        const onError = error => { server.off('listening', onListening); reject(error); };
        const onListening = () => { server.off('error', onError); resolve(server); };
        server.once('error', onError);
        server.once('listening', onListening);
        server.listen(port, '0.0.0.0');
      });
    },
    close() {
      if (!server.listening) return Promise.resolve();
      return new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    },
  };
}
