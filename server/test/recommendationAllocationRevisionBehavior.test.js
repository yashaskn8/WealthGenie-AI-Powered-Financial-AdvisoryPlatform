import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import RecommendationAllocationRevision from '../models/RecommendationAllocationRevision.js';
import { setupTestDatabase, teardownTestDatabase } from './helpers/mongoTestHelper.js';

const userId = new mongoose.Types.ObjectId();
const profileId = new mongoose.Types.ObjectId();
const recommendationId = new mongoose.Types.ObjectId();
const fingerprint = 'a'.repeat(64);

function revisionData(revision = 1) {
  return {
    recommendationId,
    profileId,
    userId,
    revision,
    previousRevision: revision === 1 ? null : revision - 1,
    source: revision === 1 ? 'ORIGINAL_RECOMMENDATION' : 'USER_REBALANCED',
    instruments: [{ id: 'fixture-fund', allocationWeight: 1, nominalReturn: 8, riskScore: 2 }],
    profileInputHash: 'b'.repeat(64),
    modelVersion: 'immutable-test-model',
    recommendationPolicyVersion: 'immutable-test-policy',
    regulatoryRuleVersion: 'immutable-test-regulatory',
    returnAssumptionVersion: 'immutable-test-assumptions',
    returnAssumptionHash: 'c'.repeat(64),
    returnAssumptionSource: 'WEALTHGENIE_MODEL_POLICY',
    portfolioFingerprint: fingerprint,
    recommendationFingerprint: 'd'.repeat(64),
  };
}

async function expectStoredUnchanged(id, baseline) {
  const actual = await RecommendationAllocationRevision.findById(id).lean();
  assert.ok(actual);
  assert.equal(actual.revision, baseline.revision);
  assert.equal(actual.portfolioFingerprint, baseline.portfolioFingerprint);
  assert.deepEqual(actual.instruments, baseline.instruments);
}

test.before(async () => {
  await setupTestDatabase({ requireReplicaSet: true });
  await RecommendationAllocationRevision.init();
});

test.beforeEach(async () => {
  await RecommendationAllocationRevision.collection.deleteMany({ userId });
});

test.after(async () => {
  await RecommendationAllocationRevision.collection.deleteMany({ userId }).catch(() => {});
  await teardownTestDatabase();
});

test('revision inserts are append-only across supported Mongoose mutation APIs', async () => {
  const inserted = await RecommendationAllocationRevision.create(revisionData(1));
  const revisionId = inserted._id;
  const baseline = await RecommendationAllocationRevision.findById(revisionId).lean();
  assert.equal(baseline.revision, 1);

  await assert.rejects(RecommendationAllocationRevision.create(revisionData(1)), error => error?.code === 11000);
  await expectStoredUnchanged(revisionId, baseline);

  const existingDocument = await RecommendationAllocationRevision.findById(revisionId);
  existingDocument.instruments[0].allocationWeight = 0.5;
  await assert.rejects(existingDocument.save(), /immutable/i);
  await expectStoredUnchanged(revisionId, baseline);

  const replacement = { ...revisionData(1), _id: revisionId, portfolioFingerprint: 'e'.repeat(64) };
  const mutations = [
    ['updateOne', () => RecommendationAllocationRevision.updateOne({ _id: revisionId }, { $set: { revision: 9 } })],
    ['updateMany', () => RecommendationAllocationRevision.updateMany({ _id: revisionId }, { $set: { revision: 9 } })],
    ['findOneAndUpdate', () => RecommendationAllocationRevision.findOneAndUpdate({ _id: revisionId }, { $set: { revision: 9 } })],
    ['replaceOne', () => RecommendationAllocationRevision.replaceOne({ _id: revisionId }, replacement)],
    ['findOneAndReplace', () => RecommendationAllocationRevision.findOneAndReplace({ _id: revisionId }, replacement)],
    ['deleteOne', () => RecommendationAllocationRevision.deleteOne({ _id: revisionId })],
    ['deleteMany', () => RecommendationAllocationRevision.deleteMany({ _id: revisionId })],
    ['findOneAndDelete', () => RecommendationAllocationRevision.findOneAndDelete({ _id: revisionId })],
    ['findByIdAndDelete', () => RecommendationAllocationRevision.findByIdAndDelete(revisionId)],
    ['bulkWrite', () => RecommendationAllocationRevision.bulkWrite([
      { updateOne: { filter: { _id: revisionId }, update: { $set: { revision: 9 } } } },
    ])],
  ];

  for (const [operation, mutate] of mutations) {
    await assert.rejects(mutate(), error => {
      assert.match(error.message, /append-only|immutable/i, `${operation} must reject with the append-only guard`);
      return true;
    }, `${operation} must reject`);
    await expectStoredUnchanged(revisionId, baseline);
  }
});

test('normal append creates revision N+1 while preserving revision N', async () => {
  const first = await RecommendationAllocationRevision.create(revisionData(1));
  const firstBefore = await RecommendationAllocationRevision.findById(first._id).lean();
  const nextData = revisionData(2);
  nextData.previousAllocationRevisionId = first._id;
  nextData.portfolioFingerprint = 'f'.repeat(64);
  const second = await RecommendationAllocationRevision.create(nextData);

  assert.equal(second.revision, 2);
  assert.equal(String(second.previousAllocationRevisionId), String(first._id));
  await expectStoredUnchanged(first._id, firstBefore);
});
