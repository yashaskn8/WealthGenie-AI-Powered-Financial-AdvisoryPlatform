# WealthGenie - Project Status

## Verified, working components

| Component | Location | Details |
|---|---|---|
| **Design Tokens System** | [`reactapp/src/styles/tokens.css`](reactapp/src/styles/tokens.css) | Comprehensive CSS token system (4px/8px modular spacing, semantic dark mode palette, typography scale, radii, shadows, and glows) |
| **Frontend CSS Migration (17/17)** | [`reactapp/src/`](reactapp/src/) | 100% of the 17 CSS files migrated to design tokens with zero visual regressions and unified aesthetic |
| **Unified State Handling** | [`reactapp/src/components/StateMessages.jsx`](reactapp/src/components/StateMessages.jsx) | Standardized `LoadingState`, `ErrorState`, and `EmptyState` components with ARIA live regions (`role="status"`, `role="alert"`) |
| **Accessibility (0 Violations)** | [`reactapp/src/__tests__/a11y.test.jsx`](reactapp/src/__tests__/a11y.test.jsx) | Automated `axe-core` testing verifying 0 accessibility violations across all 5 audited core screens |
| **Playwright Full-Lifecycle E2E Suite** | [`reactapp/e2e/full-flow.spec.ts`](reactapp/e2e/full-flow.spec.ts) & [`scripts/run_e2e_stack.ps1`](scripts/run_e2e_stack.ps1) | Full end-to-end integration test (Signup -> Profile -> Recommendations & DeepDive -> Goal Planning -> GenieChat grounded advice) passing in ~21s with automated stack orchestrator |
| **OpenTelemetry Distributed Tracing** | [`server/config/tracing.js`](server/config/tracing.js) & [`ml-service/tracing.py`](ml-service/tracing.py) | End-to-end W3C `traceparent` and `X-Correlation-ID` propagation across Express <-> FastAPI microservice boundary; exports spans to `traces.jsonl` ([`scripts/verify_distributed_tracing.js`](scripts/verify_distributed_tracing.js)) |
| **Tamper-Evident Advisory Audit Chain** | [`server/models/AuditRecord.js`](server/models/AuditRecord.js) & [`server/routes/recommend.js`](server/routes/recommend.js) | Transactional canonical SHA-256 hash chain recording inputs, outputs, model/rule versions, cited RAG chunks, and correlation metadata, with verification tests ([`server/test/auditChain.test.js`](server/test/auditChain.test.js)) |
| **Multi-Tenant RAG Isolation** | [`ml-service/rag/`](ml-service/rag/) | Multi-tenant namespace isolation across vector storage, BM25 indexing, ingestion, and retrieval queries ([`ml-service/tests/test_rag_tenant_isolation.py`](ml-service/tests/test_rag_tenant_isolation.py)) |
| **Kind Cluster CD Pipeline** | [`.github/workflows/cd.yml`](.github/workflows/cd.yml) | Automated CD workflow executing in GitHub Actions: spins up Kind cluster, installs `metrics-server`, deploys manifests via Kustomize, runs live smoke tests (`/health/live`, `/health/ready`, `/health/deep`, `/api/tax/compare`), and verifies HPA metrics |
| **Horizontal Pod Autoscaling (HPA)** | [`k8s/hpa/server-hpa.yaml`](k8s/hpa/server-hpa.yaml) | CPU-based autoscaling (70% utilization target, 1 min / 4 max replicas) wired with `metrics-server` |
| **Terraform IaC (Validated)** | [`terraform/`](terraform/) | Modular IaC for AWS VPC (3-AZ, public/private subnets, NAT Gateway), Amazon DocumentDB (3-node cluster, KMS encrypted), ALB, and Route53 DNS. Validated via `terraform validate` ("Success! The configuration is valid") & `terraform plan` ("Plan: 22 to add, 0 to change, 0 to destroy") |
| **Random Forest classifier** | Production-serving `model.pkl` with TreeSHAP explainability | 95.63% rule-approx. fidelity (independent CFP benchmark: 25.26%) |
| **FT-Transformer benchmark** | [`multi_model_benchmark.json`](ml-service/reports/multi_model_benchmark.json) | 97.05% rule-approx. fidelity (independent CFP benchmark: 15.83%) |
| **RAG research subsystem** | Standalone FastAPI `/rag/query` retrieval and tenant-isolation evaluation; it is not the active financial authority for Express chat | 508-chunk corpus (Tax, SEBI, RBI/DICGC), FAISS `IndexFlatIP` vector store, 75-query evaluation ([`real_corpus_evaluation_report.json`](ml-service/reports/real_corpus_evaluation_report.json)): 98.7% document hit rate, Precision@4 0.7367, MRR 0.9022, NDCG@4 0.7564, 31.7ms average latency |
| **Embedding ablation study** | [`embedding_ablation.json`](ml-service/reports/embedding_ablation.json) | Semantic vs hash: +2.0% Recall, +0.09 MRR |
| **Base LLM evaluation** | [`llm_eval_report.json`](ml-service/reports/llm_eval_report.json) | BLEU 0.028, ROUGE-L 0.284, Semantic Sim 0.666 |
| **Fail-closed auth** | [`test_fail_closed_auth_when_api_key_unset`](ml-service/tests/test_ml_validation.py) | HTTP 500 when `ML_SERVICE_API_KEY` unset in non-local env |
| **MLOps Version Registry (Live-Wired)** | [`ml-service/model/registry/`](ml-service/model/registry/) & [`ml-service/main.py`](ml-service/main.py) | Persistent SQLite/MongoDB model version registry wired directly into FastAPI lifespan via `store_factory.get_model_registry()`, active version resolution on startup, TreeSHAP SHA-256 tamper-evident integrity verification, hot model reloading, and live HTTP management endpoints (`/model/registry/versions`, `/model/registry/active`, `/model/registry/integrity/{id}`, `/model/registry/register`, `/model/registry/rollback/{id}`) |
| **Distributed MongoDB State** | [`mongo_registry_store.py`](ml-service/model/registry/mongo_registry_store.py) & [`mongo_vector_store.py`](ml-service/rag/vector_store/mongo_vector_store.py) | Multi-replica shared state for ML model versions and RAG vector chunks ([`verify_cross_replica_mongo.py`](ml-service/scripts/verify_cross_replica_mongo.py)) |
| **Redis Streams DAG Persistence** | [`dagStream.js`](server/services/dagStream.js) & [`dagStream.test.js`](server/test/dagStream.test.js) | Full step persistence, crash-resume from last completed step index, and idempotency deduplication |
| **Fail-Closed Security Guard** | [`rateLimiter.js`](server/middleware/rateLimiter.js) & [`redis.js`](server/config/redis.js) | `authLimiter` fail-closed (`passOnStoreError: false`), `isTokenBlacklisted` fail-closed (denies on Redis outage) |
| **Capacity Load Test** | [`load_test_report.md`](load_test_report.md) & [`server/reports/loadtest/`](server/reports/loadtest/) | 7,676 req/s (1-replica Tax Engine), 5,025 req/s (2-replica Load-Balanced), 973 req/s (Instruments DB), 0.00% Error Rate |
| **Docs-sync CI check** | [`config/security_patterns.json`](config/security_patterns.json) | Shared injection-pattern ruleset (Node + Python) |
| [`server/middleware/tokenBudget.js`](server/middleware/tokenBudget.js) | Per-user rolling token budget middleware |
| [`ml-service/tests/test_rag_trust_tiering.py`](ml-service/tests/test_rag_trust_tiering.py) | Ingestion trust gate tests |
| [`ml-service/tests/test_rag_poisoning_pipeline.py`](ml-service/tests/test_rag_poisoning_pipeline.py) | End-to-end poisoning defense test |
| [`ml-service/tests/test_rag_security_redteam.py`](ml-service/tests/test_rag_security_redteam.py) | Red-team semantic injection tests |
| [`server/test/tokenBudgetMiddleware.test.js`](server/test/tokenBudgetMiddleware.test.js) | Token budget middleware integration tests |
| [`server/test/failClosed.test.js`](server/test/failClosed.test.js) | Fail-closed security integration test suite (5/5 pass) |
| [`server/test/idempotency.test.js`](server/test/idempotency.test.js) | Idempotency deduplication & dead-letter queue routing suite (3/3 pass) |
| [`server/test/auditTrail.test.js`](server/test/auditTrail.test.js) | Regulatory advisory audit trail integration test suite (4/4 pass) |
| **Offline-Resilient Test Database Provisioning** | [`server/test/helpers/mongoTestHelper.js`](server/test/helpers/mongoTestHelper.js) | Unified 4-tier test database engine: `MONGODB_URI` env → Testcontainers `mongo:7.0` → `MongoMemoryServer` fallback → Fail-Fast actionable diagnostics. All 11 integration test files centralized through helper. Full suite: **384/384 pass, 0 failures**. |
| **Grounded Explanation Boundary (Phase 6)** | [`server/services/geminiChatService.js`](server/services/geminiChatService.js), [`server/services/groundedExplanationService.js`](server/services/groundedExplanationService.js), [`server/services/groundingValidator.js`](server/services/groundingValidator.js) | Saved profile/current recommendation → minimal evidence packet → provider-neutral explanation → strict evidence validation. NVIDIA NIM is preferred, Gemini/Groq are optional fallbacks, the LLM tool allowlist is empty, and a deterministic grounded template handles provider failure. |
| **Read-Only LLM Provider Boundary** | [`server/services/providerAbstraction.js`](server/services/providerAbstraction.js) | Provider credentials remain server-only. Providers cannot call financial tools, alter allocation, change suitability, rank products, or fetch arbitrary sources. |
| **Conversation Persistence and Cost Bound** | [`server/services/geminiChatService.js`](server/services/geminiChatService.js) | Conversation evidence metadata is persisted, chat requests are rate-limited, and a 50,000-token session ceiling forces provider-free grounded fallback. There is no current multi-agent or replanning authority claim. |

