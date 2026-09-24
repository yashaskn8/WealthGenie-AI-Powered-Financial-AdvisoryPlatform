import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import ConversationHistory from '../models/ConversationHistory.js';
import FinancialProfile from '../models/FinancialProfile.js';
import IdempotencyKey from '../models/IdempotencyKey.js';
import RecommendationState from '../models/RecommendationState.js';

const userId = new mongoose.Types.ObjectId();
const otherUserId = new mongoose.Types.ObjectId();
const profileId = new mongoose.Types.ObjectId();
const otherProfileId = new mongoose.Types.ObjectId();

const protectedModels = [
  {
    name: 'ConversationHistory',
    model: ConversationHistory,
    field: 'session_id',
    original: 'session-before',
    changed: 'session-after',
    code: 'CONVERSATION_IDENTITY_IMMUTABLE',
    document: () => ({
      _id: new mongoose.Types.ObjectId(),
      userId,
      profileId,
      session_id: 'session-before',
      profileVersion: 1,
      profileInputHash: 'a'.repeat(64),
      messages: [],
    }),
  },
  {
    name: 'FinancialProfile',
    model: FinancialProfile,
    field: 'userId',
    original: userId,
    changed: otherUserId,
    code: 'FINANCIAL_PROFILE_IDENTITY_IMMUTABLE',
    document: () => ({
      _id: new mongoose.Types.ObjectId(),
      userId,
      monthlyTakeHome: 100000,
      monthlySavings: 20000,
      age: 35,
      riskTolerance: 'Moderate',
      soldPropertyProceeds: null,
      hasLumpSum: false,
      lumpSumAmount: 0,
      liquidSavings: 100000,
      emiBurdenPct: 0,
      financialDependents: 1,
      emergencyFundMonths: 6,
      investmentGoals: ['Wealth Growth'],
      investmentHorizonYears: 10,
      recommendationProfileVersion: 'financial-profile-1.1.0',
      version: 1,
      financialStateFence: 0,
    }),
  },
  {
    name: 'RecommendationState',
    model: RecommendationState,
    field: 'profileId',
    original: profileId,
    changed: otherProfileId,
    code: 'RECOMMENDATION_STATE_IDENTITY_IMMUTABLE',
    document: () => ({
      _id: new mongoose.Types.ObjectId(),
      userId,
      profileId,
      currentRecommendationId: new mongoose.Types.ObjectId(),
      currentAllocationRevision: 1,
      currentAllocationRevisionId: new mongoose.Types.ObjectId(),
      generationRevision: 1,
      profileInputHash: 'a'.repeat(64),
      profileVersion: 1,
      portfolioFingerprint: 'b'.repeat(64),
      returnAssumptionVersion: 'test-assumptions',
      returnAssumptionHash: 'c'.repeat(64),
      returnAssumptionSource: 'WEALTHGENIE_MODEL_POLICY',
      financialStateFence: 0,
    }),
  },
  {
    name: 'IdempotencyKey',
    model: IdempotencyKey,
    field: 'operation',
    original: 'profile.create',
    changed: 'goal.create',
    code: 'IDEMPOTENCY_IDENTITY_IMMUTABLE',
    document: () => ({
      _id: 'f'.repeat(64),
      status: 'LOCK',
      operation: 'profile.create',
      method: 'POST',
      userId,
      requestHash: 'a'.repeat(64),
      lockOwnerId: 'owner-one',
      leaseExpiresAt: new Date(Date.now() + 60000),
    }),
  },
];

function hasCode(code) {
  return error => error?.code === code;
}

for (const item of protectedModels) {
  test(`${item.name} blocks identity mutation through save, query updates, replacements, and bulkWrite`, async () => {
    const baseline = item.document();
    const filter = { _id: baseline._id };
    const update = { $set: { [item.field]: item.changed } };
    const replacementWithoutIdentity = { displayOnly: 'replacement omission' };

    const hydrated = item.model.hydrate(baseline);
    hydrated.set(item.field, item.changed, undefined, { overwriteImmutable: true });
    await assert.rejects(hydrated.save(), hasCode(item.code), `${item.name} save`);

    const queryMutations = [
      ['updateOne', () => item.model.updateOne(filter, update).exec()],
      ['updateMany', () => item.model.updateMany(filter, update).exec()],
      ['findOneAndUpdate', () => item.model.findOneAndUpdate(filter, update).exec()],
      ['update pipeline', () => item.model.updateOne(filter, [{ $set: { [item.field]: item.changed } }]).exec()],
      ['replaceOne omission', () => item.model.replaceOne(filter, replacementWithoutIdentity).exec()],
      ['findOneAndReplace omission', () => item.model.findOneAndReplace(filter, replacementWithoutIdentity).exec()],
      ['bulkWrite updateOne', () => item.model.bulkWrite([
        { updateOne: { filter, update } },
      ])],
      ['bulkWrite updateMany', () => item.model.bulkWrite([
        { updateMany: { filter, update } },
      ])],
      ['bulkWrite update pipeline', () => item.model.bulkWrite([
        { updateOne: { filter, update: [{ $set: { [item.field]: item.changed } }] } },
      ])],
      ['bulkWrite replacement omission', () => item.model.bulkWrite([
        { replaceOne: { filter, replacement: replacementWithoutIdentity } },
      ])],
    ];

    for (const [operation, mutate] of queryMutations) {
      await assert.rejects(mutate(), hasCode(item.code), `${item.name} ${operation}`);
    }
  });
}
