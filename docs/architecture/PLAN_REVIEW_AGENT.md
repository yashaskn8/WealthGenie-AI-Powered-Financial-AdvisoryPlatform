# WealthGenie Plan Review Agent

## Durable runtime

The request path creates an owned `AgentRun` in `QUEUED` state and returns
`202`. A Mongo-backed worker claims it with a lease and executes the existing
bounded LangGraph. Bounded checkpoints are written after graph/tool progress so
worker recovery can reuse completed read-only tool results rather than starting
an unbounded duplicate run.

```text
POST /agent/plan-review
        |
        v
owned AgentRun (QUEUED) --> Mongo lease --> LangGraph nodes
        |                                      |
        |                                      +--> safe tools --> evidence/policy
        |                                      +--> checkpoint + ledger + trajectory
        v
GET /agent/plan-review/:runId <--- result / approval descriptor
```

Runs are deduplicated per user/profile while active, limited to two whole-run
attempts, and recover stale leases. Cancellation is explicit. `APPROVE_RECOMPUTE`
returns an action descriptor only; it never mutates a profile, recommendation,
allocation, or trade. The authoritative recompute workflow remains outside the
agent.

The deterministic Plan Health Monitor reads profile/recommendation freshness,
records deduplicated `PlanHealthEvent` metadata, and exposes acknowledgement.
It never calls an LLM, creates allocations, rebalances a plan, or changes
financial authority.

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
