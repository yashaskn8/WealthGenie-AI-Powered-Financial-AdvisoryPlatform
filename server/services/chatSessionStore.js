import crypto from 'node:crypto';
import mongoose from 'mongoose';
import ConversationHistory from '../models/ConversationHistory.js';
import { createError } from '../middleware/errorHandler.js';

export const CHAT_SESSION_TOKEN_CAP = 50000;
export const CHAT_SESSION_LEASE_MS = 90000;
const indexReadyByConnection = new WeakMap();

function persistenceError() {
  return createError(503, 'Chat session persistence is unavailable.', 'Chat is temporarily unavailable.', {
    code: 'CHAT_SESSION_PERSISTENCE_UNAVAILABLE',
  });
}

export async function ensureChatSessionIndexes(connection = mongoose.connection) {
  if (connection.readyState !== 1) throw persistenceError();
  let pending = indexReadyByConnection.get(connection);
  if (!pending) {
    pending = ConversationHistory.collection.createIndex(
      { userId: 1, session_id: 1 },
      { unique: true, name: 'unique_user_chat_session' },
    ).catch(error => {
      indexReadyByConnection.delete(connection);
      throw error;
    });
    indexReadyByConnection.set(connection, pending);
  }
  try {
    await pending;
  } catch {
    throw persistenceError();
  }
}

function sameNullableId(left, right) {
  return (left == null && right == null) || String(left) === String(right);
}

function isBindingMatch(conversation, binding) {
  return String(conversation.profileId) === String(binding.profileId)
    && Number(conversation.profileVersion) === Number(binding.profileVersion)
    && conversation.profileInputHash === binding.profileInputHash
    && sameNullableId(conversation.sourceRecommendationId, binding.sourceRecommendationId)
    && sameNullableId(conversation.sourceAllocationRevisionId, binding.sourceAllocationRevisionId)
    && (conversation.sourceRecommendationFingerprint || null) === (binding.sourceRecommendationFingerprint || null)
    && (conversation.sourcePortfolioFingerprint || null) === (binding.sourcePortfolioFingerprint || null);
}

function requireSessionBinding(conversation, binding) {
  if (!conversation.profileInputHash || !Number.isInteger(Number(conversation.profileVersion))) {
    throw createError(409, 'This chat session has no verifiable profile provenance; start a new session.', 'Start a new chat to continue with the current profile.', {
      code: 'CHAT_SESSION_PROVENANCE_MISSING',
    });
  }
  if (!isBindingMatch(conversation, binding)) {
    throw createError(409, 'The chat session is bound to a different financial source state.', 'Your profile or recommendation changed. Start a new chat session.', {
      code: 'CHAT_PROFILE_STATE_CHANGED',
    });
  }
}

async function settleExpiredReservation({ userId, sessionId, now }) {
  await ConversationHistory.updateOne({
    userId,
    session_id: sessionId,
    is_active: true,
    processing_owner_id: { $ne: null },
    processing_lease_until: { $lte: now },
    reserved_tokens: { $gt: 0 },
  }, [{
    $set: {
      cumulative_tokens: { $add: [{ $ifNull: ['$cumulative_tokens', 0] }, { $ifNull: ['$reserved_tokens', 0] }] },
      reserved_tokens: 0,
      processing_owner_id: null,
      processing_lease_until: null,
      session_version: { $add: [{ $ifNull: ['$session_version', 1] }, 1] },
    },
  }]);
}

