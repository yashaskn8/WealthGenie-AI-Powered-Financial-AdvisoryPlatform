import { createServer } from 'node:http';
import mongoose from 'mongoose';
import { redisAvailable, redisClient } from '../config/redis.js';
import { verifyPlanReviewPersistenceIndexes } from './planReviewPersistence.js';

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

export function createWorkerHealthServer({ port = 5050, stateProvider, requireRedis = false, requirePlanReviewIndexes = false } = {}) {
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
    const checks = {
      mongo: await mongoReady(),
      checkpointStore: mongoose.connection.readyState === 1 && checkpointIndexesReady,
      queue: mongoose.connection.readyState === 1,
      redis: !requireRedis || Boolean(redisAvailable && redisClient?.isReady),
      worker: Boolean(state.ready) && !state.draining,
    };
    const ready = Object.values(checks).every(Boolean);
    return json(res, ready ? 200 : 503, {
      status: ready ? 'READY' : 'NOT_READY',
      planReviewEnabled: requirePlanReviewIndexes,
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
