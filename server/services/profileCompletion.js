import crypto from 'crypto';
import {
  getCache,
  setCache,
  setCacheNX,
  releaseCacheNX,
  delCache,
} from '../config/redis.js';
import {
  assertCoreResultFinalSafety,
  buildRecommendationCacheKey,
  marketContextIdentity,
  rebindCoreRecommendation,
} from './coreRecommendation.js';
import {
  buildRecommendationProfile,
  buildRecommendationProfileHash,
  FINANCIAL_PROFILE_SCHEMA_VERSION,
  RECOMMENDATION_POLICY_VERSION,
} from './recommendationProfile.js';
import { canonicalSha256 } from '../utils/canonicalJson.js';

export const PROFILE_CANDIDATE_SCHEMA_VERSION = 'profile-recommendation-candidate-1.0.0';
export const PROFILE_CANDIDATE_TTL_SECONDS = 180;
export const PROFILE_CANDIDATE_TTL_MS = PROFILE_CANDIDATE_TTL_SECONDS * 1000;

function candidateKey(candidateId) {
  return `rec:candidate:${candidateId}`;
}

function candidateConsumeKey(candidateId) {
  return `rec:candidate:consume:${candidateId}`;
}

function candidateConsumedKey(candidateId) {
  return `rec:candidate:consumed:${candidateId}`;
}

function validCandidateId(candidateId) {
  return typeof candidateId === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(candidateId);
}

function nowMs() {
  return Date.now();
}

function candidateResultFromCore(core) {
  return {
    canonicalProfile: core.canonicalProfile,
    recommendationData: core.recommendationData,
    auditRecordData: core.auditRecordData,
    response: core.response,
    modelVersion: core.modelVersion,
    regulatoryRuleVersion: core.regulatoryRuleVersion,
    marketContext: core.marketContext,
    marketContextIdentity: core.marketContextIdentity,
    profileInputHash: core.profileInputHash,
    recommendationPolicyVersion: core.recommendationPolicyVersion,
    financialProfileSchemaVersion: core.financialProfileSchemaVersion,
  };
}

function candidateSafeMetadata(candidate) {
  return {
    candidateId: candidate.candidateId,
    status: 'READY',
    expiresInMs: Math.max(0, new Date(candidate.expiresAt).getTime() - nowMs()),
    profileFingerprint: candidate.profileInputHash,
    modelVersion: candidate.modelVersion,
    recommendationPolicyVersion: candidate.recommendationPolicyVersion,
    financialProfileSchemaVersion: candidate.financialProfileSchemaVersion,
    regulatoryRuleVersion: candidate.regulatoryRuleVersion,
    marketContext: {
      identity: candidate.marketContextIdentity,
      policyVersion: candidate.marketContext?.policyVersion
        ?? candidate.marketContext?.marketSnapshot?.policyOutput?.policyVersion
        ?? null,
      observedAt: candidate.marketContext?.marketSnapshot?.observedAt
        ?? candidate.marketContext?.observedAt
        ?? null,
      status: candidate.marketContext?.status ?? 'MARKET_CONTEXT_UNAVAILABLE',
    },
  };
}

export async function storeProfileRecommendationCandidate({ userId, core }) {
  const candidateId = crypto.randomUUID();
  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + PROFILE_CANDIDATE_TTL_MS);
  const result = candidateResultFromCore(core);
  const candidate = {
    schemaVersion: PROFILE_CANDIDATE_SCHEMA_VERSION,
    candidateId,
    userId: String(userId),
    profileInputHash: core.profileInputHash,
    modelVersion: core.modelVersion,
    recommendationPolicyVersion: core.recommendationPolicyVersion,
    regulatoryRuleVersion: core.regulatoryRuleVersion,
    financialProfileSchemaVersion: core.financialProfileSchemaVersion,
    marketContextIdentity: core.marketContextIdentity,
    marketObservedAt: core.marketContext?.marketSnapshot?.observedAt
      ?? core.marketContext?.observedAt
      ?? null,
    createdAt: createdAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    result,
    resultHash: canonicalSha256(result),
  };
  const stored = await setCache(candidateKey(candidateId), candidate, PROFILE_CANDIDATE_TTL_SECONDS);
  if (!stored) {
    const error = new Error('Profile precomputation requires the short-lived candidate cache.');
    error.status = 503;
    error.clientMessage = 'Profile precomputation is temporarily unavailable. You can still complete your profile.';
    error.code = 'PROFILE_PRECOMPUTE_UNAVAILABLE';
    throw error;
  }
  return candidateSafeMetadata(candidate);
}

