import { AUTHORIZATION_AUDIENCE, AUTHORIZATION_POLICY_VERSION, APPROVE_RECOMPUTE, AUTHORIZATION_REASON_CODES } from './authorizationConstants.js';
import { assertCapabilityGrant } from './capabilityGrants.js';

export function evaluateAuthorizationPolicy(input = {}) {
  const reasons = [];
  if (input.authenticated !== true) reasons.push(AUTHORIZATION_REASON_CODES.AUTHENTICATION_REQUIRED);
  if (input.ownsResource !== true) reasons.push(AUTHORIZATION_REASON_CODES.OWNERSHIP_DENIED);
  if (input.action !== APPROVE_RECOMPUTE) reasons.push(AUTHORIZATION_REASON_CODES.ACTION_NOT_ALLOWED);
  if (input.audience !== AUTHORIZATION_AUDIENCE) reasons.push(AUTHORIZATION_REASON_CODES.AUDIENCE_MISMATCH);
  if (input.agentType !== 'PLAN_REVIEW' || input.agentIdentityAuthenticated !== true) reasons.push(AUTHORIZATION_REASON_CODES.AGENT_NOT_ALLOWED);
  try {
    assertCapabilityGrant(input.capabilityGrant, 'propose:plan_recompute', { agentType: input.agentType, delegationDepth: input.delegationDepth });
  } catch (error) {
    reasons.push(error.code === 'DELEGATION_DEPTH_EXCEEDED' ? error.code : AUTHORIZATION_REASON_CODES.CAPABILITY_DENIED);
  }
  if (input.approvalMethod === 'WEBAUTHN' && input.approvalVerified !== true) reasons.push(AUTHORIZATION_REASON_CODES.INVALID_APPROVAL);
  if (input.approvalMethod === 'DEVELOPMENT' && input.production === true) reasons.push('DEVELOPMENT_APPROVAL_IN_PRODUCTION');
  if (input.snapshotMatch === false) reasons.push(AUTHORIZATION_REASON_CODES.SNAPSHOT_MISMATCH);
  if (input.policyVersion && input.policyVersion !== AUTHORIZATION_POLICY_VERSION) reasons.push(AUTHORIZATION_REASON_CODES.POLICY_MISMATCH);
  return {
    decision: reasons.length ? 'DENY' : (input.approvalVerified ? 'ALLOW' : 'REQUIRES_APPROVAL'),
    reasonCodes: [...new Set(reasons)],
    policyVersion: AUTHORIZATION_POLICY_VERSION,
    decisionId: `${AUTHORIZATION_POLICY_VERSION}:${input.mandateId || 'draft'}`,
  };
}