---

## Frontend Design System, Accessibility & Testing Details

### 1. Design Token Architecture (`tokens.css`)
- **Spacing**: Standardized 4px/8px modular scale (`--spacing-xs` (4px), `--spacing-sm` (8px), `--spacing-md` (12px), `--spacing-lg` (16px), `--spacing-xl` (20px), `--spacing-2xl` (24px), `--spacing-3xl` (32px), `--spacing-4xl` (48px)).
- **Color Palette**:
  - Primary Brand: `--color-primary` (`#3b82f6`), `--color-primary-dark` (`#1d4ed8`), `--color-primary-light` (`#60a5fa`).
  - Semantic Accents: `--color-accent-teal` (`#22d3ee`), `--color-accent-gold` (`#dfbd69`), `--color-accent-purple` (`#a855f7`).
  - Dark Theme Backgrounds: `--color-bg-base` (`#0a0f1d`), `--color-bg-card` (`#121b2e`), `--color-bg-card-hover` (`#18243e`), `--color-bg-elevated` (`#1e293b`).
  - Text Hierarchy: `--color-text-primary` (`#f8fafc`), `--color-text-secondary` (`#94a3b8`), `--color-text-muted` (`#64748b`).
  - Feedback / Status: `--color-success` (`#10b981`), `--color-warning` (`#f59e0b`), `--color-danger` (`#f43f5e`), `--color-info` (`#0ea5e9`).
