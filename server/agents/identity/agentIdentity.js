const CAPABILITIES = Object.freeze({
  PLAN_REVIEW: Object.freeze(['read_profile_context', 'read_recommendation_summary', 'read_evidence', 'grounded_review', 'propose:plan_recompute', 'invoke:financial_research']),
  EVIDENCE_VERIFIER: Object.freeze(['validate_evidence_ids', 'detect_unsupported_claims', 'detect_prompt_injection']),
  FINANCIAL_RESEARCH: Object.freeze(['search:public_financial_sources', 'retrieve:public_document', 'extract:public_evidence', 'verify:research_claim', 'emit:research_artifact']),
  SCAFFOLD_EVOLUTION: Object.freeze(['read_sanitized_trajectory', 'run_offline_evaluation']),
});

export function createAgentIdentity({ agentType, provider = 'development', subject = null, env = process.env } = {}) {
  const type = String(agentType || '').toUpperCase();
  if (!CAPABILITIES[type]) throw new Error('Unknown agent identity.');
  if (provider === 'development' && env.NODE_ENV === 'production') {
    const error = new Error('Development agent identity is not permitted in production.');
    error.code = 'AGENT_IDENTITY_NOT_PRODUCTION_READY';
    throw error;
  }
  if (!['development', 'oidc', 'spiffe'].includes(provider)) throw new Error('Unsupported agent identity provider.');
  if (provider !== 'development' && !subject) throw new Error('OIDC/SPIFFE identities require an authenticated subject.');
  return Object.freeze({
    agentType: type,
    provider,
    subject: subject ? String(subject).slice(0, 120) : `dev:${type.toLowerCase()}`,
    capabilities: CAPABILITIES[type],
    authenticated: provider !== 'development' || env.NODE_ENV !== 'production',
  });
}

export function assertAgentCapability(identity, capability) {
  if (!identity?.capabilities?.includes(capability)) {
    const error = new Error(`Agent capability denied: ${capability}`);
    error.code = 'AGENT_CAPABILITY_DENIED';
    throw error;
  }
  return true;
}

export { CAPABILITIES as AGENT_CAPABILITIES };
