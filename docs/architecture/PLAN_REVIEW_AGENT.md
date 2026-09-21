# WealthGenie Plan Review Agent

The Plan Review Agent is a bounded, read-only evidence review over the current
authenticated user's saved plan. It can explain freshness and evidence gaps,
but it cannot generate a replacement recommendation, calculate new allocations,
rebalance a portfolio, or write FinancialProfile, Recommendation, or Goal data.

The Plan Review Agent is not a recommendation authority.

```text
Authenticated request
        |
        v
POST /api/agent/plan-review { profileId }
        |
        | JWT + ownership + rate limit + feature flag
        v
LangGraph Plan Review graph (bounded: 6 steps / 8 tool calls)
        |
        +--> load_context ----------------------+
        |                                        |
        +--> check_recommendation_freshness      |
        |      (shared read-only assessor)       |
        |                                        v
        +--> determine_required_checks --> execute_safe_tools
                                           |
                                           +--> profile context
                                           +--> recommendation summary
                                           +--> freshness
                                           +--> evidence snapshot
                                           +--> goal status
                                                   |
                                                   v
                                      validate evidence
                                                   |
                                                   v
                                      grounded synthesis
                                      (ProviderManager only)
                                                   |
                                                   v
                                      output validation
                                      + policy guard
                                                   |
                                                   v
                                      AgentRun metadata/result only
                                                   |
                                                   v
                                            structured response
```

## Authority boundaries

- `FinancialProfile`, `Recommendation`, and `Goal` are queried with the
  authenticated `userId` and are never mutated by the agent.
- `FinancialToolRegistry`, optimizer, rebalance, raw Mongo access, HTTP tools,
  shell tools, and external MCP-over-HTTP are not exposed to the graph.
- Current recommendation freshness is assessed by
  `server/services/recommendationFreshness.js`, which compares the canonical
  profile fingerprint, model metadata, and current regulatory policy version.
- The final review has a versioned contract and deterministic routing. Provider
  outage, invalid JSON, unsafe language, unknown evidence IDs, prompt
  injection, or unavailable evidence falls back to an explicit limitation.
- Only `AgentRun` metadata and the safe structured review result are persisted.

## UI behavior

The My Plan page exposes a `Review my plan` action with bounded progress states
and a read-only evidence dialog. A separate `Recompute plan` action delegates
to the existing authoritative dashboard recommendation workflow; it is never
implemented as an agent tool.

Set `AGENTIC_PLAN_REVIEW_ENABLED=true` to enable the route in production. The
development runtime enables the feature by default; production remains
opt-in. The limits can be tightened with `AGENT_MAX_STEPS`,
`AGENT_MAX_TOOL_CALLS`, `AGENT_MAX_TOOL_CALLS_PER_TOOL`, and `AGENT_TIMEOUT_MS`.
