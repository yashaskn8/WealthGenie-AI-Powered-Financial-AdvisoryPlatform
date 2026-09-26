import crypto from 'node:crypto';
import { canonicalSha256 } from '../../utils/canonicalJson.js';
import FinancialProfile from '../../models/FinancialProfile.js';
import Recommendation from '../../models/Recommendation.js';
import UserIntentMandate from '../../models/UserIntentMandate.js';
import MandateApprovalChallenge from '../../models/MandateApprovalChallenge.js';
import PasskeyCredential from '../../models/PasskeyCredential.js';
import AgentRun from '../../models/AgentRun.js';
import { buildRecommendationProfile, buildRecommendationProfileHash, RECOMMENDATION_POLICY_VERSION } from '../../services/recommendationProfile.js';
import { createAuthorizationKeyProvider } from './keyProvider.js';
import { createTrustedApprovalProvider } from './approvalProviders.js';
import { evaluateAuthorizationPolicy } from './policyEngine.js';
import { getAgentCapabilityGrant } from './capabilityGrants.js';
import {
  APPROVE_RECOMPUTE,
  AUTHORIZATION_AUDIENCE,
  AUTHORIZATION_POLICY_VERSION,
  AUTHORIZATION_VERSION,
  DEFAULT_MANDATE_TTL_SECONDS,
  MAX_MANDATE_TTL_SECONDS,
  mandateError,
} from './authorizationConstants.js';
import { canonicalizeMandate, hashActionPayload, hashMandatePayload, verifyMandatePayloadHash } from './canonicalization.js';
import { PrometheusMetrics } from '../../services/metricsCollector.js';
import { assertVerifiedAgentIdentity, createAgentIdentityVerifier } from '../identity/agentIdentityVerifier.js';
import { normalizeCredentialId, normalizePublicKey } from './webAuthnBytes.js';
import { resolvePlanReviewSnapshot } from '../planReview/planReviewSnapshot.js';
import { hashPlanReviewSnapshot } from '../planReview/planReviewRuntime.js';

function asId(value) { return value === null || value === undefined ? null : String(value); }

export function buildSnapshotFingerprint({ profile, recommendation = null, policyVersion = RECOMMENDATION_POLICY_VERSION }) {
  if (!profile?._id) throw new TypeError('A persisted profile is required for snapshot binding.');
  const canonicalProfile = buildRecommendationProfile(profile);
  const modelVersion = recommendation?.modelVersion || 'no-recommendation';
  const profileInputHash = buildRecommendationProfileHash(canonicalProfile, { modelVersion });
  const recommendationFingerprint = recommendation?.profileInputHash || canonicalSha256({ recommendationId: null, profileId: String(profile._id) });
  return {
    profileId: String(profile._id),
    profileVersion: Number(profile.version || 1),
    recommendationId: asId(recommendation?._id),
    recommendationFingerprint,
    profileInputHash,
    modelVersion,
    policyVersion,
    financialSnapshotHash: canonicalSha256({
      profileId: String(profile._id),
      profileVersion: Number(profile.version || 1),
      profileInputHash,
      recommendationId: asId(recommendation?._id),
      recommendationFingerprint,
      modelVersion,
      policyVersion,
    }),
  };
}

