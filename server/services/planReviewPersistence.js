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
export function verifyPlanReviewPersistenceIndexes({ models = PHASE4_PLAN_REVIEW_INDEX_MODELS, force = false } = {}) {
  return verifyPersistenceIndexes({ models, force });
}

/** Explicit deployment migration. Index DDL is never run by API/worker startup. */
export async function migratePlanReviewPersistenceIndexes({ models = PHASE4_PLAN_REVIEW_INDEX_MODELS } = {}) {
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