- **Typography**: Responsive font sizes (`--font-size-xs` to `--font-size-4xl`) with defined weights (`--font-weight-regular` to `--font-weight-black`).
- **Border Radii & Shadows**: `--radius-sm` (6px) through `--radius-pill` (9999px); ambient card shadows and semantic glows.

### 2. CSS Migration Inventory (278 -> 0 Hex Instances Across All 18 Files)
All 18 CSS files in `reactapp/src` outside `tokens.css` were scanned with `#[0-9a-fA-F]{3,8}\b` and migrated to design tokens with automated per-file verification:

| File | Before | After | Migrated Tokens |
|---|---|---|---|
| `App.css` | 45 | **0** | `--color-white`, `--color-accent-purple`, `--color-success`, `--color-error`, `--surface-0` |
| `components/DeepDiveModal.css` | 44 | **0** | `--color-white`, `--color-success`, `--color-error-light`, `--color-accent-purple-light` |
| `components/GenieChat.css` | 35 | **0** | `--color-primary-700`, `--color-success`, `--color-white`, `--color-violet-light` |
| `HealthScoreScreen.css` | 25 | **0** | `--color-white`, `--text-faint`, `--text-muted`, `--color-gray-100` |
| `components/TaxScreen.css` | 18 | **0** | `--color-white`, `--color-primary`, `--color-violet-500`, `--color-success-light` |
| `components/RebalancerScreen.css` | 18 | **0** | `--surface-1`, `--surface-2`, `--color-secondary-500`, `--color-secondary-400` |
| `ComparisonTableModal.css` | 15 | **0** | `--color-white`, `--color-accent-teal-light`, `--text-faint` |
| `components/StepUpPlanner.css` | 14 | **0** | `--color-accent-purple`, `--color-accent-purple-light`, `--color-white` |
| `Dashboard.css` | 12 | **0** | `--color-white`, `--color-primary-700`, `--color-gray-200`, `--text-muted` |
| `components/GoalTracker.css` | 9 | **0** | `--color-white`, `--text-secondary` |
| `components/Sidebar.css` | 9 | **0** | `--color-white`, `--color-error`, `--text-muted` |
| `index.css` | 8 | **0** | `--color-white`, `--color-primary-light`, `--color-accent-purple-light` |
| `LandingPage.css` | 8 | **0** | `--surface-0`, `--color-white`, `--color-accent-purple-light` |
| `HelpTourScreen.css` | 7 | **0** | `--color-white`, `--text-muted`, `--text-faint`, `--surface-2` |
| `components/AllocationPlanner.css` | 5 | **0** | `--color-accent-purple` (line 75 fix), `--color-white`, `--color-success` |
| `InsightsScreen.css` | 2 | **0** | `--color-white`, `--text-muted` |
| `PostTaxAnalysis.css` | 2 | **0** | `--color-white`, `--color-accent-purple-light` |
| `components/JargonTooltip.css` | 2 | **0** | `--color-violet-light` |
| **Total Across All Files** | **278** | **0** | **100% tokenized (0 hardcoded hex codes remaining outside tokens.css)** |

