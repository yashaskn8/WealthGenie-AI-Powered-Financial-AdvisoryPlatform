import AuditChainHead from '../models/AuditChainHead.js';
import AuditRecord from '../models/AuditRecord.js';
import ConversationHistory from '../models/ConversationHistory.js';
import FinancialProfile from '../models/FinancialProfile.js';
import Goal from '../models/Goal.js';
import IdempotencyKey from '../models/IdempotencyKey.js';
import Recommendation from '../models/Recommendation.js';
import RecommendationAllocationRevision from '../models/RecommendationAllocationRevision.js';
import RecommendationState from '../models/RecommendationState.js';
import { createError } from '../middleware/errorHandler.js';

export const PHASE2_INDEX_MODELS = Object.freeze([
  IdempotencyKey,
  FinancialProfile,
  Recommendation,
  RecommendationState,
  RecommendationAllocationRevision,
  AuditRecord,
  AuditChainHead,
  Goal,
  ConversationHistory,
]);

const indexCache = new WeakMap();
const CACHE_TTL_MS = 5000;

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object' || value instanceof Date) return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableValue(value[key])]));
}

function keyMatches(actual, expected) {
  return JSON.stringify(Object.entries(actual || {})) === JSON.stringify(Object.entries(expected || {}));
}

function requiredUniqueIndexes(model) {
  const indexes = model.schema.indexes()
    .filter(([, options]) => options.unique)
    .map(([key, options]) => ({
      key,
      unique: true,
      partialFilterExpression: options.partialFilterExpression,
      collation: options.collation,
      name: options.name,
    }));
  return indexes;
}

function collationMatches(actual, required) {
  if (!required) return true;
  return Object.entries(required).every(([key, value]) => actual?.[key] === value);
}

function indexMatches(actual, required) {
  if (!keyMatches(actual.key, required.key) || actual.unique !== true) return false;
  if (JSON.stringify(stableValue(actual.partialFilterExpression || null))
      !== JSON.stringify(stableValue(required.partialFilterExpression || null))) return false;
  if (!collationMatches(actual.collation, required.collation)) return false;
  return true;
}

function indexReadinessError(missing) {
  return createError(
    503,
    'Required financial persistence indexes are unavailable.',
    'Financial data services are temporarily unavailable.',
    { code: 'PERSISTENCE_INDEXES_UNAVAILABLE', details: { missing } },
  );
}

/** Read-only verification. This function must never create, drop, or alter indexes. */
export async function verifyPersistenceIndexes({ models = PHASE2_INDEX_MODELS, force = false } = {}) {
  const connectionDb = models[0]?.db?.db;
  const modelSetKey = models.map(model => model.modelName).sort().join('|');
  if (connectionDb && !force) {
    const cached = indexCache.get(connectionDb)?.get(modelSetKey);
    if (cached && cached.expiresAt > Date.now()) return cached.promise;
  }

  const verification = (async () => {
    const missing = [];
    for (const model of models) {
      let actualIndexes;
      try {
        actualIndexes = await model.collection.indexes();
      } catch {
        missing.push(`${model.collection.collectionName}:collection-or-index-list-unavailable`);
        continue;
      }

      for (const required of requiredUniqueIndexes(model)) {
        if (!actualIndexes.some(index => indexMatches(index, required))) {
          missing.push(`${model.collection.collectionName}:${required.name || JSON.stringify(required.key)}`);
        }
      }
      if (model === IdempotencyKey && actualIndexes.some(index => (
        index.expireAfterSeconds !== undefined
        && index.key?.createdAt === 1
        && Object.keys(index.key).length === 1
      ))) {
        missing.push(`${model.collection.collectionName}:dangerous-createdAt-ttl-index`);
      }
    }

    if (missing.length) throw indexReadinessError(missing);
    return { ready: true, verifiedAt: new Date().toISOString() };
  })();

  if (connectionDb && !force) {
    let cachedByModelSet = indexCache.get(connectionDb);
    if (!cachedByModelSet) {
      cachedByModelSet = new Map();
      indexCache.set(connectionDb, cachedByModelSet);
    }
    cachedByModelSet.set(modelSetKey, { expiresAt: Date.now() + CACHE_TTL_MS, promise: verification });
    verification.catch(() => cachedByModelSet.delete(modelSetKey));
  }
  return verification;
}

/** Explicit migration entry point. Never call from an HTTP request or app startup. */
export async function migratePersistenceIndexes({ models = PHASE2_INDEX_MODELS } = {}) {
  const idempotencyIndexes = await IdempotencyKey.collection.indexes().catch(error => {
    if (error.code === 26 || error.codeName === 'NamespaceNotFound') return [];
    throw error;
  });
  for (const index of idempotencyIndexes) {
    if (index.expireAfterSeconds !== undefined
        && index.key?.createdAt === 1
        && Object.keys(index.key).length === 1) {
      await IdempotencyKey.collection.dropIndex(index.name);
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
  return verifyPersistenceIndexes({ models, force: true });
}
