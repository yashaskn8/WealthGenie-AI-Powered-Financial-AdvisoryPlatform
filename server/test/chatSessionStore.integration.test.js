import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import ConversationHistory from '../models/ConversationHistory.js';
import {
  acquireChatSession,
  closeChatSession,
  completeChatTurn,
  ensureChatSessionIndexes,
  releaseChatSession,
  reserveChatProviderBudget,
} from '../services/chatSessionStore.js';
import { setupTestDatabase, teardownTestDatabase } from './helpers/mongoTestHelper.js';

const userId = new mongoose.Types.ObjectId();
const profileId = new mongoose.Types.ObjectId();
const binding = Object.freeze({
  profileId,
  profileVersion: 1,
  profileInputHash: 'a'.repeat(64),
  sourceRecommendationId: null,
  sourceAllocationRevisionId: null,
  sourceRecommendationFingerprint: null,
  sourcePortfolioFingerprint: null,
});

test.before(async () => {
  await setupTestDatabase();
  await ensureChatSessionIndexes();
});

test.beforeEach(async () => {
  await ConversationHistory.deleteMany({ userId });
});

test.after(async () => {
  await teardownTestDatabase();
});

test('simultaneous first messages establish one durable user/session identity and one owner', async () => {
  const outcomes = await Promise.allSettled([
    acquireChatSession({ userId, sessionId: 'same-first-session', binding }),
    acquireChatSession({ userId, sessionId: 'same-first-session', binding }),
  ]);

  assert.equal(outcomes.filter(result => result.status === 'fulfilled').length, 1);
  const rejected = outcomes.find(result => result.status === 'rejected');
  assert.equal(rejected.reason.code, 'CHAT_SESSION_BUSY');
  assert.equal(await ConversationHistory.countDocuments({ userId, session_id: 'same-first-session' }), 1);

  const winner = outcomes.find(result => result.status === 'fulfilled').value;
  await releaseChatSession(winner);
});

test('session append is atomic, ordered, and bound to its captured profile source', async () => {
  const claim = await acquireChatSession({ userId, sessionId: 'ordered-session', binding });
  assert.equal(await reserveChatProviderBudget(claim, 100), true);

  const saved = await completeChatTurn({
    claim,
    userMessage: { role: 'user', content: 'Explain my profile.' },
    modelMessage: { role: 'model', content: 'Grounded response.', metadata: { tokens_used: 80 } },
    actualTokens: 80,
  });

  assert.equal(saved.message_count, 2);
  assert.equal(saved.message_sequence, 2);
  assert.deepEqual(saved.messages.map(message => message.metadata.message_sequence), [1, 2]);
  assert.deepEqual(saved.messages.map(message => message.metadata.profileInputHash), [binding.profileInputHash, binding.profileInputHash]);
  assert.equal(saved.cumulative_tokens, 80);
  assert.equal(saved.reserved_tokens, 0);

  await assert.rejects(
    acquireChatSession({
      userId,
      sessionId: 'ordered-session',
      binding: { ...binding, profileVersion: 2 },
    }),
    error => error.code === 'CHAT_PROFILE_STATE_CHANGED',
  );
});

test('competing messages to one session return an explicit busy conflict without losing either accepted turn', async () => {
  const first = await acquireChatSession({ userId, sessionId: 'competing-session', binding });

  await assert.rejects(
    acquireChatSession({ userId, sessionId: 'competing-session', binding }),
    error => error.code === 'CHAT_SESSION_BUSY',
  );

  await completeChatTurn({
    claim: first,
    userMessage: { role: 'user', content: 'First accepted turn.' },
    modelMessage: { role: 'model', content: 'First grounded response.' },
    actualTokens: 0,
  });

  const second = await acquireChatSession({ userId, sessionId: 'competing-session', binding });
  await completeChatTurn({
    claim: second,
    userMessage: { role: 'user', content: 'Second accepted turn.' },
    modelMessage: { role: 'model', content: 'Second grounded response.' },
    actualTokens: 0,
  });

  const stored = await ConversationHistory.findOne({ userId, session_id: 'competing-session' }).lean();
  assert.equal(stored.message_count, 4);
  assert.deepEqual(stored.messages.map(message => message.content), [
    'First accepted turn.',
    'First grounded response.',
    'Second accepted turn.',
    'Second grounded response.',
  ]);
  assert.deepEqual(stored.messages.map(message => message.metadata.message_sequence), [1, 2, 3, 4]);
});

test('atomic provider-budget reservations cannot concurrently cross the session cap', async () => {
  const claim = await acquireChatSession({ userId, sessionId: 'budget-session', binding });
  await ConversationHistory.updateOne({ _id: claim.conversation._id }, { $set: { cumulative_tokens: 49_500 } });
  const results = await Promise.all([
    reserveChatProviderBudget(claim, 400),
    reserveChatProviderBudget(claim, 400),
  ]);

  assert.deepEqual(results.sort(), [false, true]);
  const persisted = await ConversationHistory.findById(claim.conversation._id).lean();
  assert.equal(persisted.cumulative_tokens + persisted.reserved_tokens, 49_900);
  await releaseChatSession(claim);
});

test('failed provider reservation is conservatively charged and released exactly once', async () => {
  const claim = await acquireChatSession({ userId, sessionId: 'provider-failure-session', binding });
  assert.equal(await reserveChatProviderBudget(claim, 120), true);
  await releaseChatSession(claim, { chargeReservation: true });

  const stored = await ConversationHistory.findById(claim.conversation._id).select('+processing_owner_id').lean();
  assert.equal(stored.cumulative_tokens, 120);
  assert.equal(stored.reserved_tokens, 0);
  assert.equal(stored.processing_owner_id, null);
});

test('closing a session fences an in-flight response from appending afterward', async () => {
  const claim = await acquireChatSession({ userId, sessionId: 'closing-session', binding });
  await closeChatSession({ userId, sessionId: 'closing-session' });

  await assert.rejects(
    completeChatTurn({
      claim,
      userMessage: { role: 'user', content: 'Late message.' },
      modelMessage: { role: 'model', content: 'Must not persist.' },
      actualTokens: 0,
    }),
    error => error.code === 'CHAT_SESSION_STATE_CHANGED',
  );
  const closed = await ConversationHistory.findById(claim.conversation._id).lean();
  assert.equal(closed.is_active, false);
  assert.equal(closed.message_count, 0);
});
