import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import test from 'node:test';
import AgentRun from '../models/AgentRun.js';
import { migratePlanReviewPersistenceIndexes } from '../services/planReviewPersistence.js';
import { setupTestDatabase, teardownTestDatabase } from './helpers/mongoTestHelper.js';

test('Mongo active-dedupe partial unique index permits inactive null/missing rows and rejects duplicate active keys', async () => {
  await setupTestDatabase();
  const prefix = `plan-review-index-${crypto.randomUUID()}`;
  const runIds = [
    `${prefix}-null-1`,
    `${prefix}-null-2`,
    `${prefix}-missing-1`,
    `${prefix}-missing-2`,
    `${prefix}-active-1`,
    `${prefix}-active-2`,
  ];

  try {
    await migratePlanReviewPersistenceIndexes();
    const base = runId => ({
      runId,
      agentType: 'PLAN_REVIEW',
      userId: new mongoose.Types.ObjectId(),
      planReviewSnapshotHash: 'a'.repeat(64),
      sourceBinding: { schemaVersion: 'test' },
      status: 'COMPLETED',
    });

    await AgentRun.collection.insertMany([
      { ...base(runIds[0]), activeDedupeKey: null },
      { ...base(runIds[1]), activeDedupeKey: null },
      base(runIds[2]),
      base(runIds[3]),
    ]);

    const activeDedupeKey = `${prefix}-active`;
    await AgentRun.collection.insertOne({ ...base(runIds[4]), status: 'QUEUED', activeDedupeKey });
    await assert.rejects(
      AgentRun.collection.insertOne({ ...base(runIds[5]), status: 'QUEUED', activeDedupeKey }),
      error => error?.code === 11000,
      'the same actual active string remains unique',
    );

    const indexes = await AgentRun.collection.indexes();
    const activeIndex = indexes.find(index => index.name === 'uniq_agent_run_active_dedupe_key');
    assert.deepEqual(activeIndex?.partialFilterExpression, { activeDedupeKey: { $type: 'string' } });
    assert.equal(await AgentRun.collection.countDocuments({ runId: { $in: runIds } }), 5);
  } finally {
    await AgentRun.collection.deleteMany({ runId: { $in: runIds } });
    await teardownTestDatabase();
  }
});