export function buildMandateDraft({ run, profile, recommendation = null, agentIdentity, approvalMethod = 'DEVELOPMENT', now = new Date(), ttlSeconds = DEFAULT_MANDATE_TTL_SECONDS, correlationId = null }) {
  if (!run?.runId || run.status !== 'WAITING_FOR_APPROVAL') throw mandateError('MANDATE_SOURCE_NOT_APPROVABLE', 'This plan review is not waiting for approval.');
  if (run.recommendedAction !== 'RECOMPUTE_PLAN') throw mandateError('ACTION_NOT_PROPOSED', 'This plan review did not propose recompute.');
  if (!profile?._id || String(profile._id) !== String(run.profileId)) throw mandateError('RESOURCE_OWNERSHIP_DENIED', 'The plan review resource is unavailable.');
  if (typeof run.planReviewSnapshotHash !== 'string' || !/^[a-f0-9]{64}$/.test(run.planReviewSnapshotHash)) {
    throw mandateError('PLAN_REVIEW_SOURCE_UNBOUND', 'This plan review is not bound to a verified financial source snapshot.', 409);
  }
  assertVerifiedAgentIdentity(agentIdentity, { allowDevelopment: true });
  const boundedTtl = Math.min(MAX_MANDATE_TTL_SECONDS, Math.max(1, Number(ttlSeconds) || DEFAULT_MANDATE_TTL_SECONDS));
  const snapshot = buildSnapshotFingerprint({ profile, recommendation });
  const mandateId = crypto.randomUUID();
  const issuedAt = new Date(now);
  const expiresAt = new Date(issuedAt.getTime() + boundedTtl * 1000);
  const actionPayload = {
    profileId: snapshot.profileId,
    recommendationId: snapshot.recommendationId,
    profileVersion: snapshot.profileVersion,
  };
  const grant = getAgentCapabilityGrant('PLAN_REVIEW');
  if (!grant) throw mandateError('AGENT_CAPABILITY_DENIED', 'Plan Review Agent capability grant is unavailable.', 500);
  const mandate = {
    mandateId,
    version: AUTHORIZATION_VERSION,
    issuer: 'wealthgenie.plan-review',
    subject: `user:${String(run.userId)}`,
    audience: AUTHORIZATION_AUDIENCE,
    userId: String(run.userId),
    agentIdentity,
    agentType: 'PLAN_REVIEW',
    agentVersion: run.agentVersion || 'plan-review-agent-unknown',
    runId: String(run.runId),
    correlationId: correlationId || run.correlationId || null,
    action: APPROVE_RECOMPUTE,
    resourceType: 'FinancialProfile',
    resourceId: snapshot.profileId,
    profileId: snapshot.profileId,
    recommendationId: snapshot.recommendationId,
    financialSnapshotHash: snapshot.financialSnapshotHash,
    recommendationFingerprint: snapshot.recommendationFingerprint,
    planReviewSnapshotHash: run.planReviewSnapshotHash,
    policyVersion: AUTHORIZATION_POLICY_VERSION,
    actionPayloadHash: hashActionPayload(actionPayload),
    constraints: {
      maxAgeSeconds: boundedTtl,
      allowedAgentType: 'PLAN_REVIEW',
      resourceVersion: snapshot.profileVersion,
      noFinancialMutationByAgent: true,
    },
    issuedAt: issuedAt.toISOString(),
    notBefore: issuedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    nonce: crypto.randomBytes(24).toString('base64url'),
    singleUse: true,
    parentGrantId: grant.grantId,
    delegationDepth: 0,
    approvalMethod,
    status: 'DRAFT',
  };
  return Object.freeze({ ...mandate, mandateHash: hashMandatePayload(mandate) });
}

function publicMandate(mandate) {
  const source = typeof mandate.toObject === 'function' ? mandate.toObject() : mandate;
  return {
    mandateId: source.mandateId,
    version: source.version,
    action: source.action,
    agentType: source.agentType,
    agentVersion: source.agentVersion,
    runId: source.runId,
    profileId: asId(source.profileId),
    recommendationId: asId(source.recommendationId),
    financialSnapshotHash: source.financialSnapshotHash,
    recommendationFingerprint: source.recommendationFingerprint,
    policyVersion: source.policyVersion,
    actionPayloadHash: source.actionPayloadHash,
    constraints: source.constraints,
    issuedAt: source.issuedAt,
    notBefore: source.notBefore,
    expiresAt: source.expiresAt,
    singleUse: source.singleUse,
    approvalMethod: source.approvalMethod,
    status: source.status,
    mandateHash: source.mandateHash,
    signatureMetadata: source.signatureMetadata || null,
    approval: source.approval || null,
    receiptId: source.receiptId || null,
  };
}

