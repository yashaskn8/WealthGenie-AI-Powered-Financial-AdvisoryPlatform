# WealthGenie ResearchMesh

ResearchMesh is an additive, read-only boundary for public financial and regulatory evidence. It does not replace Plan Review, the recommendation pipeline, suitability, tax, projection, provider, or authorized-action systems.

## Status

- REAL: `@a2a-js/sdk@1.2.0` HTTP+JSON A2A v1 server/client integration, strict `ResearchBrief`, bounded research loop, source policy, SSRF checks, claim/evidence binding, immutable artifact hashing, and deterministic stress scenario wrapper.
- OPTIONAL: Agent Card JWS signing, OIDC/SPIFFE caller identity, and one configured live search provider.
- DISABLED: all ResearchMesh feature flags default to `false`.
- CI-CONFIGURED: the official A2A TCK MUST job is configured in `.github/workflows/a2a-tck.yml`; its result is not claimed until GitHub Actions passes it.
- NOT PRODUCTION DEPLOYED: no production deployment or infrastructure change is included.

## Boundary and privacy

Plan Review remains the caller and retains private authoritative context. It sends only a sanitized `ResearchBrief` containing a public question, jurisdiction, requested fact types, freshness requirements, and correlation metadata. The ResearchAgent cannot read raw profiles, income, identifiers, goals, recommendations, or credentials and has no write or authorized-action capabilities.

## A2A transport and identity

The standalone `server/agents/research/researchAgentServer.js` advertises only `HTTP+JSON` protocol version `1.0` at `/.well-known/agent-card.json` and handles messages, tasks, artifacts, and cancellation through the official SDK. The REST boundary authenticates the caller as `PLAN_REVIEW`; an `agentType` string or arbitrary bearer value is never accepted as identity proof. Development requires an explicit shared test token and is rejected in production. Production is intended for the existing OIDC/SPIFFE verifier. Card signing is separate from financial-action signing keys.

## Research loop

ResearchNeedEvaluator selects `NO_RESEARCH`, `QUICK_RESEARCH`, or `DEEP_RESEARCH` from deterministic evidence signals. Search queries are server-validated. Retrieval is bounded by hard maxima, uses fixture search in tests or one configured provider, and fetches public documents through `SafePublicDocumentFetcher`. Web content is untrusted data; prompt-injection text is rejected, not followed.

Evidence is reduced to bounded excerpts. Research claims are atomic and must bind to evidence and source hashes. The independent verifier rejects missing, stale, irrelevant, contradictory, or unsafe claims. Conflicts remain explicit as `CONFLICTING_EVIDENCE`; unsupported claims never enter Plan Review evidence.

## Scenario analysis

`scenarioAnalysis.js` reuses the existing deterministic `stressScenarioEngine`. The output is marked `notForecast: true` and `financialAuthorityDelta: 0`. It cannot change allocations, eligibility, risk tier, goals, recommendation state, or persistence. Monte Carlo remains an existing authoritative simulation service and is not silently replaced or fed LLM-generated numeric assumptions.

## Failure and rollout

Research is additive. Provider outage, failed verification, cancellation, invalid signatures, or budget exhaustion fail closed and leave the existing Plan Review path available. Research flags are opt-in:

```text
AGENT_A2A_V1_ENABLED=false
AGENT_DEEP_RESEARCH_ENABLED=false
AGENT_ADAPTIVE_RESEARCH_ENABLED=false
AGENT_RESEARCH_LIVE_SEARCH_ENABLED=false
```

No statement of full A2A conformance is made until the official TCK MUST checks pass. No Docker, Kubernetes, or production deployment is required for the local implementation tests.
