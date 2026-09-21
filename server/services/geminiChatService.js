/**
 * Genie Chat — grounded explanation boundary.
 * Financial authority remains in the canonical backend services. External LLMs
 * receive a minimal read-only evidence packet and no executable tools.
 */
import { redisClient, redisAvailable } from '../config/redis.js';
import { createError } from '../middleware/errorHandler.js';
import ConversationHistory from '../models/ConversationHistory.js';
import FinancialProfile from '../models/FinancialProfile.js';
import Recommendation from '../models/Recommendation.js';
import { ImmutableSecurityPipeline } from './immutableSecurityPipeline.js';
import { PrometheusMetrics } from './metricsCollector.js';
import {
  buildRecommendationProfile,
  buildLlmFinancialContext,
} from './recommendationProfile.js';
import { getCurrentRegulatoryRuleVersion } from './taxEngine.js';
import { assessRecommendationFreshness } from './recommendationFreshness.js';
import { assessSuitabilityRisk } from './riskProfiler.js';
import {
  buildChatEvidencePacket,
  generateGroundedExplanation,
  isGroundingBoundaryAttack,
} from './groundedExplanationService.js';

const CHAT_RATE_LIMIT = 30;
const SESSION_CUMULATIVE_TOKEN_CAP = 50000;

async function checkRateLimit(userId) {
  const key = `chat:ratelimit:${userId}`;
  if (redisClient && redisAvailable) {
    try {
      const count = await redisClient.incr(key);
      if (count === 1) await redisClient.expire(key, 3600);
      if (count > CHAT_RATE_LIMIT) {
        const ttl = await redisClient.ttl(key);
        return { allowed: false, count, ttl };
      }
      return { allowed: true, count };
    } catch {
      // Chat remains available if the non-authoritative rate-limit cache fails.
    }
  }
  return { allowed: true, count: 1 };
}

export function buildClientResponseDTO({
  version = '3.0',
  response,
  session_id,
  latency_ms = 0,
  grounded = true,
  provider = 'DETERMINISTIC_TEMPLATE',
  model = null,
  prompt_version = null,
  grounding_version = null,
  evidence_ids_used = [],
  unavailable_facts = [],
  validation_status = null,
  fallback = false,
  messages_this_hour = 1,
  rate_limit_remaining = 30,
  citations = [],
  action_cards = [],
}) {
  return {
    version,
    response,
    session_id,
    latency_ms,
    grounded,
    provider,
    model,
    prompt_version,
    grounding_version,
    evidence_ids_used,
    unavailable_facts,
    validation_status,
    fallback,
    messages_this_hour,
    rate_limit_remaining,
    citations,
    action_cards,
  };
}

function recommendationForCurrentProfile(storedRecommendation, profile) {
  const freshness = assessRecommendationFreshness({
    profile,
    recommendation: storedRecommendation,
    currentRegulatoryRuleVersion: getCurrentRegulatoryRuleVersion(),
  });
  return freshness.fresh ? storedRecommendation : null;
}

function noProfileResponse(sessionId, rateCheck) {
  return buildClientResponseDTO({
    response: "I don't have your Financial Profile yet. Complete the profile flow before requesting a personalized explanation.",
    session_id: sessionId,
    grounded: false,
    provider: 'SYSTEM',
    messages_this_hour: rateCheck.count,
    rate_limit_remaining: CHAT_RATE_LIMIT - rateCheck.count,
  });
}

export async function processChat({ userId, user: _user, message, sessionId }) {
  const rateCheck = await checkRateLimit(userId);
  if (!rateCheck.allowed) {
    throw createError(429, `Rate limit for user ${userId}`, `Chat limit reached (${CHAT_RATE_LIMIT}/hour). Resets in ${Math.ceil(rateCheck.ttl / 60)} minutes.`);
  }

  const storedProfile = await FinancialProfile.findOne({ userId }).sort({ createdAt: -1 }).lean();
  if (!storedProfile) return noProfileResponse(sessionId, rateCheck);
  const profile = buildRecommendationProfile(storedProfile);
  const suitability = assessSuitabilityRisk(profile);
  const llmProfile = buildLlmFinancialContext(profile, suitability);
  const securityContext = ImmutableSecurityPipeline.processInput(message, profile);
  const promptInjectionDetected = securityContext.isInjection
    || isGroundingBoundaryAttack(securityContext.sanitizedMessage);
  if (promptInjectionDetected) PrometheusMetrics.inc('prompt_injection_attempts_total');

  const storedRecommendation = await Recommendation.findOne({
    userId,
    profileId: storedProfile._id,
  }).sort({ generatedAt: -1 }).lean();
  const recommendation = recommendationForCurrentProfile(storedRecommendation, profile);

  let conversation = await ConversationHistory.findOne({ userId, session_id: sessionId, is_active: true });
  if (!conversation) {
    conversation = new ConversationHistory({
      userId,
      profileId: storedProfile._id,
      session_id: sessionId,
      messages: [],
    });
  }

  const evidencePacket = await buildChatEvidencePacket({
    question: securityContext.sanitizedMessage,
    profile: llmProfile,
    recommendation,
  });
  const startedAt = Date.now();
  const explanation = await generateGroundedExplanation(
    { question: securityContext.sanitizedMessage, evidencePacket },
    (conversation.cumulative_tokens || 0) >= SESSION_CUMULATIVE_TOKEN_CAP
      ? { providers: [] }
      : {},
  );
  const latencyMs = Date.now() - startedAt;
  PrometheusMetrics.recordLatency(explanation.provider, latencyMs);

  const auditMetadata = {
    provider: explanation.provider,
    model: explanation.model,
    grounded_on_profile: true,
    grounding_version: explanation.groundingVersion,
    prompt_version: explanation.promptVersion,
    evidence_hash: explanation.evidenceHash,
    evidence_ids_used: explanation.evidenceIdsUsed,
    unavailable_facts: explanation.unavailableFacts,
    citations: explanation.citations,
    validation_status: explanation.validation.status,
    validation_reason_codes: explanation.validation.reasonCodes,
    fallback_used: explanation.fallback,
    prompt_injection_detected: promptInjectionDetected,
    tokens_used: explanation.tokensUsed,
    latency_ms: latencyMs,
    generated_at: explanation.generatedAt,
  };
  conversation.cumulative_tokens = (conversation.cumulative_tokens || 0) + explanation.tokensUsed;
  conversation.messages.push({
    role: 'user',
    content: securityContext.sanitizedMessage,
    metadata: { grounded_on_profile: true, prompt_injection_detected: promptInjectionDetected },
  });
  conversation.messages.push({ role: 'model', content: explanation.text, metadata: auditMetadata });
  await conversation.save();

  return buildClientResponseDTO({
    response: explanation.text,
    session_id: sessionId,
    latency_ms: latencyMs,
    grounded: true,
    provider: explanation.provider,
    model: explanation.model,
    prompt_version: explanation.promptVersion,
    grounding_version: explanation.groundingVersion,
    evidence_ids_used: explanation.evidenceIdsUsed,
    unavailable_facts: explanation.unavailableFacts,
    validation_status: explanation.validation.status,
    fallback: explanation.fallback,
    messages_this_hour: rateCheck.count,
    rate_limit_remaining: CHAT_RATE_LIMIT - rateCheck.count,
    citations: explanation.citations,
    action_cards: [],
  });
}
