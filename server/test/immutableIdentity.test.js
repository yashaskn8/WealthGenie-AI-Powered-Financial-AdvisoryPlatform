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
    identityPaths: [
      'userId', 'profileId', 'session_id', 'profileVersion', 'profileInputHash',
      'sourceRecommendationId', 'sourceAllocationRevisionId',
      'sourceRecommendationFingerprint', 'sourcePortfolioFingerprint',
    ],
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
    identityPaths: ['userId'],
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
    identityPaths: ['userId', 'profileId'],
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
    identityPaths: ['operation', 'method', 'userId', 'requestHash'],
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

function runQueryPreHooks(query) {
  return new Promise((resolve, reject) => {
    query.model.schema.s.hooks.execPre(query.op, query, error => {
      if (error) reject(error);
      else resolve();
    });
  });
}

function runBulkWritePreHooks(model, operations) {
  return new Promise((resolve, reject) => {
    model.schema.s.hooks.execPre('bulkWrite', model, [operations, {}], error => {
      if (error) reject(error);
      else resolve();
    });
  });
}

for (const item of protectedModels) {
  test(`${item.name} blocks identity mutation through save, query updates, replacements, and bulkWrite`, async () => {
    const baseline = item.document();
    const filter = { _id: baseline._id };
    const identityPaths = item.identityPaths || [item.field];
    const replacementWithoutIdentity = { displayOnly: 'replacement omission' };

    const hydrated = item.model.hydrate(baseline);
    hydrated.set(item.field, item.changed, undefined, { overwriteImmutable: true });
    await assert.rejects(hydrated.save(), hasCode(item.code), `${item.name} save`);

    const queryMutations = identityPaths.flatMap(path => {
      const update = { $set: { [path]: item.changed } };
      return [
        [`updateOne ${path}`, () => item.model.updateOne(filter, update).exec()],
        [`updateMany ${path}`, () => item.model.updateMany(filter, update).exec()],
        [`findOneAndUpdate ${path}`, () => item.model.findOneAndUpdate(filter, update).exec()],
        [`update pipeline ${path}`, () => item.model.updateOne(filter, [{ $set: { [path]: item.changed } }]).exec()],
        [`bulkWrite updateOne ${path}`, () => item.model.bulkWrite([
          { updateOne: { filter, update } },
        ])],
        [`bulkWrite updateMany ${path}`, () => item.model.bulkWrite([
          { updateMany: { filter, update } },
        ])],
        [`bulkWrite update pipeline ${path}`, () => item.model.bulkWrite([
          { updateOne: { filter, update: [{ $set: { [path]: item.changed } }] } },
        ])],
      ];
    });
    queryMutations.push(
      ['replaceOne omission', () => item.model.replaceOne(filter, replacementWithoutIdentity).exec()],
      ['findOneAndReplace omission', () => item.model.findOneAndReplace(filter, replacementWithoutIdentity).exec()],
      ['bulkWrite replacement omission', () => item.model.bulkWrite([
        { replaceOne: { filter, replacement: replacementWithoutIdentity } },
      ])],
    );

    for (const [operation, mutate] of queryMutations) {
      await assert.rejects(mutate(), hasCode(item.code), `${item.name} ${operation}`);
    }
  });
}

test('ConversationHistory accepts the atomic expired-reservation update pipeline and safe bulk equivalent', async () => {
  const filter = {
    userId,
    session_id: 'expired-reservation',
    is_active: true,
    processing_owner_id: { $ne: null },
    processing_lease_until: { $lte: new Date() },
    reserved_tokens: { $gt: 0 },
  };
  const pipeline = [{
    $set: {
      cumulative_tokens: {
        $add: [
          { $ifNull: ['$cumulative_tokens', 0] },
          { $ifNull: ['$reserved_tokens', 0] },
        ],
      },
      reserved_tokens: 0,
      processing_owner_id: null,
      processing_lease_until: null,
      session_version: {
        $add: [{ $ifNull: ['$session_version', 1] }, 1],
      },
      mutable_copy_of_profile: '$profileId',
    },
  }];

  await runQueryPreHooks(ConversationHistory.updateOne(filter, pipeline));
  await runBulkWritePreHooks(ConversationHistory, [
    { updateOne: { filter, update: pipeline } },
  ]);
  await runBulkWritePreHooks(ConversationHistory, [
    { insertOne: { document: {
      userId,
      profileId,
      session_id: 'new-bulk-session',
      profileVersion: 1,
      profileInputHash: 'a'.repeat(64),
    } } },
  ]);
});

