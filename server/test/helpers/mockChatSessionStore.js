import crypto from 'node:crypto';
import { createError } from '../../middleware/errorHandler.js';
import { CHAT_SESSION_TOKEN_CAP, defaultChatSessionStore } from '../../services/chatSessionStore.js';

export function createMockChatSessionStore(getSession) {
  let activeOwner = null;

  return {
    async acquire({ userId, sessionId, binding }) {
      const conversation = await getSession({ userId, sessionId });
      if (!conversation) throw new Error('The mock must supply a chat session.');
      if (activeOwner) {
        throw createError(409, 'Another message is currently being processed.', 'Retry the chat message.', { code: 'CHAT_SESSION_BUSY' });
      }
      if (!conversation.profileInputHash) {
        Object.assign(conversation, binding);
      } else if (String(conversation.profileId) !== String(binding.profileId)
          || Number(conversation.profileVersion) !== Number(binding.profileVersion)
          || conversation.profileInputHash !== binding.profileInputHash) {
        throw createError(409, 'The chat profile state changed.', 'Start a new chat session.', { code: 'CHAT_PROFILE_STATE_CHANGED' });
      }
      activeOwner = crypto.randomUUID();
      return {
        conversation,
        ownerId: activeOwner,
        tokenReservation: 0,
      };
    },
    async reserveBudget(claim, reservation) {
      const total = Number(claim.conversation.cumulative_tokens || 0)
        + Number(claim.conversation.reserved_tokens || 0)
        + reservation;
      if (total > CHAT_SESSION_TOKEN_CAP) return false;
      claim.tokenReservation = reservation;
      claim.conversation.reserved_tokens = Number(claim.conversation.reserved_tokens || 0) + reservation;
      return true;
    },
    async renew(claim) {
      if (activeOwner !== claim.ownerId) throw createError(409, 'Chat session lease was lost.', 'Start a new message.', { code: 'CHAT_SESSION_STATE_CHANGED' });
    },
    async complete({ claim, userMessage, modelMessage, actualTokens, chargeReservation = false }) {
      if (activeOwner !== claim.ownerId) throw createError(409, 'Chat session lease was lost.', 'Start a new message.', { code: 'CHAT_SESSION_STATE_CHANGED' });
      const sequence = Number(claim.conversation.message_sequence || 0);
      claim.conversation.messages.push(
        { ...userMessage, metadata: { ...userMessage.metadata, message_sequence: sequence + 1 } },
        { ...modelMessage, metadata: { ...modelMessage.metadata, message_sequence: sequence + 2 } },
      );
      claim.conversation.messages = claim.conversation.messages.slice(-200);
      claim.conversation.message_count = claim.conversation.messages.length;
      claim.conversation.message_sequence = sequence + 2;
      claim.conversation.session_version = Number(claim.conversation.session_version || 1) + 1;
      claim.conversation.cumulative_tokens = Number(claim.conversation.cumulative_tokens || 0)
        + (chargeReservation ? claim.tokenReservation : actualTokens);
      claim.conversation.reserved_tokens = Math.max(0,
        Number(claim.conversation.reserved_tokens || 0) - Number(claim.tokenReservation || 0));
      claim.conversation.processing_owner_id = null;
      activeOwner = null;
      return claim.conversation;
    },
    async release(claim, { chargeReservation = false } = {}) {
      if (activeOwner !== claim.ownerId) return;
      if (chargeReservation) {
        claim.conversation.cumulative_tokens = Number(claim.conversation.cumulative_tokens || 0)
          + Number(claim.tokenReservation || 0);
      }
      claim.conversation.reserved_tokens = Math.max(0,
        Number(claim.conversation.reserved_tokens || 0) - Number(claim.tokenReservation || 0));
      claim.conversation.processing_owner_id = null;
      activeOwner = null;
    },
    async close() {
      activeOwner = null;
    },
  };
}

export function installMockChatSessionStore(getSession) {
  const previous = { ...defaultChatSessionStore };
  Object.assign(defaultChatSessionStore, createMockChatSessionStore(getSession));
  return () => Object.assign(defaultChatSessionStore, previous);
}
