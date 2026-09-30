import ResearchTask from '../models/ResearchTask.js';
import ResearchTaskCapacity from '../models/ResearchTaskCapacity.js';
import { unwrapMongoDocument } from './mongoResult.js';
import {
  DEFAULT_RESEARCH_AGENT_MAX_ACTIVE_TASKS,
  RESEARCH_TASK_CAPACITY_ID,
  researchAgentMaxActiveTasks,
} from './researchTaskCapacity.js';

function unavailable(code, message, details) {
  return Object.assign(new Error(message), { code, status: 503, ...(details ? { details } : {}) });
}

export async function verifyResearchTaskIndexes({
  model = ResearchTask,
  capacityModel = ResearchTaskCapacity,
  maxActiveTasks = DEFAULT_RESEARCH_AGENT_MAX_ACTIVE_TASKS,
} = {}) {
  if (model.db?.readyState !== 1 || !model.db?.db) {
    throw Object.assign(new Error('Research task database is unavailable.'), { code: 'RESEARCH_TASK_STORE_UNAVAILABLE', status: 503 });
  }
  let indexes;
  try { indexes = await model.collection.indexes(); } catch {
    throw Object.assign(new Error('Research task indexes are unavailable.'), { code: 'RESEARCH_TASK_INDEXES_UNAVAILABLE', status: 503 });
  }
  const required = model.schema.indexes();
  const missing = required.filter(([key, options]) => !indexes.some(index => (
    JSON.stringify(Object.entries(index.key || {})) === JSON.stringify(Object.entries(key))
    && Boolean(index.unique) === Boolean(options.unique)
    && JSON.stringify(index.partialFilterExpression || null) === JSON.stringify(options.partialFilterExpression || null)
    && (options.name ? index.name === options.name : true)
  ))).map(([, options]) => options.name || 'unnamed-index');
  if (missing.length) throw unavailable('RESEARCH_TASK_INDEXES_UNAVAILABLE', 'Required ResearchAgent task indexes are unavailable.', { missing });
  if (capacityModel.db?.readyState !== 1 || !capacityModel.db?.db) {
    throw unavailable('RESEARCH_TASK_CAPACITY_UNAVAILABLE', 'ResearchAgent distributed capacity database is unavailable.');
  }
  let capacityIndexes;
  let capacityState;
  try {
    capacityIndexes = await capacityModel.collection.indexes();
    capacityState = await capacityModel.collection.findOne({ _id: RESEARCH_TASK_CAPACITY_ID });
  } catch {
    throw unavailable('RESEARCH_TASK_CAPACITY_UNAVAILABLE', 'ResearchAgent distributed capacity state is unavailable.');
  }
  // MongoDB guarantees the built-in _id_ index is unique, but listIndexes may
  // omit an explicit `unique: true` field for this special index.
  const hasPrimaryKeyIndex = capacityIndexes.some(index => (
    index.name === '_id_'
      && Object.keys(index.key || {}).length === 1
      && index.key?._id === 1
  ));
  if (!hasPrimaryKeyIndex) throw unavailable('RESEARCH_TASK_CAPACITY_INDEXES_UNAVAILABLE', 'ResearchAgent capacity identity index is unavailable.');
  if (!capacityState || capacityState.maxActiveTasks !== maxActiveTasks || !Array.isArray(capacityState.activeLeases)) {
    throw unavailable('RESEARCH_TASK_CAPACITY_UNAVAILABLE', 'ResearchAgent distributed capacity state is missing or differs from configured limit.');
  }
  return { ready: true, verifiedAt: new Date().toISOString() };
}

async function ensureCapacityState({ capacityModel, maxActiveTasks }) {
  try { await capacityModel.createCollection(); } catch (error) {
    if (error.code !== 48 && error.codeName !== 'NamespaceExists') throw error;
  }
  await capacityModel.createIndexes();
  const upsertResult = await capacityModel.collection.updateOne(
    { _id: RESEARCH_TASK_CAPACITY_ID },
    { $setOnInsert: { maxActiveTasks, activeLeases: [], updatedAt: new Date() } },
    { upsert: true },
  );
  if (upsertResult.upsertedCount) return;
  const current = await capacityModel.collection.findOne({ _id: RESEARCH_TASK_CAPACITY_ID });
  if (!current) throw unavailable('RESEARCH_TASK_CAPACITY_UNAVAILABLE', 'ResearchAgent capacity state disappeared during migration.');
  if (current?.maxActiveTasks === maxActiveTasks) return;
  const liveLeases = {
    $filter: {
      input: { $ifNull: ['$activeLeases', []] },
      as: 'lease',
      cond: { $gt: ['$$lease.expiresAt', '$$NOW'] },
    },
  };
  const adjustmentResult = await capacityModel.collection.findOneAndUpdate({
    _id: RESEARCH_TASK_CAPACITY_ID,
    maxActiveTasks: current?.maxActiveTasks,
  }, [{
    $set: {
      activeLeases: liveLeases,
      maxActiveTasks: {
        $cond: [{ $eq: [{ $size: liveLeases }, 0] }, maxActiveTasks, '$maxActiveTasks'],
      },
      updatedAt: '$$NOW',
    },
  }], { returnDocument: 'after' });
  const adjusted = unwrapMongoDocument(adjustmentResult);
  if (adjusted?.maxActiveTasks !== maxActiveTasks) {
    throw unavailable('RESEARCH_TASK_CAPACITY_CONFIG_CONFLICT', 'ResearchAgent capacity limit cannot change while execution leases are active.');
  }
}

export async function migrateResearchTaskIndexes({
  model = ResearchTask,
  capacityModel = ResearchTaskCapacity,
  maxActiveTasks = researchAgentMaxActiveTasks(),
} = {}) {
  if (!Number.isSafeInteger(maxActiveTasks) || maxActiveTasks < 1 || maxActiveTasks > 100) {
    throw Object.assign(new Error('ResearchAgent global task capacity is invalid.'), { code: 'RESEARCH_AGENT_CONFIGURATION_INVALID' });
  }
  try { await model.createCollection(); } catch (error) {
    if (error.code !== 48 && error.codeName !== 'NamespaceExists') throw error;
  }
  const declaredIndexes = model.schema.indexes();
  const currentIndexes = await model.collection.indexes();
  for (const [key, options] of declaredIndexes) {
    if (!options.name) continue;
    const existing = currentIndexes.find(index => index.name === options.name);
    if (!existing) continue;
    const keyMatches = JSON.stringify(Object.entries(existing.key || {})) === JSON.stringify(Object.entries(key));
    const optionsMatch = Boolean(existing.unique) === Boolean(options.unique)
      && JSON.stringify(existing.partialFilterExpression || null) === JSON.stringify(options.partialFilterExpression || null);
    if (!keyMatches || !optionsMatch) await model.collection.dropIndex(options.name);
  }
  await model.createIndexes();
  await ensureCapacityState({ capacityModel, maxActiveTasks });
  return verifyResearchTaskIndexes({ model, capacityModel, maxActiveTasks });
}