export async function acquireChatSession({ userId, sessionId, binding, now = new Date() }) {
  await ensureChatSessionIndexes();
  try {
    await settleExpiredReservation({ userId, sessionId, now });
  } catch {
    throw persistenceError();
  }

  const identity = {
    userId: new mongoose.Types.ObjectId(String(userId)),
    session_id: sessionId,
  };
  let conversation;
  try {
    conversation = await ConversationHistory.findOneAndUpdate(identity, {
      $setOnInsert: {
        ...identity,
        profileId: binding.profileId,
        profileVersion: binding.profileVersion,
        profileInputHash: binding.profileInputHash,
        sourceRecommendationId: binding.sourceRecommendationId,
        sourceAllocationRevisionId: binding.sourceAllocationRevisionId,
        sourceRecommendationFingerprint: binding.sourceRecommendationFingerprint,
        sourcePortfolioFingerprint: binding.sourcePortfolioFingerprint,
        messages: [],
        message_count: 0,
        cumulative_tokens: 0,
        reserved_tokens: 0,
        message_sequence: 0,
        session_version: 1,
        is_active: true,
      },
    }, { upsert: true, new: true, setDefaultsOnInsert: true, runValidators: true }).select('+processing_owner_id +processing_lease_until').lean();
  } catch (error) {
    if (error.code === 11000) {
      // A simultaneous first-message upsert won the unique user/session race.
      try {
        conversation = await ConversationHistory.findOne(identity)
          .select('+processing_owner_id +processing_lease_until').lean();
      } catch {
        throw persistenceError();
      }
    } else {
      throw persistenceError();
    }
  }

  if (!conversation) throw persistenceError();
  if (!conversation.is_active) {
    throw createError(409, 'The chat session is closed.', 'Start a new chat session to continue.', { code: 'CHAT_SESSION_CLOSED' });
  }
  requireSessionBinding(conversation, binding);

  const ownerId = crypto.randomUUID();
  let claimed;
  try {
    claimed = await ConversationHistory.findOneAndUpdate({
      _id: conversation._id,
      userId: identity.userId,
      is_active: true,
      ...binding,
      $or: [
        { processing_owner_id: null },
        { processing_owner_id: { $exists: false } },
        { processing_lease_until: { $lte: now } },
      ],
    }, {
      $set: {
        processing_owner_id: ownerId,
        processing_lease_until: new Date(now.getTime() + CHAT_SESSION_LEASE_MS),
      },
    }, { new: true }).select('+processing_owner_id +processing_lease_until').lean();
  } catch {
    throw persistenceError();
  }
  if (!claimed) {
    throw createError(409, 'Another message is currently being processed for this session.', 'This chat is already processing a message. Please retry shortly.', {
      code: 'CHAT_SESSION_BUSY',
    });
  }

  return {
    conversation: claimed,
    ownerId,
    tokenReservation: 0,
    reservationCharged: false,
  };
}

export async function reserveChatProviderBudget(claim, upperBoundTokens) {
  if (!Number.isSafeInteger(upperBoundTokens) || upperBoundTokens < 1) {
    throw new TypeError('Chat provider budget reservation must be a positive safe integer');
  }
  let reserved;
  try {
    reserved = await ConversationHistory.findOneAndUpdate({
      _id: claim.conversation._id,
      userId: claim.conversation.userId,
      is_active: true,
      processing_owner_id: claim.ownerId,
      $expr: {
        $lte: [
          { $add: [
            { $ifNull: ['$cumulative_tokens', 0] },
            { $ifNull: ['$reserved_tokens', 0] },
            upperBoundTokens,
          ] },
          CHAT_SESSION_TOKEN_CAP,
        ],
      },
    }, { $inc: { reserved_tokens: upperBoundTokens } }, { new: true }).lean();
  } catch {
    throw persistenceError();
  }
  if (!reserved) return false;
  claim.tokenReservation = upperBoundTokens;
  claim.reservationCharged = true;
  claim.conversation = reserved;
  return true;
}

export async function renewChatSessionLease(claim, now = new Date()) {
  const result = await ConversationHistory.updateOne({
    _id: claim.conversation._id,
    userId: claim.conversation.userId,
    is_active: true,
    processing_owner_id: claim.ownerId,
  }, { $set: { processing_lease_until: new Date(now.getTime() + CHAT_SESSION_LEASE_MS) } });
  if (result.matchedCount !== 1) {
    throw createError(409, 'The chat session changed while the message was being generated.', 'The chat session changed. Start a new message.', {
      code: 'CHAT_SESSION_STATE_CHANGED',
    });
  }
}

