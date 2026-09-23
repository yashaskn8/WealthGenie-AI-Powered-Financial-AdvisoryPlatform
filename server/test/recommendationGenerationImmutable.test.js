import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import Recommendation from '../models/Recommendation.js';

const id = new mongoose.Types.ObjectId();

test('generation allocation and response snapshot cannot be changed by query updates', async () => {
  for (const update of [
    { $set: { instruments: [] } },
    { $set: { 'responseSnapshot.instruments': [] } },
    { $unset: { responseSnapshot: 1 } },
    { $rename: { 'responseSnapshot.instruments': 'advisoryText' } },
    [{ $set: { instruments: [] } }],
  ]) {
    await assert.rejects(
      Recommendation.updateOne({ _id: id }, update).exec(),
      error => error.code === 'RECOMMENDATION_GENERATION_IMMUTABLE',
    );
  }
});

test('policy and generation identity cannot be changed after recommendation creation', async () => {
  for (const field of [
    'modelVersion',
    'regulatoryRuleVersion',
    'profileInputHash',
    'recommendationPolicyVersion',
    'returnAssumptionHash',
    'recommendationGeneration',
    'currentAllocationSource',
    'generatedAt',
  ]) {
    await assert.rejects(
      Recommendation.findOneAndUpdate({ _id: id }, { $set: { [field]: 'tampered' } }).exec(),
      error => error.code === 'RECOMMENDATION_GENERATION_IMMUTABLE',
      `expected ${field} to be immutable`,
    );
  }
});
