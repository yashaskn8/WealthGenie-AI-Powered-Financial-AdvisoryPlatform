import ResearchTask from '../models/ResearchTask.js';

export async function verifyResearchTaskIndexes({ model = ResearchTask } = {}) {
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
    && (options.name ? index.name === options.name : true)
  ))).map(([, options]) => options.name || 'unnamed-index');
  if (missing.length) {
    throw Object.assign(new Error('Required ResearchAgent task indexes are unavailable.'), {
      code: 'RESEARCH_TASK_INDEXES_UNAVAILABLE',
      status: 503,
      details: { missing },
    });
  }
  return { ready: true, verifiedAt: new Date().toISOString() };
}

export async function migrateResearchTaskIndexes({ model = ResearchTask } = {}) {
  try { await model.createCollection(); } catch (error) {
    if (error.code !== 48 && error.codeName !== 'NamespaceExists') throw error;
  }
  await model.createIndexes();
  return verifyResearchTaskIndexes({ model });
}
