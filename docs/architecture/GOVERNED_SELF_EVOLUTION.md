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

## GEPA and the Node/Python bridge

The ML service pins stable DSPy 3.3.1. `DspyGepaOptimizer` calls the official `dspy.GEPA` optimizer with a separate reflection-LM parameter, Pareto candidate selection, bounded metric calls, and structured metric feedback. `server/agents/evolution/gepaBridge.js` is the explicit Node/Python JSON boundary: Node creates a sanitized train/validation input, Python returns bounded proposals, and Node revalidates hashes, mutation surfaces, PromptBundle content, and prompt security before a candidate can run. The bridge never sends holdout rows or PlanReview fixtures to GEPA.

The fixture provider is deterministic and is the default for local contract tests. The DSPy provider requires explicit task/reflection model configuration and a model credential; it never silently falls back to the fixture provider. REAL GEPA ADAPTER IMPLEMENTED; LIVE MODEL RUN NOT YET EXECUTED in this local validation.

The optimizer receives sanitized train/validation trajectories and structured failure feedback only. Holdout rows, answer keys, private profile fields, credentials, and financial engine code are rejected at the optimizer boundary.

## Candidate lifecycle

Candidates are immutable prompt/scaffold artifacts with parent lineage, generation, mutation surface, mutation reason, prompt/scaffold/evaluation hashes, and bounded lifecycle states. Each candidate requires a real closed-loop PlanReview runner; expected-output substitution is not accepted by the governed pipeline.

Train and validation are evaluated through Evaluation V2. Every candidate is also run through the Reliability Lab. System scenarios use the existing synthetic lab, while candidate-behavior scenarios use the actual candidate-bound PlanReview runner and carry candidate ID, scaffold hash, PromptBundle hash, and candidate trajectory hash. Missing candidate execution or missing candidate coverage fails closed. Candidates must preserve a measured `financialAuthorityDelta` of exactly zero and have no hard-gate failure. Holdout cases are accepted only through the strict signed `wealthgenie-holdout-bundle/v1` envelope verified with an externally provisioned Ed25519 public key in `AGENT_HOLDOUT_TRUSTED_PUBLIC_KEY`. Its signature binds the full canonical holdout data hash, case count, Evaluation V2 version, dataset version, key identity, and attestation time; the run also compares the signed hash with its independently derived holdout partition hash. Missing key configuration leaves the result `UNVERIFIED` without loading holdout data or invoking the candidate runner. Invalid signatures or data mismatch fail before candidate execution. Even a verified bundle does not alone establish readiness: candidate-specific scores and all existing reliability, budget, and financial-authority gates must pass. No signing key or production-signed bundle is checked in, so without external trust provisioning governed runs remain `HOLDOUT_ATTESTATION_REQUIRED` and cannot reach `SHADOW_READY`.

The loader returns `{ schemaVersion, cases, attestation }`. `attestation` has exactly `schemaVersion`, `evaluationVersion`, `datasetVersion`, `caseCount`, `datasetHash`, `attestedAt`, `keyId`, `algorithm: "Ed25519"`, and base64 `signature`. The offline signer uses the verifier's exported `buildHoldoutAttestationSigningPayload({ cases, datasetVersion, attestedAt, keyId })`; it signs the returned `signingBytes` with its private Ed25519 key. `keyId` is the SHA-256 of the public key's DER SubjectPublicKeyInfo. Only the public key belongs in runtime configuration. The trust key and signed holdout bundle must be delivered through the deployment's approved configuration/data custody path, not generated from labels inside the application process.

The Pareto frontier tracks correctness, grounding, reliability, latency, token use, tool calls, and research-query objectives. Selection never promotes a candidate automatically. Shadow results are non-authoritative and cannot change a user response or create a financial effect.

## Sandbox

`FixtureEvolutionSandboxProvider` is the default deterministic contract provider. `E2BEvolutionSandboxProvider` is the one remote implementation and uses the E2B JavaScript SDK (`e2b` 2.51.0, as pinned in `server/package.json`). E2B is optional, manual-workflow-only, and disabled by default. The manual workflow runs `node server/scripts/run_evolution_experiment.js --gepa-provider dspy --sandbox-mode auto --output-dir evolution-report`; `auto` uses E2B only when the E2B credential and flag are present, otherwise the report explicitly records `LIVE E2B NOT EXECUTED`. The workflow never grants Git write, deployment, production database, or production secret access.

The sandbox manifest is hashed and binds candidate, PromptBundle, scaffold, dataset, evaluation, and reliability versions. Network access is deny-by-default, commands are server-generated and allowlisted, workspace files are allowlisted, and no production secrets, Mongo connection, cloud credentials, Git credentials, or private user data are passed to the sandbox. The provider always attempts cleanup.

## Promotion and rollback

Promotion remains the existing cryptographic WebAuthn human workflow. A candidate still cannot reach `SHADOW_READY` until a deployment provisions the trusted public key and supplies a valid externally signed holdout bundle; a locally labelled partition is not sufficient. The candidate, PromptBundle, scaffold, evaluation, Reliability Lab result, signed holdout data identity and measured holdout result, and authority-invariance measurement remain bound in the evaluation lineage. The evolution agent, GEPA, sandbox, and challenger cannot promote themselves. Champion history remains immutable and rollback remains WebAuthn-gated.

## Flags and CI

All runtime self-evolution flags default to `false`:

- `AGENT_SELF_EVOLUTION_ENABLED`
- `AGENT_SELF_EVOLUTION_GEPA_ENABLED`
- `AGENT_SELF_EVOLUTION_E2B_ENABLED`
- `AGENT_SELF_EVOLUTION_LIVE_ENABLED`
- `AGENT_SELF_EVOLUTION_AUTO_PROMOTION_ENABLED`

Automatic production promotion is rejected. Fixture contract checks run in CI without Docker, E2B, paid LMs, or live user data. The contract workflow runs on pull requests and relevant pushes to `main`; it executes Node and Python evolution tests. A separate `workflow_dispatch` job is the only live experiment entry point, has `contents: read`, does not push/commit/deploy, and uploads only an experiment report if one is generated. It requires model credentials for DSPy GEPA and fails closed when they are absent.

This document does not claim full GEPA execution, live E2B execution, A2A conformance, or production deployment from local validation. Those require the manual CI workflow and the configured external services.
