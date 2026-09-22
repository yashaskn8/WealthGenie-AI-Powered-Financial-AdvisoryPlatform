import crypto from 'node:crypto';

const GRANTS = Object.freeze({
  PLAN_REVIEW: Object.freeze({
    grantId: 'grant:plan-review:1',
    version: 'agent-capability-grant-1.0.0',
    agentType: 'PLAN_REVIEW',
    capabilities: Object.freeze(['propose:plan_recompute', 'read:owned_plan_snapshot', 'invoke:evidence_verifier']),
    forbiddenCapabilities: Object.freeze(['execute:plan_recompute', 'write:recommendation', 'write:financial_profile', 'trade', 'pay', 'transfer', 'rebalance']),
    maxDelegationDepth: 0,
  }),
  EVIDENCE_VERIFIER: Object.freeze({
    grantId: 'grant:evidence-verifier:1',
    version: 'agent-capability-grant-1.0.0',
    agentType: 'EVIDENCE_VERIFIER',
    capabilities: Object.freeze(['verify:evidence', 'verify:grounding']),
    forbiddenCapabilities: Object.freeze(['propose:plan_recompute', 'execute:plan_recompute', 'write:financial_profile']),
    maxDelegationDepth: 0,
  }),
  SCAFFOLD_EVOLUTION: Object.freeze({
    grantId: 'grant:scaffold-evolution:1',
    version: 'agent-capability-grant-1.0.0',
    agentType: 'SCAFFOLD_EVOLUTION',
    capabilities: Object.freeze(['read:sanitized_eval_data', 'create:candidate_scaffold']),
    forbiddenCapabilities: Object.freeze(['access:raw_user_financial_data', 'authorize:action', 'execute:financial_action', 'promote:candidate']),
    maxDelegationDepth: 0,
  }),
});

export function getAgentCapabilityGrant(agentType) {
  const grant = GRANTS[String(agentType || '').toUpperCase()];
  return grant ? Object.freeze({ ...grant }) : null;
}

export function assertCapabilityGrant(grant, capability, { agentType, delegationDepth = 0 } = {}) {
  if (!grant || grant.agentType !== agentType || !grant.capabilities.includes(capability) || grant.forbiddenCapabilities.includes(capability)) {
    const error = new Error(`Capability grant denied: ${capability}`);
    error.code = 'AGENT_CAPABILITY_DENIED';
    throw error;
  }
  if (delegationDepth > grant.maxDelegationDepth) {
    const error = new Error('Delegation depth exceeds the capability grant.');
    error.code = 'DELEGATION_DEPTH_EXCEEDED';
    throw error;
  }
  return true;
}

export function buildGrantFingerprint(grant) {
  return crypto.createHash('sha256').update(JSON.stringify(grant)).digest('hex');
}

export { GRANTS as AGENT_CAPABILITY_GRANTS };

