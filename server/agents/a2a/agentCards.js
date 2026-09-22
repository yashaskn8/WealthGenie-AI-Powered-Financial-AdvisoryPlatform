export const A2A_PROTOCOL_VERSION = 'a2a-inspired-internal-1.0.0';

const CARDS = Object.freeze({
  PLAN_REVIEW: Object.freeze({
    name: 'PlanReviewAgent',
    version: '2.0.0',
    protocolVersion: A2A_PROTOCOL_VERSION,
    capabilities: Object.freeze(['read_profile_context', 'read_recommendation_summary', 'read_evidence', 'grounded_review', 'propose:plan_recompute']),
    forbiddenCapabilities: Object.freeze(['execute:plan_recompute', 'write:recommendation', 'write:financial_profile', 'trade', 'pay', 'transfer', 'rebalance']),
    canMutateFinancialAuthority: false,
    accepts: Object.freeze(['plan_review_request']),
    emits: Object.freeze(['plan_review_result', 'approval_descriptor']),
  }),
  EVIDENCE_VERIFIER: Object.freeze({
    name: 'EvidenceVerifierAgent',
    version: '1.0.0',
    protocolVersion: A2A_PROTOCOL_VERSION,
    capabilities: Object.freeze(['validate_evidence_ids', 'detect_unsupported_claims', 'detect_prompt_injection']),
    canMutateFinancialAuthority: false,
    accepts: Object.freeze(['evidence_verification_request']),
    emits: Object.freeze(['evidence_verification_result']),
  }),
});

export function getAgentCard(agentType) { return CARDS[String(agentType || '').toUpperCase()] || null; }
export function listAgentCards() { return Object.values(CARDS); }
