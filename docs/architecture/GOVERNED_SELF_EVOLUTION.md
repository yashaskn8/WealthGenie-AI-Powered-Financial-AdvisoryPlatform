# Governed Self-Evolution Engine

Status: offline/manual-only, disabled by default, not production deployed.

WealthGenie can run a bounded prompt/scaffold improvement experiment without changing financial authority. The experiment is intentionally additive to the existing Plan Review, ResearchMesh, Evaluation V2, Reliability Lab, holdout, shadow, and WebAuthn promotion systems.

## Allowed evolution surface

The initial surface is prompt/scaffold metadata only:

- immutable planner and synthesis PromptBundles;
- evidence ordering and bounded context-compression policies;
- safe Plan Review model-role routing;
- soft budgets that can only lower existing hard limits.

PromptBundle content is UTF-8 validated, length bounded, credential scanned, canonicalized, hashed, deep-frozen, and resolved by ID plus hash. The repository champion remains the default, so the default Plan Review prompt behavior is unchanged.

Financial engines, suitability, risk, tax, allocation, eligibility, ranking, providers, identity, authorization, A2A trust, MCP permissions, evaluators, Reliability Lab hard gates, holdout loading, promotion policy, sandbox policy, deployment, and source code are immutable evolution surfaces.

## GEPA

The ML service pins stable DSPy 3.3.1. `DspyGepaOptimizer` calls the official `dspy.GEPA` optimizer with a separate reflection-LM parameter, Pareto candidate selection, bounded metric calls, and `dspy.Prediction(score, feedback, objective_scores)`. GEPA is imported lazily; default CI uses deterministic fixture contracts and does not require a paid model or GEPA credentials.

The optimizer receives sanitized train/validation trajectories and structured failure feedback only. Holdout rows, answer keys, private profile fields, credentials, and financial engine code are rejected at the optimizer boundary.

## Candidate lifecycle

Candidates are immutable prompt/scaffold artifacts with parent lineage, generation, mutation surface, mutation reason, prompt/scaffold/evaluation hashes, and bounded lifecycle states. Each candidate requires a real closed-loop PlanReview runner; expected-output substitution is not accepted by the governed pipeline.

Train and validation are evaluated through Evaluation V2. Every candidate is also run through the Reliability Lab. Candidates must preserve a measured `financialAuthorityDelta` of exactly zero, have no hard-gate failure, and pass the sealed holdout verifier before entering `SHADOW_READY`.

The Pareto frontier tracks correctness, grounding, reliability, latency, token use, tool calls, and research-query objectives. Selection never promotes a candidate automatically. Shadow results are non-authoritative and cannot change a user response or create a financial effect.

## Sandbox

`FixtureEvolutionSandboxProvider` is the default deterministic contract provider. `E2BEvolutionSandboxProvider` is the one remote implementation and uses the maintained E2B JavaScript SDK (`e2b` 2.49.1). E2B is optional, manual-workflow-only, and disabled by default.

The sandbox manifest is hashed and binds candidate, PromptBundle, scaffold, dataset, evaluation, and reliability versions. Network access is deny-by-default, commands are server-generated and allowlisted, workspace files are allowlisted, and no production secrets, Mongo connection, cloud credentials, Git credentials, or private user data are passed to the sandbox. The provider always attempts cleanup.

## Promotion and rollback

Promotion remains the existing cryptographic WebAuthn human workflow. The candidate, PromptBundle, scaffold, evaluation, Reliability Lab result, holdout result, and authority-invariance measurement must match. The evolution agent, GEPA, sandbox, and challenger cannot promote themselves. Champion history remains immutable and rollback remains WebAuthn-gated.

## Flags and CI

All runtime self-evolution flags default to `false`:

- `AGENT_SELF_EVOLUTION_ENABLED`
- `AGENT_SELF_EVOLUTION_GEPA_ENABLED`
- `AGENT_SELF_EVOLUTION_E2B_ENABLED`
- `AGENT_SELF_EVOLUTION_LIVE_ENABLED`
- `AGENT_SELF_EVOLUTION_AUTO_PROMOTION_ENABLED`

Automatic production promotion is rejected. Fixture contract checks run in CI without Docker, E2B, paid LMs, or live user data. A separate `workflow_dispatch` job is the only live experiment entry point, has `contents: read`, does not push/commit/deploy, and uploads only an experiment report if one is generated.

This document does not claim full GEPA execution, live E2B execution, A2A conformance, or production deployment from local validation. Those require the manual CI workflow and the configured external services.
