# WealthGenie ResearchMesh

ResearchMesh is an additive, read-only boundary for public financial and regulatory evidence. It does not replace Plan Review, the recommendation pipeline, suitability, tax, projection, provider, or authorized-action systems.

## Implemented boundary

- The real `@a2a-js/sdk@1.2.0` HTTP+JSON A2A v1 server/client boundary handles messages, tasks, artifacts, and cancellation.
- Plan Review sends a strict, sanitized `ResearchBrief`; private profile facts, user/run identifiers, and credentials are not forwarded. Research claims remain supplemental and cannot repair unavailable authoritative plan evidence.
- Search is bounded by hard budgets and deadlines. Public document retrieval validates HTTPS URLs, resolves and rejects unsafe/mixed DNS answers, pins the vetted address for the connection, rejects redirects, and bounds content size and type.
- Agent Card RPC destinations are origin/path pinned. Credentials are withheld from the card request and sent only to the configured RPC interface. Production requires a pinned signed-card key and configured caller credential/identity verification; development identity fallback is not available in production.
- Artifact hashes, task/brief binding, evidence/source links, excerpt hashes, trust tier, requested fact types, claim numbers, and freshness consistency are verified by the caller. In production, publisher labels must be URL-host-derived and remote publication dates are rejected unless independently established; currently no independent publication-date parser exists, so freshness stays `UNKNOWN` rather than being inferred from remote metadata.
- Mongo task storage is owner-scoped, bounded, revision-CAS guarded, terminal-state fenced, and protected by an explicit Phase 7 index migration plus read-only readiness verification. CI and Kind deployment order that migration before application startup.
- Shutdown stops accepting requests, aborts/drains active research work, and closes a Mongo connection opened by the standalone server.

## Financial authority and privacy

The deterministic Node backend remains the sole authority for financial profile facts, eligibility, suitability, ranking, allocation, tax, concentration, projections, and persisted financial state. ResearchMesh has no write or authorized-action capability. Its output is untrusted supplemental evidence; it cannot change financial authority (`financialAuthorityDelta` remains zero).

## Rollout and conformance

All ResearchMesh flags default off:

```text
AGENT_A2A_V1_ENABLED=false
AGENT_DEEP_RESEARCH_ENABLED=false
AGENT_ADAPTIVE_RESEARCH_ENABLED=false
AGENT_RESEARCH_LIVE_SEARCH_ENABLED=false
```

The A2A TCK workflow is pinned to upstream commit `263b9cfaf16a554bdfb166a7ba5b67716e946349` and checks out that exact revision. This is a reproducible test configuration, not evidence that TCK MUST checks have passed. No full TCK execution or production deployment is claimed.

## Explicit residual gaps

The durable task store does not yet implement distributed execution claims/renewable leases, takeover/recovery of abandoned in-progress tasks, or a durable idempotency key that deduplicates semantically identical submissions with different SDK task IDs. ResearchMesh caller/global capacity is not coordinated across replicas. Mongo-backed cross-replica integration and restart-recovery tests, and an executed official TCK result, remain required before describing the service as production-ready. Independent publication-date corroboration is also not implemented, so production must preserve unknown freshness rather than assert currentness.

These gaps are release blockers for a production rollout. The current changes do not enable self-evolution, financial mutation, or ResearchMesh by default. Docker/Kubernetes are not required for local validation.