function verifyMandateRecord(mandate, keyProvider) {
  if (!mandate?.mandateHash || !verifyMandatePayloadHash(mandate, mandate.mandateHash)) throw mandateError('MANDATE_SIGNATURE_INVALID', 'Mandate payload integrity verification failed.');
  const metadata = mandate.signatureMetadata;
  const verified = metadata?.algorithm === 'Ed25519'
    && metadata.keyId
    && (typeof keyProvider?.verifyByKeyId === 'function'
      ? keyProvider.verifyByKeyId(canonicalizeMandate(mandate), metadata.signature, metadata.keyId)
      : keyProvider?.verify?.(canonicalizeMandate(mandate), metadata.signature, metadata.keyId));
  if (!verified) throw mandateError('MANDATE_SIGNATURE_INVALID', 'Mandate signature verification failed.');
  return true;
}

export async function createMandateForPlanReview({ runId, userId, correlationId = null, ttlSeconds, dependencies = {}, runtimeConfig = {} }) {
  const models = { agentRunModel: AgentRun, profileModel: FinancialProfile, recommendationModel: Recommendation, mandateModel: UserIntentMandate, ...dependencies };
  const run = await models.agentRunModel.findOne({ runId, userId }).lean();
  if (!run) throw mandateError('PLAN_REVIEW_NOT_FOUND', 'Plan review run not found.', 404);
  const profile = await models.profileModel.findOne({ _id: run.profileId, userId }).lean();
  if (!profile) throw mandateError('RESOURCE_OWNERSHIP_DENIED', 'Financial profile not found or access denied.', 404);
  if (typeof run.planReviewSnapshotHash !== 'string'
    || !/^[a-f0-9]{64}$/.test(run.planReviewSnapshotHash)
    || !run.sourceBinding
    || hashPlanReviewSnapshot(run.sourceBinding) !== run.planReviewSnapshotHash
    || String(run.sourceBinding.userId) !== String(userId)
    || String(run.sourceBinding.profileId) !== String(run.profileId)
    || String(run.sourceBinding.recommendationId || '') !== String(run.recommendationId || '')) {
    throw mandateError('PLAN_REVIEW_SOURCE_UNBOUND', 'This plan review is not bound to a verified financial source snapshot.', 409);
  }
  const snapshotResolver = dependencies.planReviewSnapshotResolver || resolvePlanReviewSnapshot;
  const currentSnapshot = await snapshotResolver({
    userId,
    profileId: run.profileId,
    profileModel: models.profileModel,
    dependencies: dependencies.planReviewSnapshotDependencies || {},
  });
  if (currentSnapshot.planReviewSnapshotHash !== run.planReviewSnapshotHash) {
    throw mandateError('PLAN_REVIEW_SOURCE_SUPERSEDED', 'The financial source state changed after this review. Run a new plan review before requesting approval.', 409);
  }
  const recommendationId = run.sourceBinding.recommendationId;
  const recommendation = recommendationId
    ? await models.recommendationModel.findOne({ _id: recommendationId, profileId: run.profileId, userId }).lean()
    : null;
  if (recommendationId && (!recommendation || String(recommendation._id) !== String(recommendationId))) {
    throw mandateError('PLAN_REVIEW_SOURCE_SUPERSEDED', 'The recommendation bound to this review is no longer available.', 409);
  }
  const env = runtimeConfig.env || process.env;
  const identityVerifier = dependencies.agentIdentityVerifier || createAgentIdentityVerifier({ env, dependencies });
  const agentIdentity = dependencies.agentIdentity
    ? assertVerifiedAgentIdentity(dependencies.agentIdentity, { allowDevelopment: true, env })
    : await identityVerifier.verify({
      agentType: 'PLAN_REVIEW',
      token: dependencies.agentIdentityToken || env.AGENT_IDENTITY_ASSERTION,
      svid: dependencies.svid,
    });
  const provider = dependencies.approvalProvider || createTrustedApprovalProvider({ env: runtimeConfig.env || process.env, verifier: dependencies.webauthnVerifier });
  const draft = buildMandateDraft({ run, profile, recommendation, agentIdentity, approvalMethod: provider.name, ttlSeconds, correlationId });
  const mandate = await models.mandateModel.create({ ...draft, userId });
  PrometheusMetrics.inc('mandates_created_total');
  return publicMandate(mandate);
}

