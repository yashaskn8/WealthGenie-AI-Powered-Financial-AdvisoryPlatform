/**
 * Genie Chat — grounded explanation boundary.
 * Financial authority remains in the canonical backend services. External LLMs
 * receive a minimal read-only evidence packet and no executable tools.
 */
import { redisClient, redisAvailable } from '../config/redis.js';
import { createError } from '../middleware/errorHandler.js';
import FinancialProfile from '../models/FinancialProfile.js';
import { ImmutableSecurityPipeline } from './immutableSecurityPipeline.js';
import { PrometheusMetrics } from './metricsCollector.js';
import {
  buildRecommendationProfile,
  buildRecommendationProfileHash,
  buildLlmFinancialContext,
} from './recommendationProfile.js';
import { assessSuitabilityRisk } from './riskProfiler.js';
import {
  buildChatEvidencePacket,
  generateGroundedExplanation,
  getGroundedExplanationTokenUpperBound,
  isGroundingBoundaryAttack,
} from './groundedExplanationService.js';
import { resolveCurrentRecommendationState } from './recommendationState.js';
import {
  CHAT_SESSION_TOKEN_CAP,
  defaultChatSessionStore,
} from './chatSessionStore.js';

const CHAT_RATE_LIMIT = 30;
const SESSION_CUMULATIVE_TOKEN_CAP = CHAT_SESSION_TOKEN_CAP;

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

export async function processChat({ userId, user: _user, message, sessionId }, { sessionStore = defaultChatSessionStore } = {}) {
  const rateCheck = await checkRateLimit(userId);
  if (!rateCheck.allowed) {
    throw createError(429, 'Chat user rate limit exceeded.', `Chat limit reached (${CHAT_RATE_LIMIT}/hour). Resets in ${Math.ceil(rateCheck.ttl / 60)} minutes.`, {
      code: 'CHAT_RATE_LIMIT_EXCEEDED',
    });
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

  let recommendation = null;
  let recommendationState = null;
  try {
    recommendationState = await resolveCurrentRecommendationState({ userId, profileId: storedProfile._id, profile });
    recommendation = recommendationState.freshness.fresh ? recommendationState.currentRecommendationView : null;
    if (!recommendation) recommendationState = null;
  } catch {
    // Chat remains available as a non-personalized grounded explanation when
    // the authoritative recommendation is stale or unavailable.
  }

  const modelVersion = recommendation?.modelVersion || 'chat-profile-only-v1';
  const binding = {
    profileId: storedProfile._id,
    profileVersion: Number(storedProfile.version || 1),
    profileInputHash: buildRecommendationProfileHash(storedProfile, { modelVersion }),
    sourceRecommendationId: recommendation?._id || null,
    sourceAllocationRevisionId: recommendationState?.allocationRevision?._id || null,
    sourceRecommendationFingerprint: recommendationState?.recommendationFingerprint || null,
    sourcePortfolioFingerprint: recommendationState?.portfolioFingerprint || null,
  };

  const claim = await sessionStore.acquire({ userId, sessionId, binding });
  let providerAttempted = false;
  let completed = false;
  let leaseFailure = null;
  let heartbeatBusy = false;
  const heartbeat = setInterval(() => {
    if (heartbeatBusy || leaseFailure) return;
    heartbeatBusy = true;
    sessionStore.renew(claim).catch(error => { leaseFailure = error; }).finally(() => { heartbeatBusy = false; });
  }, Math.floor(90000 / 3));
  heartbeat.unref?.();

  try {
    const evidencePacket = await buildChatEvidencePacket({
      question: securityContext.sanitizedMessage,
      profile: llmProfile,
      recommendation,
    });
    if (leaseFailure) throw leaseFailure;
    const providerBudgetUpperBound = getGroundedExplanationTokenUpperBound({
      question: securityContext.sanitizedMessage,
      evidencePacket,
    });
    const alreadyUsed = Number(claim.conversation.cumulative_tokens || 0)
      + Number(claim.conversation.reserved_tokens || 0);
    const remainingBudget = Math.max(0, SESSION_CUMULATIVE_TOKEN_CAP - alreadyUsed);
    const canReserveProvider = providerBudgetUpperBound <= remainingBudget
      && await sessionStore.reserveBudget(claim, providerBudgetUpperBound);
    const startedAt = Date.now();
    providerAttempted = canReserveProvider;
    const explanation = await generateGroundedExplanation(
      { question: securityContext.sanitizedMessage, evidencePacket },
      canReserveProvider ? {} : { providers: [] },
    );
    if (leaseFailure) throw leaseFailure;
    const latencyMs = Date.now() - startedAt;
    PrometheusMetrics.recordLatency(explanation.provider, latencyMs);

    const attemptedProviderFailure = explanation.fallback
      && (explanation.reasonCodes || []).some(reason => /REQUEST_FAILED|EMPTY_COMPLETION|GROUNDING_VALIDATION_FAILED/.test(reason));
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
    const userMessage = {
      role: 'user',
      content: securityContext.sanitizedMessage,
      metadata: { grounded_on_profile: true, prompt_injection_detected: promptInjectionDetected },
    };
    const modelMessage = { role: 'model', content: explanation.text, metadata: auditMetadata };
    const actualProviderTokens = explanation.cached
      ? 0
      : Number(explanation.tokensUsed || 0);
    const usageUnavailable = !explanation.cached
      && explanation.provider !== 'DETERMINISTIC_TEMPLATE'
      && actualProviderTokens === 0;
    await sessionStore.complete({
      claim,
      userMessage,
      modelMessage,
      actualTokens: actualProviderTokens,
      chargeReservation: attemptedProviderFailure || usageUnavailable,
    });
    completed = true;

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
  } finally {
    clearInterval(heartbeat);
    if (!completed) {
      await sessionStore.release(claim, { chargeReservation: providerAttempted }).catch(() => {});
    }
  }
}
