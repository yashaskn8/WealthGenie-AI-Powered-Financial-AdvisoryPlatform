/**
 * Explicit MCP exposure policy. Registry tools are private by default; adding
 * a backend calculator never implicitly makes it remotely callable.
 */
const policy = value => Object.freeze({
  authority: 'NON_AUTHORITATIVE',
  readOnly: true,
  nonMutating: true,
  ...value,
});

export const MCP_TOOL_POLICY = Object.freeze({
  sip_projection: policy({ exposed: true, profileContext: 'optional', costClass: 'LOW', remoteAllowed: true, stdioAllowed: true, assumptionBasis: 'USER_SUPPLIED_NOMINAL_ASSUMPTION' }),
  lump_sum_projection: policy({ exposed: true, profileContext: 'optional', costClass: 'LOW', remoteAllowed: true, stdioAllowed: true, assumptionBasis: 'USER_SUPPLIED_NOMINAL_ASSUMPTION' }),
  reverse_sip: policy({ exposed: true, profileContext: 'none', costClass: 'LOW', remoteAllowed: true, stdioAllowed: true, assumptionBasis: 'USER_SUPPLIED_NOMINAL_ASSUMPTION' }),
  tax_calculator: policy({ exposed: true, profileContext: 'none', costClass: 'MEDIUM', remoteAllowed: true, stdioAllowed: true, assumptionBasis: 'FISCAL_YEAR_VERSIONED_TAX_POLICY' }),
  xirr_calculator: policy({ exposed: true, profileContext: 'none', costClass: 'MEDIUM', remoteAllowed: true, stdioAllowed: true, assumptionBasis: 'USER_SUPPLIED_HISTORICAL_CASHFLOWS' }),
  portfolio_optimizer: policy({ exposed: true, profileContext: 'required', costClass: 'HIGH', remoteAllowed: true, stdioAllowed: false, assumptionBasis: 'WEALTHGENIE_MODEL_POLICY' }),
  rebalance_calculator: policy({ exposed: true, profileContext: 'required', costClass: 'HIGH', remoteAllowed: true, stdioAllowed: false, assumptionBasis: 'USER_SUPPLIED_WHAT_IF' }),
});

export function isMcpToolAllowed(tool, { transport = 'remote' } = {}) {
  const approvedPolicy = MCP_TOOL_POLICY[tool?.name];
  const policy = tool?.mcpPolicy;
  return Boolean(approvedPolicy && policy === approvedPolicy
    && policy?.exposed === true
    && policy.authority === 'NON_AUTHORITATIVE'
    && policy.readOnly === true
    && policy.nonMutating === true
    && ['none', 'optional', 'required'].includes(policy.profileContext)
    && ['LOW', 'MEDIUM', 'HIGH'].includes(policy.costClass)
    && (transport === 'stdio' ? policy.stdioAllowed === true : policy.remoteAllowed === true));
}

export function mcpOutputSchema() {
  return {
    type: 'object',
    properties: {
      classification: { type: 'string', minLength: 1, maxLength: 80 },
      authority: { const: 'NON_AUTHORITATIVE' },
      tool: { type: 'string', enum: Object.keys(MCP_TOOL_POLICY) },
      toolVersion: { type: 'string', pattern: '^\\d+\\.\\d+\\.\\d+$' },
      calculationVersion: { type: 'string', pattern: '^\\d+\\.\\d+\\.\\d+$' },
      assumptionBasis: { type: 'string', minLength: 1, maxLength: 100 },
      profileGrounded: { type: 'boolean' },
      profileVersion: { type: 'integer', minimum: 1 },
      profileSnapshotHash: { type: 'string', pattern: '^[a-f0-9]{64}$' },
      result: { type: 'object', additionalProperties: true },
    },
    required: ['classification', 'authority', 'tool', 'toolVersion', 'calculationVersion', 'assumptionBasis', 'profileGrounded', 'result'],
    additionalProperties: false,
  };
}

export function buildMcpResult({ toolName, tool, result, profile = null, profileVersion = null, profileSnapshotHash = null }) {
  const policy = tool.mcpPolicy;
  return {
    classification: String(result?.classification || 'NON_RECOMMENDATION_WHAT_IF').slice(0, 80),
    authority: 'NON_AUTHORITATIVE',
    tool: toolName,
    toolVersion: tool.version,
    calculationVersion: tool.version,
    assumptionBasis: String(result?.returnBasis || result?.assumptionBasis || policy.assumptionBasis).slice(0, 100),
    profileGrounded: Boolean(profile),
    ...(profile ? { profileVersion, profileSnapshotHash } : {}),
    result,
  };
}