test('pipeline analyzer permits only static safe stages and rejects protected or reshaping writes', async () => {
  const filter = { userId, session_id: 'pipeline-stage-check' };
  const rejectedPipelines = [
    [{ $addFields: { profileId: otherProfileId } }],
    [{ $unset: 'session_id' }],
    [{ $replaceRoot: { newRoot: '$replacement' } }],
    [{ $replaceWith: '$replacement' }],
    [{ $project: { userId: 0 } }],
    [{ $unknownStage: { session_id: 'changed' } }],
    [{ $set: { session_id: 'changed' }, $unset: 'profileId' }],
    [null],
    [{ $set: 'not-an-object' }],
    [{ $set: { 'session_id.$dynamic': 'changed' } }],
  ];

  for (const pipeline of rejectedPipelines) {
    await assert.rejects(
      ConversationHistory.updateOne(filter, pipeline).exec(),
      hasCode('CONVERSATION_IDENTITY_IMMUTABLE'),
      JSON.stringify(pipeline),
    );
    await assert.rejects(
      runBulkWritePreHooks(ConversationHistory, [
        { updateOne: { filter, update: pipeline } },
      ]),
      hasCode('CONVERSATION_IDENTITY_IMMUTABLE'),
      `bulk ${JSON.stringify(pipeline)}`,
    );
  }

  await runQueryPreHooks(ConversationHistory.updateOne(filter, [{ $addFields: { cumulative_tokens: 0 } }]));
  await runQueryPreHooks(ConversationHistory.updateOne(filter, [{ $unset: ['reserved_tokens'] }]));
});

test('protected path overlap is symmetric for parent replacement and nested child writes', async () => {
  const schema = new mongoose.Schema({ identity: { ownerId: String } });
  const { protectImmutableIdentity } = await import('../models/immutableIdentity.js');
  protectImmutableIdentity(schema, ['identity.ownerId'], { code: 'NESTED_IDENTITY_IMMUTABLE' });
  const modelName = 'ImmutableIdentityOverlapTest';
  const model = mongoose.models[modelName] || mongoose.model(modelName, schema);

  for (const path of ['identity', 'identity.ownerId.value']) {
    await assert.rejects(
      model.updateOne({}, { $set: { [path]: 'rewritten' } }).exec(),
      hasCode('NESTED_IDENTITY_IMMUTABLE'),
      `expected overlapping write path ${path} to be blocked`,
    );
  }
});

test('$rename source and destination are both checked and upsert-only identity creation remains valid', async () => {
  const filter = { userId, session_id: 'rename-upsert' };
  await assert.rejects(
    ConversationHistory.updateOne(filter, { $rename: { userId: 'legacyOwner' } }).exec(),
    hasCode('CONVERSATION_IDENTITY_IMMUTABLE'),
  );
  await assert.rejects(
    ConversationHistory.updateOne(filter, { $rename: { harmlessField: 'userId' } }).exec(),
    hasCode('CONVERSATION_IDENTITY_IMMUTABLE'),
  );
  await assert.rejects(
    ConversationHistory.updateOne(filter, { $setOnInsert: { session_id: 'rewritten' } }).exec(),
    hasCode('CONVERSATION_IDENTITY_IMMUTABLE'),
  );
  await runQueryPreHooks(ConversationHistory.updateOne(filter, {
    $setOnInsert: { userId, profileId, session_id: 'created', profileVersion: 1, profileInputHash: 'a'.repeat(64) },
  }, { upsert: true }));
});