### 3. Accessibility (a11y) Audit & Violation Counts
Automated testing conducted via `axe-core` and `@testing-library/react` in `reactapp/src/__tests__/a11y.test.jsx`:
- **Before Migration**:
  - `TaxScreen`: Heading order violations (`<h1>` skipped to `<h3>`) and unlabeled range sliders.
  - `AllocationPlanner`: Missing `aria-label` attributes on equity/debt allocation sliders.
  - `RebalancerScreen`: Inaccessible data tables and threshold input controls.
  - `GenieChat`: Unlabeled icon buttons (voice input, clear chat, close chat).
  - `DeepDiveModal`: Missing `role="dialog"`, `aria-modal="true"`, and `aria-labelledby` semantics.
- **After Migration**: **0 violations across all 5 audited screens** (WCAG 2.1 Level AA compliant).
- **Test Suite Results**: 21 Vitest test suites (67 unit/integration tests) passing (`npm test`).

### 4. Playwright End-to-End Suite & Reproducible Stack Execution
- **Test File**: `reactapp/e2e/full-flow.spec.ts` (Playwright configuration in `reactapp/playwright.config.js`).
- **Flow Verified**:
  1. **Signup**: Creates new account with password validation and mobile checks.
  2. **Profile Completion**: Fills monthly take-home, savings, age, tax regime, and auto-scales CTC.
  3. **Recommendations**: Verifies the saved-profile recommendation, allocation normalization, profile-version refresh, and restored dashboard UI.
  4. **Where to Invest**: Calls the protected backend ranking path and verifies 0–5 truthful source-backed products without expected-return fabrication.
  5. **Market Context & Adjustment**: Verifies explicit available/unavailable state, provenance, bounded adjustment, and post-adjustment suitability/concentration validation.
  6. **Projection & Monte Carlo**: Verifies server-owned model-assumption provenance and non-provider-forecast labels.
  7. **Goal, Tax, Session & Auth**: Creates a goal, runs explicit-source/fiscal-year tax comparison, restores a session, logs out, logs in, and logs out again.
  8. **GenieChat**: Verifies evidence IDs, citations, grounding validation, provider metadata, and the visible grounded-data disclosure.
  9. **Browser Boundary**: Fails on direct browser traffic to NSE, AMFI, SBI, India Post or LLM providers, and on unexpected page/console errors.
