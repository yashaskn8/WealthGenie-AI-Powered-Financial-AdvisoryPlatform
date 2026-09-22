# Financial State Integrity

## Authority flow

```text
Financial Profile
  -> immutable Recommendation generation
  -> append-only Allocation Revision
  -> RecommendationState canonical current-state pointer
  -> freshness/provenance gate
  -> dashboard, advisory, goals, regime preview, stress/projection and agent evidence
```

`Recommendation.responseSnapshot` is a historical generation-time response. It is not the mutable current portfolio. New generations create revision `1`; manual rebalances create later revisions with `source=USER_REBALANCED`. Older revisions and generation artifacts are never overwritten.

`resolveCurrentRecommendationState()` is the only current-state resolver for personalized recommendation consumers. It verifies ownership, profile hash, regulatory policy, recommendation policy, allocation provenance, and model-assumption version before a consumer is allowed to use the state. Legacy records are exposed as `LEGACY_GENERATION_STATE`; conflicting generation/snapshot instruments fail closed and are not silently backfilled.

## Rebalance and audit

Manual rebalance accepts an optional expected allocation revision for optimistic concurrency. The server derives the authoritative revision, revalidates profile/policy/suitability/concentration, then atomically creates the next revision, advances `RecommendationState`, and appends a tamper-evident audit-chain entry containing old weights, new weights, revision identity, and portfolio fingerprint. A concurrent request against the same revision receives `ALLOCATION_REVISION_CONFLICT`.

## Downstream freshness

Goals persist the exact recommendation, allocation revision, profile hash, model/policy/regulatory versions, assumption version, and portfolio fingerprint used by their Monte Carlo calculation. A goal GET returns `calculation_freshness`; stale persisted numbers are not presented as current by the frontend. Advisory metadata is bound to the allocation revision and fingerprint it explains.

Profile updates do not synchronously recompute recommendations. The profile hash changes immediately, so the previous recommendation becomes stale until an explicit recommendation generation completes.

## Tax statute provenance

Tax policy metadata is period-specific. Historical FY2025-26 remains associated with the Income-tax Act, 1961. FY2026-27 is associated with the Income-tax Act, 2025, effective 1 April 2026, and carries official source references and rule identifiers. SGB maturity exemption is not inferred without original-issue and continuous-holding facts; secondary-market and premature-redemption paths fail closed when their tax classification is not established.

## Assumptions

Projection model inputs remain separate from provider facts. Each recommendation instrument carries the model assumption version and a deterministic policy-input hash derived from `instrumentConstants.js`. Changing a model input changes the hash and requires an explicit policy/version review.