export async function completeChatTurn({ claim, userMessage, modelMessage, actualTokens, chargeReservation = false }) {
  const reservation = claim.tokenReservation || 0;
  if (!Number.isSafeInteger(actualTokens) || actualTokens < 0
      || (!chargeReservation && actualTokens > reservation)) {
    throw createError(503, 'Chat provider usage exceeded its reserved session budget.', 'Chat is temporarily unavailable.', {
      code: 'CHAT_PROVIDER_USAGE_EXCEEDED_RESERVATION',
    });
  }
  const chargedTokens = chargeReservation ? reservation : actualTokens;
  const nextMessages = [userMessage, modelMessage].map((message, index) => ({
    ...message,
    metadata: {
      ...message.metadata,
      message_sequence: Number(claim.conversation.message_sequence || 0) + index + 1,
      profileId: claim.conversation.profileId,
      profileVersion: claim.conversation.profileVersion,
      profileInputHash: claim.conversation.profileInputHash,
      recommendationId: claim.conversation.sourceRecommendationId || undefined,
      allocationRevisionId: claim.conversation.sourceAllocationRevisionId || undefined,
      recommendationFingerprint: claim.conversation.sourceRecommendationFingerprint || undefined,
      portfolioFingerprint: claim.conversation.sourcePortfolioFingerprint || undefined,
    },
  }));
  let updated;
  try {
    updated = await ConversationHistory.findOneAndUpdate({
      _id: claim.conversation._id,
      userId: claim.conversation.userId,
      is_active: true,
      processing_owner_id: claim.ownerId,
      profileId: claim.conversation.profileId,
      profileVersion: claim.conversation.profileVersion,
      profileInputHash: claim.conversation.profileInputHash,
    }, [{
      $set: {
        messages: { $slice: [{ $concatArrays: [{ $ifNull: ['$messages', []] }, nextMessages] }, -200] },
        message_count: { $min: [200, { $add: [{ $size: { $ifNull: ['$messages', []] } }, 2] }] },
        message_sequence: { $add: [{ $ifNull: ['$message_sequence', 0] }, 2] },
        session_version: { $add: [{ $ifNull: ['$session_version', 1] }, 1] },
        cumulative_tokens: { $add: [{ $ifNull: ['$cumulative_tokens', 0] }, chargedTokens] },
        reserved_tokens: { $max: [0, { $subtract: [{ $ifNull: ['$reserved_tokens', 0] }, reservation] }] },
        processing_owner_id: null,
        processing_lease_until: null,
        updated_at: new Date(),
      },
    }], { new: true }).lean();
  } catch {
    throw persistenceError();
  }
  if (!updated) {
    throw createError(409, 'The chat session was closed or changed before this message could be saved.', 'The chat session changed. Start a new message.', {
      code: 'CHAT_SESSION_STATE_CHANGED',
    });
  }
  return updated;
}

export async function releaseChatSession(claim, { chargeReservation = false } = {}) {
  if (!claim?.ownerId) return;
  const reservation = claim.tokenReservation || 0;
  await ConversationHistory.updateOne({
    _id: claim.conversation._id,
    userId: claim.conversation.userId,
    processing_owner_id: claim.ownerId,
  }, {
    ...(chargeReservation && reservation > 0 ? { $inc: { cumulative_tokens: reservation } } : {}),
    $set: {
      processing_owner_id: null,
      processing_lease_until: null,
      ...(reservation > 0 ? { reserved_tokens: Math.max(0, Number(claim.conversation.reserved_tokens || 0) - reservation) } : {}),
      updated_at: new Date(),
    },
  });
}

export async function closeChatSession({ userId, sessionId }) {
  await ensureChatSessionIndexes();
  try {
    return await ConversationHistory.findOneAndUpdate({
      userId,
      session_id: sessionId,
      is_active: true,
    }, [{
      $set: {
        is_active: false,
        processing_owner_id: null,
        processing_lease_until: null,
        session_version: { $add: [{ $ifNull: ['$session_version', 1] }, 1] },
        updated_at: new Date(),
      },
    }], { new: true }).lean();
  } catch {
    throw persistenceError();
  }
}

export const defaultChatSessionStore = {
  acquire: acquireChatSession,
  reserveBudget: reserveChatProviderBudget,
  renew: renewChatSessionLease,
  complete: completeChatTurn,
  release: releaseChatSession,
  close: closeChatSession,
};
