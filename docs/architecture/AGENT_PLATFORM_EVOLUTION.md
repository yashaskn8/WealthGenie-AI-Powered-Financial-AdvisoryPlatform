# WealthGenie agent platform evolution boundary

This document records the bounded platform surfaces added after the durable Plan
Review worker. They are additive and do not move financial authority into an
agent, model, optimizer, scaffold, or generated artifact.

## Authorities that remain immutable

The recommendation service, suitability gate, tax engine, projection engine,
provider adapters, and deterministic market-context policy remain the only
financial authorities. Plan Review and Evidence Verifier are read-only. Every
evaluation and scaffold promotion requires `financialAuthorityDelta === 0`.

## Runtime surfaces

- `AgentRun` remains the durable queue, lease, retry, checkpoint, cancellation,
  and terminal-state owner.
- `AgentRunEvent` is an additive, owned progress stream with persisted sequence
  IDs. `GET /api/agent/plan-review/:runId/events` supports `Last-Event-ID`.
- The existing polling endpoints remain the compatibility fallback.
- `EvidenceVerifierAgent` validates evidence references and prompt-injection
  boundaries before the policy guard.
- A2A-inspired internal cards describe only Plan Review and Evidence Verifier capabilities; this is not a claim of official A2A conformance.
- A2UI messages are strict, allowlisted descriptors; they cannot contain
  arbitrary components or mutation claims.

## Evaluation and evolution

Evaluation manifests hash caller-labelled train, validation, and holdout
partitions. The optimizer projection omits holdout rows. The holdout verifier
now accepts only a strict `wealthgenie-holdout-bundle/v1` envelope whose full
case set is bound by an Ed25519 signature to the evaluation version, dataset
version, case count, SHA-256, signer key identity, and canonical attestation
time. The deployment must provide the externally trusted public key through
`AGENT_HOLDOUT_TRUSTED_PUBLIC_KEY`; the private signing key is not part of this
repository or application runtime. The expected holdout hash is independently
derived from the run's declared holdout partition. Missing trust configuration
does not load holdout data or call the candidate runner; malformed, altered,
wrong-key, wrong-version, or mismatched data fails closed before candidate
execution. After successful verification the candidate receives only its
sanitized execution fixture, while grading fields stay evaluator-only. A
verified dataset alone does not qualify a candidate: measured holdout scores,
reliability, budget, and zero-financial-authority-delta gates still apply, and
human approval remains separate. CI uses ephemeral test keys only; no checked-in
key or production attestation is implied. Candidate score cards retain hard
gates for forbidden tools, sensitive-data leaks, budget violations, and any
financial authority delta.

Scaffold specifications are data-only, versioned, immutable contracts. The
offline evolution interface is disabled by default. A challenger cannot affect
production traffic and promotion/rollback requires an explicit human approval
identity. Sandbox execution and meta-improvement research are also disabled by
default.

## Identity and optional infrastructure

Development identity is allowed only outside production. OIDC and SPIFFE are
represented as adapters that require an authenticated subject. Mongo is the
default workflow backend; the Temporal adapter is an explicit interface and is
not claimed to be locally available.

Docker/Kubernetes/Temporal runtime validation is delegated to CI when those
infrastructure services are not available locally.