export async function loadProfileRecommendationCandidate({ candidateId, userId }) {
  if (!validCandidateId(candidateId)) {
    return { candidate: null, reason: 'CANDIDATE_ID_INVALID' };
  }
  if (await getCache(candidateConsumedKey(candidateId))) {
    return { candidate: null, reason: 'CANDIDATE_CONSUMED' };
  }
  const candidate = await getCache(candidateKey(candidateId));
  if (!candidate) return { candidate: null, reason: 'CANDIDATE_EXPIRED_OR_MISSING' };
  if (candidate.candidateId !== candidateId) return { candidate: null, reason: 'CANDIDATE_ID_MISMATCH' };
  if (candidate.userId !== String(userId)) return { candidate: null, reason: 'CANDIDATE_OWNER_MISMATCH' };
  return { candidate, reason: null };
}

function invalid(reason) {
  return { valid: false, reason };
}

export function validateProfileRecommendationCandidate({
  candidate,
  userId,
  canonicalProfile,
  regulatoryRuleVersion,
  marketContext,
  now = new Date(),
}) {
  if (!candidate) return invalid('CANDIDATE_EXPIRED_OR_MISSING');
  if (candidate.userId !== String(userId)) return invalid('CANDIDATE_OWNER_MISMATCH');
  if (candidate.schemaVersion !== PROFILE_CANDIDATE_SCHEMA_VERSION) return invalid('CANDIDATE_SCHEMA_MISMATCH');
  if (candidate.financialProfileSchemaVersion !== FINANCIAL_PROFILE_SCHEMA_VERSION) {
    return invalid('CANDIDATE_PROFILE_SCHEMA_MISMATCH');
  }
  if (candidate.recommendationPolicyVersion !== RECOMMENDATION_POLICY_VERSION) {
    return invalid('CANDIDATE_POLICY_VERSION_MISMATCH');
  }
  if (candidate.regulatoryRuleVersion !== regulatoryRuleVersion) {
    return invalid('CANDIDATE_REGULATORY_VERSION_MISMATCH');
  }
  const createdAt = Date.parse(candidate.createdAt);
  const expiresAt = Date.parse(candidate.expiresAt);
  if (!Number.isFinite(createdAt) || !Number.isFinite(expiresAt) || now.getTime() >= expiresAt
      || expiresAt - createdAt > PROFILE_CANDIDATE_TTL_MS) {
    return invalid('CANDIDATE_EXPIRED');
  }
  const profile = buildRecommendationProfile(canonicalProfile);
  const expectedHash = buildRecommendationProfileHash(profile, { modelVersion: candidate.modelVersion });
  if (candidate.profileInputHash !== expectedHash) return invalid('CANDIDATE_PROFILE_MISMATCH');
  if (candidate.marketContextIdentity !== marketContextIdentity(marketContext)) {
    return invalid('CANDIDATE_MARKET_CONTEXT_MISMATCH');
  }
  if (candidate.marketObservedAt !== (marketContext?.marketSnapshot?.observedAt
    ?? marketContext?.observedAt
    ?? null)) {
    return invalid('CANDIDATE_MARKET_OBSERVATION_MISMATCH');
  }
  if (!candidate.result || candidate.result.profileInputHash !== candidate.profileInputHash
      || candidate.result.modelVersion !== candidate.modelVersion
      || candidate.result.regulatoryRuleVersion !== candidate.regulatoryRuleVersion
      || candidate.result.marketContextIdentity !== candidate.marketContextIdentity
      || canonicalSha256(candidate.result) !== candidate.resultHash) {
    return invalid('CANDIDATE_RESULT_INTEGRITY_FAILURE');
  }
  try {
    assertCoreResultFinalSafety(profile, candidate.result);
  } catch {
    return invalid('CANDIDATE_FINAL_SAFETY_FAILURE');
  }
  return { valid: true, reason: 'CANDIDATE_VALID' };
}

export async function claimProfileCandidateForCommit(candidateId) {
  if (!validCandidateId(candidateId)) return null;
  const leaseToken = crypto.randomUUID();
  const acquired = await setCacheNX(candidateConsumeKey(candidateId), leaseToken, 60);
  return acquired ? { candidateId, leaseToken } : null;
}

export async function releaseProfileCandidateCommit(lease) {
  if (!lease) return;
  await releaseCacheNX(candidateConsumeKey(lease.candidateId), lease.leaseToken);
}

export async function consumeProfileRecommendationCandidate(lease) {
  if (!lease) return;
  await delCache(candidateKey(lease.candidateId));
  await setCache(candidateConsumedKey(lease.candidateId), { consumedAt: new Date().toISOString() }, 60);
  await releaseProfileCandidateCommit(lease);
}

export function rebindCandidateForProfile(candidate, { userId, profileId, correlationId, traceId }) {
  return rebindCoreRecommendation(candidate.result, {
    userId,
    profileId,
    correlationId,
    traceId,
  });
}

export function candidateCacheKeyForTest(candidateId) {
  return candidateKey(candidateId);
}

export { buildRecommendationCacheKey };