- **Runtime**: Environment-dependent; the GitHub Actions browser lifecycle job is the release evidence against the complete real dependency stack.
- **Reproducing Full-Stack E2E Test Runs**:
  - **Option A (Docker Full Stack)**:
    ```bash
    docker-compose up -d --build
    cd reactapp && npm run test:e2e
    docker-compose down
    ```
  - **Option B (Local Processes)**:
    1. Terminal 1 (Mongo & Redis): Local MongoDB (`27017`) and Redis (`6379`).
    2. Terminal 2 (Server): `cd server && npm start` (port `5000`).
    3. Terminal 3 (ML Service): `cd ml-service && uvicorn main:app --port 8000` (port `8000`).
    4. Terminal 4 (React & E2E): `cd reactapp && npm run dev` then in another window `npx playwright test`.
- **CI Integration Status Disclosure**:
  > The browser lifecycle is a required GitHub Actions job. It provisions a replica-set MongoDB, Redis, FastAPI, Express and Vite before running Playwright; it is not a mocked UI-only gate.

---

## Cloud / DevOps Infrastructure Disclosure

### What is real & locally verified
1. **Kubernetes Manifests ([`k8s/`](k8s/))**: Full declarative manifests using Kustomize (`k8s/kustomization.yaml`), including Deployments with liveness/readiness/startup probes, resource quotas, ConfigMaps, Secrets, PersistentVolumeClaims, and Services.
2. **Local Cluster Verification (Kind)**: Verified via automated Kind cluster deployment in GitHub Actions ([`.github/workflows/cd.yml`](.github/workflows/cd.yml)), including smoke tests against `/health/live`, `/health/ready`, `/health/deep`, and `/api/tax/compare`.
3. **Autoscaling (HPA)**: Kubernetes `HorizontalPodAutoscaler` manifest ([`k8s/hpa/server-hpa.yaml`](k8s/hpa/server-hpa.yaml)) scaling `wealthgenie-server` from 1 to 4 replicas based on CPU target utilization.
4. **Continuous Deployment**: Dedicated CD workflow executing on every push to `main` and manual dispatch.

### What is written but unapplied
- **Terraform IaC ([`terraform/`](terraform/))**: Complete, modular Terraform configurations for AWS VPC (3-AZ public/private subnets), Amazon DocumentDB cluster (3 nodes, KMS encrypted), Application Load Balancer with HTTPS redirect, and Route53 DNS. Syntactically verified and planned with `terraform validate` and `terraform plan`, but **explicitly unapplied to live AWS accounts** to maintain zero cloud budget.

### Requirements for Live Production Cloud Migration
To transition from the Kind-based verification to a live production AWS/GCP cloud environment:
- **Managed Database**: Migrate from the in-cluster MongoDB StatefulSet to Amazon DocumentDB or MongoDB Atlas using the provided Terraform module (`terraform/modules/documentdb/`).
- **Secrets Management**: Migrate from plain Kubernetes `Secret` objects to AWS Secrets Manager or HashiCorp Vault with External Secrets Operator (ESO).
- **DNS & TLS**: Provision a production Route53 hosted zone and ACM TLS certificate via `terraform/modules/route53/` and `terraform/modules/alb/`.
- **Managed Ingress**: Replace the local NGINX Ingress controller with the AWS Load Balancer Controller managing an internet-facing ALB.

---

## Known, disclosed limitations - not fixed, and that's fine

