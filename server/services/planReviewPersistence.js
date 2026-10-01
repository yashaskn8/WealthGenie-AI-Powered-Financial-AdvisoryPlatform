import AgentRun from '../models/AgentRun.js';
import AgentCheckpoint from '../models/AgentCheckpoint.js';
import AgentGraphCheckpoint from '../models/AgentGraphCheckpoint.js';
import AgentRunEvent from '../models/AgentRunEvent.js';
import { verifyPersistenceIndexes } from './persistenceIndexReadiness.js';

export const PHASE4_PLAN_REVIEW_INDEX_MODELS = Object.freeze([
  AgentRun,
  AgentCheckpoint,
  AgentGraphCheckpoint,
  AgentRunEvent,
]);

/** Runtime gate: read-only index verification; never creates or repairs indexes. */
export async function verifyPlanReviewPersistenceIndexes({ models = PHASE4_PLAN_REVIEW_INDEX_MODELS, force = false } = {}) {
  const result = await verifyPersistenceIndexes({ models, force });
  const requiredTtlIndexes = [
    ['AgentCheckpoint', { expiresAt: 1 }, 'ttl_terminal_agent_checkpoints'],
    ['AgentGraphCheckpoint', { expiresAt: 1 }, 'ttl_terminal_agent_graph_checkpoints'],
  ];
  const missing = [];
  for (const [modelName, key, name] of requiredTtlIndexes) {
    const model = models.find(candidate => candidate.modelName === modelName);
    if (!model) continue;
    const indexes = await model.collection.indexes().catch(() => []);
    if (!indexes.some(index => JSON.stringify(Object.entries(index.key || {})) === JSON.stringify(Object.entries(key))
        && index.expireAfterSeconds === 0 && index.name === name)) {
      missing.push(`${model.collection.collectionName}:${name}`);
    }
  }
  if (missing.length) {
    throw Object.assign(new Error('Required terminal checkpoint retention indexes are unavailable.'), {
      status: 503,
      code: 'PERSISTENCE_INDEXES_UNAVAILABLE',
      details: { missing },
    });
  }
  return result;
}

/** Explicit deployment migration. Index DDL is never run by API/worker startup. */
export async function migratePlanReviewPersistenceIndexes({ models = PHASE4_PLAN_REVIEW_INDEX_MODELS } = {}) {
  const runModel = models.find(model => model.modelName === AgentRun.modelName);
  const runIndexes = await runModel?.collection.indexes().catch(error => {
    if (error.code === 26 || error.codeName === 'NamespaceNotFound') return [];
    throw error;
  }) || [];
  for (const index of runIndexes) {
    const key = index.key || {};
    const isActiveDedupeIndex = index.unique === true
      && Object.keys(key).length === 1
      && key.activeDedupeKey === 1;
    const hasCorrectStringPartial = index.partialFilterExpression?.activeDedupeKey?.$type === 'string';
    if (isActiveDedupeIndex && !hasCorrectStringPartial) {
      await runModel.collection.dropIndex(index.name);
    }
  }

  const checkpointModel = models.find(model => model.modelName === AgentCheckpoint.modelName);
  const obsoleteCheckpointIndexes = await checkpointModel?.collection.indexes().catch(error => {
    if (error.code === 26 || error.codeName === 'NamespaceNotFound') return [];
    throw error;
  }) || [];
  for (const index of obsoleteCheckpointIndexes) {
    const key = index.key || {};
    if (index.unique === true
        && Object.keys(key).length === 2
        && key.runId === 1
        && key.sequence === -1) {
      await checkpointModel.collection.dropIndex(index.name);
    }
  }

  for (const model of models) {
    try {
      await model.createCollection();
    } catch (error) {
      if (error.code !== 48 && error.codeName !== 'NamespaceExists') throw error;
    }
    await model.createIndexes();
  }
  return verifyPlanReviewPersistenceIndexes({ models, force: true });
}