export async function getMandateForUser({ mandateId, userId, model = UserIntentMandate }) {
  const mandate = await model.findOne({ mandateId, userId }).lean();
  return mandate ? publicMandate(mandate) : null;
}

export async function listMandatesForUser({ userId, limit = 50, model = UserIntentMandate }) {
  const boundedLimit = Math.min(100, Math.max(1, Number(limit) || 50));
  const rows = await model.find({ userId }).sort({ createdAt: -1 }).limit(boundedLimit).lean();
  return rows.map(publicMandate);
}

export async function createApprovalOptions({ mandateId, userId, dependencies = {}, runtimeConfig = {} }) {
  const models = { mandateModel: UserIntentMandate, challengeModel: MandateApprovalChallenge, credentialModel: PasskeyCredential, ...dependencies };
  const mandate = await models.mandateModel.findOne({ mandateId, userId }).lean();
  if (!mandate) throw mandateError('MANDATE_NOT_FOUND', 'Mandate not found or access denied.', 404);
  if (new Date(mandate.expiresAt).getTime() <= Date.now()) throw mandateError('MANDATE_EXPIRED', 'This authorization has expired.');
  if (mandate.status !== 'DRAFT' && mandate.status !== 'PENDING_USER_VERIFICATION') throw mandateError('MANDATE_NOT_APPROVABLE', 'This mandate is not awaiting approval.');
  const provider = dependencies.approvalProvider || createTrustedApprovalProvider({ env: runtimeConfig.env || process.env, verifier: dependencies.webauthnVerifier });
  if (mandate.approvalMethod !== provider.name) throw mandateError('TRUSTED_APPROVAL_INVALID', 'The approval provider does not match this mandate.');
  let credentialIds = [];
  if (provider.name === 'WEBAUTHN') {
    const credentials = await models.credentialModel.find({ userId }).lean();
    if (!credentials.length) throw mandateError('STEP_UP_ENROLLMENT_REQUIRED', 'Enroll a passkey before approving this action.', 428);
    credentialIds = credentials.map(item => item.credentialId);
  }
  const options = await provider.createOptions({ mandate, credentialIds });
  if (provider.name === 'WEBAUTHN') {
    await models.challengeModel.findOneAndUpdate(
      { mandateId, userId },
      { $set: { mandateId, userId, challenge: options.challenge, mandateHash: mandate.mandateHash, expiresAt: mandate.expiresAt, consumedAt: null } },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
  }
  const updated = await models.mandateModel.findOneAndUpdate(
    {
      mandateId,
      userId,
      status: { $in: ['DRAFT', 'PENDING_USER_VERIFICATION'] },
      $expr: { $gt: ['$expiresAt', '$$NOW'] },
    },
    { $set: { status: 'PENDING_USER_VERIFICATION' } },
    { new: true },
  );
  if (!updated) throw mandateError('MANDATE_NOT_APPROVABLE', 'This mandate changed or expired while approval options were being created.');
  return { mandate: publicMandate(updated), provider: provider.name, options };
}

export async function verifyMandateApproval({ mandateId, userId, assertion, dependencies = {}, runtimeConfig = {} }) {
  const models = { mandateModel: UserIntentMandate, challengeModel: MandateApprovalChallenge, credentialModel: PasskeyCredential, ...dependencies };
  const mandate = await models.mandateModel.findOne({ mandateId, userId }).lean();
  if (!mandate) throw mandateError('MANDATE_NOT_FOUND', 'Mandate not found or access denied.', 404);
  if (mandate.status !== 'PENDING_USER_VERIFICATION') throw mandateError('MANDATE_NOT_APPROVABLE', 'This mandate is not awaiting verification.');
  if (new Date(mandate.expiresAt).getTime() <= Date.now()) {
    await models.mandateModel.updateOne({ mandateId, userId, status: 'PENDING_USER_VERIFICATION' }, { $set: { status: 'EXPIRED', failureCode: 'MANDATE_EXPIRED' } });
    throw mandateError('MANDATE_EXPIRED', 'This authorization has expired.');
  }
  const provider = dependencies.approvalProvider || createTrustedApprovalProvider({ env: runtimeConfig.env || process.env, verifier: dependencies.webauthnVerifier });
  if (mandate.approvalMethod !== provider.name) throw mandateError('TRUSTED_APPROVAL_INVALID', 'The approval provider does not match this mandate.');
  let credential = null;
  let expectedChallenge = null;
  if (provider.name === 'WEBAUTHN') {
    const challenge = await models.challengeModel.findOne({ mandateId, userId, consumedAt: null }).lean();
    if (!challenge || new Date(challenge.expiresAt).getTime() <= Date.now()) throw mandateError('TRUSTED_APPROVAL_INVALID', 'The passkey challenge is missing or expired.');
    if (assertion?.mandateHash !== mandate.mandateHash) throw mandateError('TRUSTED_APPROVAL_INVALID', 'The passkey assertion is bound to a different mandate.');
    const assertedCredentialId = normalizeCredentialId(assertion.credentialId);
    const storedCredential = await models.credentialModel.findOne({ userId, credentialId: assertedCredentialId }).lean();
    if (!storedCredential) throw mandateError('TRUSTED_APPROVAL_INVALID', 'The passkey credential is not registered to this user.');
    credential = {
      id: assertedCredentialId,
      publicKey: normalizePublicKey(storedCredential.publicKey),
      counter: storedCredential.counter,
      transports: storedCredential.transports || [],
    };
    expectedChallenge = challenge.challenge;
  }
  const approval = await provider.verify({ mandate, assertion: { ...assertion, expectedChallenge }, credential });
  const decision = evaluateAuthorizationPolicy({
    authenticated: true,
    ownsResource: true,
    action: mandate.action,
    audience: mandate.audience,
    agentType: mandate.agentType,
    agentIdentityAuthenticated: mandate.agentIdentity?.authenticated === true,
    capabilityGrant: getAgentCapabilityGrant(mandate.agentType),
    delegationDepth: mandate.delegationDepth,
    approvalMethod: provider.name,
    approvalVerified: approval.verified === true,
    production: (runtimeConfig.env || process.env).NODE_ENV === 'production',
    policyVersion: mandate.policyVersion,
    mandateId,
  });
  if (decision.decision !== 'ALLOW') throw mandateError(decision.reasonCodes[0] || 'AUTHORIZATION_DENIED', 'The authorization policy denied this approval.');
  if (provider.name === 'WEBAUTHN') {
    if (!Number.isInteger(approval.newCounter) || approval.newCounter < 0) {
      throw mandateError('TRUSTED_APPROVAL_INVALID', 'Passkey authenticator counter is invalid.');
    }
    if (!['singleDevice', 'multiDevice'].includes(approval.deviceType) || typeof approval.backedUp !== 'boolean') {
      throw mandateError('TRUSTED_APPROVAL_INVALID', 'Passkey backup eligibility/state is unavailable.');
    }
    const counterUpdate = await models.credentialModel.findOneAndUpdate(
      { userId, credentialId: credential.id, counter: credential.counter },
      { $set: {
        counter: approval.newCounter,
        deviceType: approval.deviceType,
        backedUp: approval.backedUp,
        lastUsedAt: new Date(),
      } },
      { new: true },
    );
    if (!counterUpdate) throw mandateError('TRUSTED_APPROVAL_INVALID', 'Passkey authenticator counter changed unexpectedly.');
    const challengeConsumed = await models.challengeModel.findOneAndUpdate(
      {
        mandateId,
        userId,
        mandateHash: mandate.mandateHash,
        consumedAt: null,
        $expr: { $gt: ['$expiresAt', '$$NOW'] },
      },
      { $set: { consumedAt: new Date() } },
      { new: true },
    );
    if (!challengeConsumed) throw mandateError('MANDATE_ALREADY_CONSUMED', 'The passkey challenge was already consumed.');
  }
  const keyProvider = dependencies.keyProvider || createAuthorizationKeyProvider({ env: runtimeConfig.env || process.env, required: (runtimeConfig.env || process.env).NODE_ENV === 'production' });
  const signature = keyProvider.sign(canonicalizeMandate(mandate));
  const update = await models.mandateModel.findOneAndUpdate(
    {
      mandateId,
      userId,
      status: 'PENDING_USER_VERIFICATION',
      mandateHash: mandate.mandateHash,
      $expr: { $gt: ['$expiresAt', '$$NOW'] },
    },
    { $set: { status: 'AUTHORIZED', approval: {
      method: provider.name,
      verifiedAt: approval.verifiedAt,
      credentialId: approval.credentialId,
      authenticatorCounter: approval.newCounter || null,
      credentialDeviceType: approval.deviceType || null,
      credentialBackedUp: typeof approval.backedUp === 'boolean' ? approval.backedUp : null,
    }, signatureMetadata: { ...keyProvider.metadata(), signature } } },
    { new: true },
  ).lean();
  if (!update) {
    const expired = await models.mandateModel.findOne({
      mandateId,
      userId,
      status: 'PENDING_USER_VERIFICATION',
      $expr: { $lte: ['$expiresAt', '$$NOW'] },
    }).lean();
    if (expired) {
      await models.mandateModel.updateOne(
        {
          mandateId,
          userId,
          status: 'PENDING_USER_VERIFICATION',
          $expr: { $lte: ['$expiresAt', '$$NOW'] },
        },
        { $set: { status: 'EXPIRED', failureCode: 'MANDATE_EXPIRED' } },
      );
      throw mandateError('MANDATE_EXPIRED', 'This authorization expired during passkey verification.');
    }
    throw mandateError('MANDATE_ALREADY_CONSUMED', 'This mandate changed while it was being approved.');
  }
  PrometheusMetrics.inc('mandates_authorized_total');
  return publicMandate(update);
}

export async function revokeMandate({ mandateId, userId, reason = 'User revoked authorization.', model = UserIntentMandate }) {
  const updated = await model.findOneAndUpdate(
    { mandateId, userId, status: { $in: ['DRAFT', 'PENDING_USER_VERIFICATION', 'AUTHORIZED'] } },
    { $set: { status: 'REVOKED', revokedAt: new Date(), revocationReason: String(reason).slice(0, 240) } },
    { new: true },
  ).lean();
  if (!updated) {
    const existing = await model.findOne({ mandateId, userId }).lean();
    if (!existing) throw mandateError('MANDATE_NOT_FOUND', 'Mandate not found or access denied.', 404);
    if (existing.status === 'REVOKED') return publicMandate(existing);
    throw mandateError('MANDATE_NOT_REVOCABLE', 'This mandate can no longer be revoked.');
  }
  PrometheusMetrics.inc('mandates_revoked_total');
  return publicMandate(updated);
}

export function assertVerifiableMandate(mandate, { keyProvider, now = new Date() } = {}) {
  if (!mandate) throw mandateError('MANDATE_NOT_FOUND', 'Mandate not found.', 404);
  if (mandate.version !== AUTHORIZATION_VERSION) throw mandateError('UNKNOWN_MANDATE_VERSION', 'The mandate version is not supported.', 400);
  if (mandate.action !== APPROVE_RECOMPUTE) throw mandateError('ACTION_NOT_ALLOWLISTED', 'The requested action is not allowlisted.');
  if (new Date(mandate.expiresAt).getTime() <= now.getTime()) throw mandateError('MANDATE_EXPIRED', 'This authorization has expired.');
  if (mandate.status === 'REVOKED') throw mandateError('MANDATE_REVOKED', 'This authorization has been revoked.');
  if (mandate.status === 'EXECUTED' || mandate.status === 'EXECUTING') throw mandateError('MANDATE_ALREADY_CONSUMED', 'This authorization has already been consumed.');
  if (mandate.status !== 'AUTHORIZED') throw mandateError('MANDATE_NOT_AUTHORIZED', 'This mandate has not been cryptographically authorized.');
  if (!keyProvider) throw new Error('A mandate verification key provider is required.');
  verifyMandateRecord(mandate, keyProvider);
  return true;
}

export { publicMandate, verifyMandateRecord };