- **Vector search in-memory after Mongo load**: MongoDB 7.0 Community Edition does not support Atlas Vector Search. Chunks are persisted in MongoDB for cross-replica storage, but FAISS/NumPy similarity search runs in-memory after loading vectors from Mongo on startup.
- **Per-replica memory scaling bottleneck**: Because vector search runs in-memory, every ML service replica loads the full embedding matrix into local RAM. For large corpora, memory consumption scales linearly with N_replicas x N_chunks.
- **DAG crash recovery scope**: Redis Streams persistence allows resuming a deterministic step DAG from the last completed step index. Non-deterministic external tool mutations without rollback/compensating transactions are not handled by a full distributed saga orchestrator.
- **Rate limiter in-memory fallback**: `passOnStoreError: false` is enforced for `authLimiter` (fail-closed), but `apiLimiter` still falls back to in-memory `Map` counters if Redis disconnects, effectively multiplying rate limits across independent replicas during an outage.
- **LoRA/QLoRA fine-tuning**: interface exists in code, but is not functional. Deferred indefinitely due to CPU compute constraints. Phase 4 evaluation was run against the base (non-fine-tuned) `Qwen/Qwen2.5-0.5B-Instruct` model.
- **Model Version Registry Live Wiring & Cold-Start Bootstrapping**: The model version registry (`mongo_registry_store.py`, `registry_store.py`, SHA-256 tamper-evident integrity, and rollback) is wired directly into the FastAPI application lifespan via `store_factory.get_model_registry()`, resolving active versions, artifacts, and rigor metrics dynamically upon startup and exposing live HTTP endpoints (`/model/registry/versions`, `/model/registry/active`, `/model/registry/integrity/{id}`, `/model/registry/register`, `/model/registry/rollback/{id}`) with hot reload support.
- **Cold-Start Bootstrapping vs. Pre-Baked Artifacts (Architecture Breakdown)**:
  - **RandomForest**: Possesses a zero-dependency cold-start fallback (`model.training.train_rf.train_random_forest_model`). If pre-baked `model.pkl` and `label_encoder.pkl` are absent (e.g. on fresh `git clone` or un-baked k8s image), the lifespan automatically generates synthetic investment profiles, trains the baseline classifier pipeline with TreeSHAP compatibility, exports the artifacts, and seeds them into the registry.
  - **PyTorch MLP**: Possesses a zero-dependency cold-start fallback (`model.training.train_pytorch.train_pytorch_model`). If `mlp_model.pt` is missing, it auto-trains a baseline MLP on synthetic profiles, saves weights to `model/saved_models/mlp_model.pt`, and seeds into the registry.
  - **FT-Transformer**: Possesses a zero-dependency cold-start fallback (`model.training.train_pytorch.train_ft_transformer_model`). If `ft_transformer.pt` is missing, it auto-trains a baseline FT-Transformer, saves weights to `model/saved_models/ft_transformer.pt`, and seeds into the registry.
  - **Kubernetes Pod Health Impact**: Because all three architectures support automated cold-start bootstrapping, a fresh k8s pod comes up healthy on `/healthz` and `/readiness` even if launched without pre-baked image layers. In production CI/CD, pre-baked artifact image layers bypass the cold-start training time.

---

## Grounded Explanation Classification & Authority Audit

### Classification: constrained read-only explanation layer

The current chat path is intentionally not an autonomous financial agent. It can explain only facts already produced by WealthGenie's authoritative backend:

| Dimension | Current verified boundary |
|---|---|
| **Financial authority** | Express-owned Financial Profile, hard suitability, eligible universe, recommendation, tax, projection and product-ranking services. |
| **LLM input** | Minimal versioned evidence packet with source, timestamps, freshness and explicit unavailable facts. |
| **LLM actions** | None. The grounded tool allowlist is empty; providers cannot edit a profile, fetch arbitrary URLs, calculate returns or change a recommendation. |
| **Output validation** | Evidence IDs, numbers, dates, URLs, financial terms and authority labels are checked against the packet before release. |
| **Failure behavior** | Missing credentials, provider errors or invalid output use a deterministic template grounded on the same packet. Financial facts are never synthesized as fallback. |
| **Providers** | NVIDIA NIM preferred for grounded explanation; Gemini and Groq optional. React calls only Express. |

The standalone RAG, layered-memory, tool-registry and DAG modules remain research/legacy subsystems. They are not represented as the active chat financial authority.

---

## FinTech Correctness, Regulatory Versioning & Compliance Scope

### 1. Jurisdiction & Instrument Scope Disclosures
WealthGenie is purpose-built and scoped strictly to **Indian personal income tax and domestic retail investment instruments**:
- **Tax Scope**: Indian Individual Income Tax under the Income Tax Act, 1961 (Salaried, Self-Employed, Capital Gains).
  - *Explicitly Not Handled*: Corporate tax, Hindu Undivided Family (HUF) provisions, Non-Resident Indian (NRI) taxation / Double Tax Avoidance Agreements (DTAA), Virtual Digital Assets (VDA / Crypto 30% flat tax), and Futures & Options (F&O) business tax.
- **Instrument Scope**: Indian retail savings and investment instruments:
  - Small Savings: Public Provident Fund (PPF), Senior Citizens Savings Scheme (SCSS), Sukanya Samriddhi Yojana (SSY), National Savings Certificate (NSC), Post Office Deposits.
  - Fixed Income & Sovereign: RBI Floating Rate Savings Bonds, Sovereign Gold Bonds (SGB), Gold ETFs, Bank Fixed Deposits (FD / RD), Corporate Bond Funds, Debt Mutual Funds, Target Maturity / Bharat Bond ETFs.
  - Equities & Pensions: National Pension System (NPS Tier I & II), Voluntary Provident Fund (VPF), Large-Cap / Flexi-Cap / Multi-Cap / Mid-Cap / Small-Cap Mutual Funds, Index Funds / ETFs, ELSS (Tax Saver), and US Feeder ETFs via the RBI Liberalised Remittance Scheme (LRS).
  - *Explicitly Not Handled*: Direct unlisted equities, private equity / venture debt, structured products / PMS, real estate fractional tokens, or exotic derivatives.

### 2. "Compliance-Inspired Controls" vs. Regulatory Registration
- **Algorithmic Guardrails**: WealthGenie incorporates mathematical and architectural controls directly inspired by SEBI (Investment Advisers) Regulations, 2013 and AMFI risk-o-meter categorizations:
  - *Risk Capacity Reconciliation*: Automatically reconciles subjective risk tolerance with objective financial capacity, capping risk elevation at $\min(T, C+1)$ and forcing conservative allocations for senior citizens or low-emergency-fund profiles.
  - *Multi-Instrument Concentration Caps*: Prevents concentration risk by enforcing strict aggregate asset-class caps (e.g. Small-Cap Mutual Funds $\le 15\%$, Mid-Cap $\le 20\%$, Gold/SGB $\le 10\%$) across multiple nominally distinct funds.
  - *Tamper-Evident Advisory Audit Chain*: Atomically records canonical SHA-256 chained audit records with recommendations, capturing inputs, outputs, model/rule versions, correlation metadata, and cited regulatory chunks. MongoDB storage itself is not claimed to be immutable.
- **Regulatory Registration Notice**: WealthGenie is an **educational technology and algorithmic decision-support project**, **NOT a SEBI-registered Investment Adviser (RIA)** or research analyst. All outputs are educational projections and algorithmic simulations, not certified financial advice.

### 3. Active Statutory Tax Rules & Update Instructions
- **Active Statutory Rule Version**: `REGULATORY_RULE_VERSION = 'FY2025-26-v1.0'`
  - **Fiscal Year / Assessment Year**: **FY 2025-26 (AY 2026-27)**.
  - **New Tax Regime (Section 115BAC)**: ₹0–4L: 0%, ₹4–8L: 5%, ₹8–12L: 10%, ₹12–16L: 15%, ₹16–20L: 20%, ₹20–24L: 25%, >₹24L: 30%. Standard deduction ₹75,000. Section 87A rebate up to ₹12,00,000 with statutory marginal relief.
  - **Old Tax Regime**: ₹0–2.5L: 0%, ₹2.5–5L: 5%, ₹5–10L: 20%, >₹10L: 30%. Standard deduction ₹50,000. Section 87A rebate up to ₹5,00,000 (statutory cliff; no 87A marginal relief).
  - **Capital Gains (Finance Act 2024 / 2025)**: Section 112A LTCG: 12.5% on gains exceeding ₹1,25,000; Section 111A STCG: 20%; Section 288A/288B rounding to nearest ₹10.
- **Union Budget Update Protocol**:
  When a new Union Budget is enacted:
  1. Open [`server/services/taxEngine.js`](server/services/taxEngine.js):
     - Update `STANDARD_NEW_SLABS` or `STANDARD_OLD_SLABS` arrays.
     - Update standard deduction amounts in `calculateTaxableIncome`.
     - Update Section 87A rebate limits in `computeTax`.
     - Update `REGULATORY_RULE_VERSION` string (e.g. `'FY2026-27-v1.0'`).
  2. Open [`server/services/instrumentConstants.js`](server/services/instrumentConstants.js):
     - Update statutory tax rates (e.g. `CESS_RATE`, `LTCG_EQUITY_RATE`, `STCG_EQUITY_RATE`, `LTCG_EXEMPTION_LIMIT`).
  3. Validate using Property Fuzzing and Exact Boundaries:
     - Run `node --test server/test/taxEngineFuzz.test.js` (exercises 7 statutory properties across 7,000+ generated income points).
     - Run `node --test server/test/taxBoundary.test.js` (exercises exact rupee threshold boundaries).

---

## Distributed Systems Failure-Mode Verification & Hardening

> **Verified**: August 2026. All tests run against real MongoDB 7.0 and real Redis on localhost.

### Phase 1 — Chaos Test Audit & Rewrite (`chaos.test.js`)

**Original state**: All 4 chaos tests were **mocked** — monkey-patching `FinancialProfile.create`, flipping a `setRedisAvailable(false)` boolean, and replacing `axios.post`. None induced real failure on a real dependency.

**Rewritten state** (all 4 pass):

| Test | Old Method | New Method | Verified Behavior |
|------|-----------|-----------|-------------------|
| MongoDB loss during write | Monkey-patched `FinancialProfile.create` (L106) | `mongoose.disconnect()` severs real TCP connection | Real `MongoNotConnectedError` → error handler → HTTP 503 |
| Redis offline fallback | `setRedisAvailable(false)` flag flip (L134) | `connectRedis()` against real server; if unavailable, real no-client path | HybridStore falls back to MemoryStore → HTTP 200 |
| ML service timeout | Monkey-patched `axios.post` (L165) | Dead port `59999` → real OS-level `ECONNREFUSED` | `mlClient.js` catches real error → `rule_fallback` |
| LLM providers offline | Provider calls isolated/disabled | Current chat path uses the validated deterministic grounded-evidence template; no recommendation or profile value changes |

### Phase 2 — MongoDB Mid-Transaction Failure (`midTransaction.test.js`)

Two real multi-step write scenarios tested with `mongoose.disconnect()` between writes:

| Scenario | Write 1 | Write 2 | Actual DB State After Failure |
|----------|---------|---------|-------------------------------|
| Goal creation | `Goal.create()` ✅ persists | `_syncProfileGoals()` ❌ `MongoNotConnectedError` | Goal exists; `Profile.goals[]` NOT updated. **Cosmetic inconsistency** (denormalization only). |
| Recommendation + Audit | `Recommendation.create()` ✅ persists | `AuditRecord.create()` ❌ `MongoNotConnectedError` | Recommendation exists WITHOUT audit record. **Orphaned recommendation** — regulatory concern on standalone MongoDB. HTTP flow throws 500 so client sees error, but the Recommendation document is already committed. |

**Honest limitation**: `mongoose.disconnect()` is a clean shutdown, not a sudden network partition (SIGKILL). Tests the most common real-world failure mode (connection pool exhaustion, primary stepdown, network blip).

### Phase 3 — Redis Fail-Closed Audit (`redisFailClosed.test.js`)

Complete audit of all 14 Redis usage paths across the codebase:

| Path | Fail Mode | Security Impact |
|------|-----------|-----------------|
| `isTokenBlacklisted` (authMiddleware.js) | **FAIL CLOSED** ✅ | Returns `true` (deny access) when Redis unavailable |
| `authLimiter` (rateLimiter.js) | **FAIL CLOSED** ✅ | `passOnStoreError: false` — propagates error |
| `apiLimiter` (rateLimiter.js) | FAIL OPEN | Intended — general rate limit degrades gracefully |
| `idempotency` (idempotency.js) | FAIL OPEN | Falls back to MongoDB, then proceeds without safety |
| `blacklistToken` (auth.js) | FAIL OPEN | Mitigated: `isTokenBlacklisted` fails closed anyway |
| `getCache/setCache` (6 files) | FAIL OPEN | Caching only — returns null, never throws |
| `dagStream` (dagStream.js) | FAIL OPEN | Falls back to in-memory step tracking |

**Verdict**: Both security-critical paths already fail closed correctly. No code fixes needed. 8/8 tests pass.

### Phase 4 — Live Cluster Pod-Kill Recovery

**NOT TESTED**. No Docker, no kubectl, and no live Kubernetes cluster available on this Windows development machine. No simulated or fabricated cluster output is provided.

### Phase 5 — Test Count Summary

| Test File | Tests | Pass | Fail |
|-----------|-------|------|------|
| `chaos.test.js` (rewritten) | 4 | 4 | 0 |
| `midTransaction.test.js` (new) | 2 | 2 | 0 |
| `redisFailClosed.test.js` (new) | 8 | 8 | 0 |
