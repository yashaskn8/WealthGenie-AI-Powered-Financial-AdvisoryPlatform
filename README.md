# WealthGenie — AI-Powered Financial Advisory & Portfolio Optimization Platform

> A full-stack financial advisory engine featuring a 5-stage portfolio optimization pipeline, hybrid RAG knowledge retrieval, deep learning suitability classification, multi-agent conversational AI, and real-time FY2025-26 Indian tax regime evaluation.

[![CI Test Matrix](https://github.com/yashaskn8/WealthGenie-AI-Powered-Financial-Advisory-Platform/actions/workflows/ci.yml/badge.svg)](https://github.com/yashaskn8/WealthGenie-AI-Powered-Financial-Advisory-Platform/actions/workflows/ci.yml)
[![Node.js](https://img.shields.io/badge/Node.js-v22.x-339933?logo=node.js)](https://nodejs.org/)
[![Python](https://img.shields.io/badge/Python-3.12-3776AB?logo=python)](https://www.python.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.100+-009688?logo=fastapi)](https://fastapi.tiangolo.com/)
[![React](https://img.shields.io/badge/React-v19.x-61DAFB?logo=react)](https://react.dev/)
[![MongoDB](https://img.shields.io/badge/MongoDB-v7.0-47A248?logo=mongodb)](https://www.mongodb.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

<!-- TODO (WG-035): Insert live deployment URL here when Vercel/Render ships -->

`Python 3.12` • `FastAPI` • `Node.js / Express` • `MongoDB` • `Redis` • `React 19` • `Vite` • `PyTorch` • `SentenceTransformers` • `Docker`

---

## Technical Overview & Recruiter Summary

**WealthGenie** is a financial engineering platform designed to automate portfolio construction, tax-optimized wealth planning, and AI advisory for retail investors in India.

### Core Engineering Capabilities Demonstrated

* **5-Stage Mathematical Portfolio Optimization**: Combines mean-variance quadratic optimization (`numeric` solver), rule-based heuristic fallback, policy concentration caps (`CONCENTRATION_CAPS`), and emergency fund floor protection.
* **Multi-Tenant RAG Knowledge Retrieval**: Intent-gated architecture combining `SentenceTransformers` (`all-MiniLM-L6-v2` 384D) vector search and BM25 sparse retrieval over vectorized SEBI/RBI/IT-Act chunks with multi-tenant namespace isolation and inline citation verification.
* **OpenTelemetry Distributed Tracing**: Full W3C `traceparent` and `X-Correlation-ID` context propagation across Express and FastAPI microservices exporting spans to local `traces.jsonl`.
* **Tamper-Evident Advisory Audit Chain**: Transactional SHA-256 hash chaining binds advisory inputs, outputs, model/rule versions, provenance, timestamps, and correlation data. MongoDB records are not described as immutable.
* **Multi-Model Tabular Deep Learning**: Comparative suitability modeling benchmarking **Random Forest** (95.63% test rule-approximation fidelity, TreeSHAP explainability), **PyTorch MLP** (95.60%), and **FT-Transformer** (*NeurIPS 2021*, 97.05% test rule-approximation fidelity).
* **Multi-Agent Conversational System**: Layered stateful conversation orchestration featuring security prompt injection defense, financial tool calling, `LayeredMemoryManager`, and structured JSON response protocols.
* **Dual Tax Engine (FY2025-26)**: In-memory Indian tax engine evaluating Old vs New tax regimes, Section 87A marginal rebate relief, surcharges, and Section 80C/80D deductions.
* **REST Architecture**: Express gateway benchmarked up to **5,537.7 req/s** on local load tests (`autocannon` v8.0.0) with fail-closed API security and Mongoose schema validation.

---

## Feature Matrix

| Capability | Implementation Mechanism | Verification / Benchmark Source |
| :--- | :--- | :--- |
| **Portfolio Recommendation** | 5-stage pipeline: Risk scoring → Asset allocation → Quadratic solver / Heuristic fallback → Policy caps → Rebalancing | [`server/services/RecommendationPipeline.js`](server/services/RecommendationPipeline.js), [`server/test/recommendationPipeline.test.js`](server/test/recommendationPipeline.test.js) |
| **RAG Knowledge Retrieval & Multi-Tenancy** | FastAPI hybrid vector search (`all-MiniLM-L6-v2` 384D) with tenant namespace isolation & intent routing | Document Hit Rate: **98.7%**, Precision@4: **0.7367**, MRR: **0.9022** ([`real_corpus_evaluation_report.json`](ml-service/reports/real_corpus_evaluation_report.json), [`test_rag_tenant_isolation.py`](ml-service/tests/test_rag_tenant_isolation.py)) |
| **Distributed Tracing** | OpenTelemetry SDK with W3C `traceparent` propagation across Express <-> FastAPI microservices exporting to `traces.jsonl` | [`server/config/tracing.js`](server/config/tracing.js), [`ml-service/tracing.py`](ml-service/tracing.py), [`scripts/verify_distributed_tracing.js`](scripts/verify_distributed_tracing.js) |
| **Tamper-Evident Advisory Audit Chain** | Transactional canonical SHA-256 record chain with fail-loudly guarantees and verification endpoint | [`server/models/AuditRecord.js`](server/models/AuditRecord.js), [`server/test/auditChain.test.js`](server/test/auditChain.test.js) |
| **Playwright Full-Lifecycle E2E Suite** | Real-service user lifecycle against replica-set MongoDB, Redis, FastAPI, Express, and Vite | [`reactapp/e2e/full-flow.spec.ts`](reactapp/e2e/full-flow.spec.ts), [`.github/workflows/ci.yml`](.github/workflows/ci.yml) |
| **Investor Classification** | Random Forest (`model.pkl`), PyTorch MLP, and FT-Transformer tabular neural network | FT-Transformer: **97.05%** rule-approx. (independent CFP: 15.83%), RF: **95.63%** rule-approx. (independent CFP: 25.26%) ([`multi_model_benchmark.json`](ml-service/reports/multi_model_benchmark.json)) |
| **Agentic Advisory Chat** | Multi-agent state machine (`geminiChatService.js`, `aiToolOrchestrator.js`) with tool-calling graph | Post-patch load test: **105.7–193.6 req/s** (chat API throughput) ([`load_test_report.md`](load_test_report.md)) |
| **Tax Regime Computation** | In-memory FY2025-26 Old vs New regime calculator with Section 87A rebate logic | Compute throughput: **3,736.7–5,537.7 req/s** (tax engine execution) ([`load_test_report.md`](load_test_report.md)) |
| **Financial Instrument Catalog** | 155 curated instruments across 14 asset classes | Canonical [`server/data/investment_master.json`](server/data/investment_master.json), generated frontend mirror, and parity test |
| **Security Controls** | Fail-closed API key verification, prompt injection defense pipeline, Joi validation | [`test_fail_closed_auth_when_api_key_unset`](ml-service/tests/test_ml_validation.py) |
| **Distributed Systems Failure-Mode Testing** | Real-failure chaos tests (MongoDB disconnect, Redis disconnect, ML ECONNREFUSED), mid-transaction partial-write proof, Redis fail-closed audit | [`chaos.test.js`](server/test/chaos.test.js), [`midTransaction.test.js`](server/test/midTransaction.test.js), [`redisFailClosed.test.js`](server/test/redisFailClosed.test.js) |
| **Testing & CI/CD** | Backend, ML, frontend, dependency-audit, API-contract, and real-service browser gates | GitHub Actions workflow ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) |

---

## System Architecture

The platform architecture splits workload across an Express.js Gateway (IntentGate) (Node.js), a FastAPI Machine Learning & RAG Microservice (Python 3.12), a MongoDB document datastore, a Redis cache and coordination layer, and a React 19 single-page application.

![System Architecture Diagram showing the React SPA, Express API Gateway, MongoDB, Redis, FastAPI ML microservice, and LLMs](docs/architecture/system_architecture.png)
> **System architecture.** End-to-end request pathways across the React client, Express REST API Gateway, MongoDB document datastore, Redis cache, and Python FastAPI ML microservice.

### Request Flow
1. **User Request**: React SPA submits user profile or query payload to Express gateway.
2. **Intent Classification**: [`intentGate.js`](server/services/intentGate.js) routes factual tax/regulatory queries to FastAPI RAG (`/rag/query`) and advisory queries to Gemini/Groq LLM orchestrators.
3. **Execution**:
   - **Recommendation Requests**: Express invokes `RecommendationPipeline.js` (5-stage optimization) + queries FastAPI ML microservice for suitability predictions.
   - **RAG Queries**: FastAPI embeds query with `all-MiniLM-L6-v2` (384D), searches vector database, and returns cited responses.
4. **Response Delivery**: Output passes through security filters and structured JSON validation before returning to client.

Express is the authoritative boundary for personalized recommendations, product suitability and ordering, allocation policy, eligibility, and tax decisions. React supplies validated inputs and renders returned decisions; it does not silently substitute local financial-policy calculations when a backend decision is unavailable.

The public Express contract is defined by [`server/openapi.yaml`](server/openapi.yaml) and checked against the registered routes. Express-to-FastAPI prediction and RAG payloads use shared fixtures plus strict Node and Pydantic validators. Public errors use the stable `{ error, message, code, request_id, details? }` envelope.

---

## AI & Machine Learning Architecture

### 1. Tabular Deep Learning Suitability Benchmark (Phase 3)
The platform trains and evaluates three model architectures on a dataset of **20,000 NAV-derived investor profiles** (16 canonical features, 60/20/20 train/val/test split):

| Model Architecture | Test Rule-Approx. Fidelity | Macro F1 | Balanced Accuracy | Training Time | Primary Use Case & Independent CFP Benchmark |
| :--- | :---: | :---: | :---: | :---: | :--- |
| **FT-Transformer** (*NeurIPS 2021*) | **97.05%** | **0.9331** | 0.9220 | 79.15s | High-precision deep learning benchmark checkpoint ([`ft_transformer_benchmark.pt`](ml-service/model/checkpoints/ft_transformer_benchmark.pt)); independent CFP benchmark: **15.83%** |
| **Random Forest** | **95.63%** | 0.9144 | **0.9221** | **4.16s** | **Production Serving**: Fast inference + TreeSHAP explainability (`model.pkl`); independent CFP benchmark: **25.26%** |
| **PyTorch MLP** | 95.60% | 0.9012 | 0.9080 | 12.40s | Neural baseline comparison checkpoint ([`mlp_benchmark.pt`](ml-service/model/checkpoints/mlp_benchmark.pt)) |

*Report source*: [`ml-service/reports/multi_model_benchmark.json`](ml-service/reports/multi_model_benchmark.json).

### 2. Retrieval-Augmented Generation (RAG) Subsystem (Phase 2 & 5)
The FastAPI microservice implements a dense vector search pipeline indexing vectorized chunks of SEBI regulations, RBI circulars, and the Indian Income Tax Act.

![RAG Retrieval Pipeline Diagram showing document ingestion, SentenceTransformer dense vector embedding, PersistentVectorStore search, and citation verification](docs/architecture/rag_pipeline.png)
> **RAG retrieval pipeline.** Ingestion of vectorized regulatory/tax chunks, SentenceTransformer 384D dense vector embedding, vector similarity search, and context grounding with citation validation.

* **Embedder**: `SentenceTransformerEmbeddingProvider` using `all-MiniLM-L6-v2` (384D dense vectors).
* **Vector Store**: `PersistentVectorStore` in `ml-service/rag/vector_store/memory_vector_store.py`.

#### Empirical RAG Evaluation Metrics (75 Evaluation Queries, incl. 5 Adversarial Controls):
* **Document-Level Hit Rate**: **98.7%** (74/75 queries retrieved >=1 chunk from expected document; measures document provenance, not passage precision).
* **Precision@4**: **0.7367** (73.7% of all retrieved top-4 chunks belong to expected source document).
* **Mean Reciprocal Rank (MRR)**: **0.9022** (first relevant document chunk returned at Rank 1 for most queries).
* **NDCG@4**: **0.7564** (ranking quality with realistic score variance).
* **Citation-ID validity**: returned citations are checked against retrieved seed chunk IDs; this is not presented as factual entailment.
* **Adversarial Control Discrimination**: Near-miss & out-of-scope questions show clear score separation (e.g., Precision@4 = 0.0 on Section 80D health insurance near-miss, 0.25 on SIP minimum near-miss).

#### Embedding Provider Ablation Study (Dense Transformer vs Hash-Based):
An ablation study ([`ml-service/reports/embedding_ablation.json`](ml-service/reports/embedding_ablation.json)) compared 128D character n-gram feature hashing against 384D transformer embeddings:

| Metric | Hash Provider (`DenseVectorEmbeddingProvider`) | Dense Transformer (`all-MiniLM-L6-v2`) | Empirical Uplift |
| :--- | :---: | :---: | :---: |
| **Vector Dimension** | 128D (n-gram hash) | 384D (transformer vector) | +256 dimensions |
| **In-Domain Recall@4** | 98.0% | **100.0%** | **+2.0%** |
| **Mean Reciprocal Rank (MRR)** | 0.8833 | **0.9733** | **+0.0900** |
| **Mean NDCG@4** | 0.8975 | **0.9800** | **+0.0825** |

### 3. Base LLM Evaluation Harness (Phase 4)
Base `Qwen/Qwen2.5-0.5B-Instruct` was evaluated across 25 financial prompts against gold reference answers ([`ml-service/reports/llm_eval_report.json`](ml-service/reports/llm_eval_report.json)):
* **Mean Lexical Overlap**: 0.4998
* **Dense Semantic Embedding Similarity**: **0.6660** (SentenceTransformer cosine similarity)
* **Mean Faithfulness**: 0.5608

---

## Agentic AI & Conversation Architecture

The chat system implements a stateful, tool-assisted agent pipeline driven by [`geminiChatService.js`](server/services/geminiChatService.js) and [`aiToolOrchestrator.js`](server/services/aiToolOrchestrator.js):

![Agentic AI Workflow Diagram showing prompt injection inspection, intent gate routing, layered memory manager, financial tool registry, and tool trace graph](docs/architecture/agent_workflow.png)
> **Agentic AI workflow.** Step-by-step advisory flow from security prompt inspection and intent classification to tool execution and structured response generation.

### Component Breakdown
* **`geminiChatService.js`**: Orchestrates the multi-pass tool-grounded execution loop with self-correcting replanning (`MAX_REPLANS = 2`), session token budgeting, and governance trace logging.
* **`aiToolOrchestrator.js`**: Resolves tool dependency DAGs, executes independent tool batches concurrently, and coordinates intermediate replanning evaluation.
* **`financialToolRegistry.js`**: Exposes canonical, deterministic financial tools with deep prototype pollution sanitization (`sanitizeToolInputs`), whitelisted asset keys, and strict Joi schema contracts.
* **`layeredMemoryManager.js`**: Implements 7 memory tiers (Working, Profile, Mid-Term with TTL, Preference, Decision, Tool, System) with tamper-evident SHA-256 cryptographic audit ledger verification.
* **`immutableSecurityPipeline.js`**: Sanitizes prompt inputs and detects injection attacks before LLM submission.
* **`intentGate.js`**: Classifies incoming queries to decide whether RAG grounding or LLM tool-orchestration is required.
* **`toolTraceGraph.js`**: Snapshots reproducible tool execution DAGs and governance checksums for enterprise auditability.

---

## Software Engineering & System Design

### 5-Stage Recommendation Pipeline
The core recommendation engine ([`RecommendationPipeline.js`](server/services/RecommendationPipeline.js)) generates asset allocations through five deterministic stages:

![5-Stage Portfolio Optimization Engine Diagram showing risk profiling, allocation matrix, quadratic mean-variance optimizer, policy concentration caps, and execution candidate ranking](docs/architecture/portfolio_pipeline.png)
> **5-Stage portfolio optimization engine.** Quantitative pipeline progressing from multi-factor risk profiling through quadratic solver optimization, policy concentration caps, and candidate product ranking.

1. **Stage 1 — Risk & Capacity Profiling**: Computes composite risk score (1–10) combining age, savings rate, dependents, emergency fund status, and debt EMI ratio (`riskProfiler.js`).
2. **Stage 2 — Target Allocation Matrix**: Maps composite risk score to asset class targets (Equity, Debt, Gold, Liquid).
3. **Stage 3 — Mathematical Optimization**: Executes mean-variance quadratic optimization via `numeric` package to maximize return for target volatility. If optimizer fails or encounters invalid boundaries, falls back to deterministic heuristic solver.
4. **Stage 4 — Policy Concentration Caps**: Enforces `CONCENTRATION_CAPS` (e.g. Smallcap ≤15%, Direct Equity ≤20%, SGB ≤10%, NPS ≤25%) with iterative excess redistribution.
5. **Stage 5 — Execution Pathway Selection**: Ranks catalog product candidates across 155 catalog instruments using profile-aware scoring.

### Security Controls
* **Fail-Closed API Key Authentication**: [`verify_api_key()`](ml-service/main.py#L231) in the ML microservice returns HTTP 500 (misconfiguration error) if `ML_SERVICE_API_KEY` is unset in non-local environments, preventing unauthorized access.
* **Multi-Layer Prompt Injection Defense**: Two-tier pipeline shared between Node.js ([`promptSecurity.js`](server/services/promptSecurity.js)) and Python ([`prompt_sanitizer.py`](ml-service/rag/security/prompt_sanitizer.py)):
  1. **Regex blacklist** — fast pattern-match against known injection phrases, loaded from [`config/security_patterns.json`](config/security_patterns.json).
  2. **Semantic heuristic guard** — detects paraphrased injection attempts and Base64-encoded payloads that evade literal pattern matching. Verified by 9 red-team tests.
* **Ingestion Trust Tiering**: [`pipeline.py`](ml-service/rag/ingestion/pipeline.py) accepts only verified government sources into advisory retrieval. Direct user input is rejected; explicit internal administrative overrides are tagged and quarantined from advisory evidence.
* **Per-User Token Budget**: [`tokenBudget.js`](server/middleware/tokenBudget.js) enforces a rolling-window cumulative token budget on `POST /api/chat/message`, independent of the request-count rate limiter. Prevents cost spikes from long prompts or automated abuse. Verified by 5 integration tests.
* **Input Validation**: Joi schemas validate incoming API request bodies on Express routes (`profile.js`, `recommend.js`, `tax.js`).
---

## Performance Benchmarks & Capacity Load Testing

Empirical load testing was conducted using `autocannon` (v8.0.0) across 30-second benchmark scenarios on a single host (Intel Core i7-10870H @ 2.20GHz, 16GB RAM, local MongoDB v7.0 & Redis 7.2):

| Scenario | Concurrency | p50 Latency | p95 Latency | p99 Latency | Throughput (req/s) | Error Rate | Status Codes |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :--- |
| **Tax Comparison (Compute-Heavy)** | 10 | 2.0 ms | 4.0 ms | 5.0 ms | **3,606.5 req/s** | **0.00%** | 108,174x HTTP 200 |
| **Tax Comparison (Compute-Heavy)** | 50 | 12.0 ms | 19.0 ms | 21.0 ms | **3,809.4 req/s** | **0.00%** | 114,264x HTTP 200 |
| **Tax Comparison (Compute-Heavy)** | 100 | 25.0 ms | 36.0 ms | 41.0 ms | **3,736.7 req/s** | **0.00%** | 112,088x HTTP 200 |
| **Stress Ceiling (Tax Compare)** | 200 | 35.0 ms | 43.0 ms | 54.0 ms | **5,537.7 req/s** | **0.00%** | 166,115x HTTP 200 |
| **Instruments DB (Read-Heavy)** | 10 | 48.0 ms | 66.0 ms | 73.0 ms | **199.0 req/s** | **0.00%** | 5,969x HTTP 200 |
| **Instruments DB (Read-Heavy)** | 100 | 79.0 ms | 244.0 ms | 267.0 ms | **973.7 req/s** | **0.00%** | 29,212x HTTP 200 |
| **Agentic Chat Endpoint (Post-Patch)** | 10 | 90.0 ms | 155.0 ms | 245.0 ms | **105.7 req/s** | **0.00%** | 3,170x HTTP 200 |
| **Agentic Chat Endpoint (Post-Patch)** | 100 | 506.0 ms | 844.0 ms | 874.0 ms | **193.6 req/s** | **0.00%** | 5,807x HTTP 200 |

*Full benchmark report*: [`load_test_report.md`](load_test_report.md) with committed raw outputs in `server/reports/loadtest/`.

---

## Tech Stack

| Layer | Technologies |
| :--- | :--- |
| **Frontend** | React 19, Vite, Framer Motion, Recharts, Lucide React, CSS3 (Vanilla Glassmorphism) |
| **Backend Gateway** | Node.js v22.x, Express.js, Mongoose ODM, Joi Validation, Numeric.js, Autocannon |
| **ML Microservice** | Python 3.12, FastAPI, PyTorch, scikit-learn, SentenceTransformers, NumPy, pandas, Uvicorn |
| **Database & Cache** | MongoDB v7.0 (Document Store & Vector Chunk Persistence), Redis 7.2 (Streams DAG Persistence, Cache & HybridStore) |
| **AI / LLM / RAG** | Google Gemini 1.5 Pro / Flash API, Groq API, `all-MiniLM-L6-v2` 384D Embeddings |
| **Containerization & CI** | Docker, Docker Compose, GitHub Actions (Multi-OS Node + Python matrix) |

---

## Installation & Setup

### Prerequisites
* **Node.js**: `v22.x` or higher
* **Python**: `v3.12`
* **MongoDB**: `v7.0` (local instance or MongoDB Atlas)
* **Redis**: `v7.x` (optional only for explicitly configured lightweight development; required and fail-closed for production shared state)

### 1. Clone Repository
```bash
git clone https://github.com/yashaskn8/WealthGenie-AI-Powered-Financial-Advisory-Platform.git
cd WealthGenie-AI-Powered-Financial-Advisory-Platform
```

### 2. Environment Configuration
Copy environment variable templates:
```bash
cp server/.env.example server/.env
cp ml-service/.env.example ml-service/.env
cp reactapp/.env.example reactapp/.env
```

Key environment variables to configure in `server/.env`:
```ini
PORT=5000
MONGODB_URI=mongodb://127.0.0.1:27017/wealthgenie
JWT_SECRET=your_secure_jwt_secret_key_min_32_chars
ML_SERVICE_URL=http://127.0.0.1:8000
GEMINI_API_KEY=your_gemini_api_key
```

In `ml-service/.env`:
```ini
PORT=8000
ENVIRONMENT=local
ML_SERVICE_API_KEY=your_ml_service_key
```

### 3. Start Backend Services Locally

#### Express Server (Node.js)
```bash
cd server
npm install
npm start
```

#### ML Microservice (Python)
```bash
cd ml-service
python -m venv venv
# On Windows: venv\Scripts\activate | On Linux/macOS: source venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --port 8000 --reload
```

#### Frontend Client (React)
```bash
cd reactapp
npm install
npm run dev
```

The application client runs at `http://localhost:5173`.

### Direct production processes (without Docker)

Run MongoDB and Redis as managed services or operating-system services, set
`NODE_ENV=production`, use strong secrets, and configure the public frontend origin in
`CORS_ORIGINS` using HTTPS. Set a unique `METRICS_TOKEN`; Redis is a required production
dependency by default because session revocation fails closed. Build the frontend once
and run the API as a supervised Node process:

```bash
cd reactapp
npm ci
npm run build

cd ../server
npm ci --omit=dev
npm start
```

The API separates Express construction from process startup, maintains explicit
starting/ready/draining/stopped lifecycle state, validates HTTP and MongoDB pool bounds,
and shuts down HTTP traffic, MongoDB, Redis, tracing, and scheduled jobs cleanly. Cookie
sessions are HttpOnly and bound to mutating requests with a double-submit CSRF token plus
an exact production-origin check. Readiness fails when critical dependencies are down,
admission control rejects excess concurrency before saturation, and HTTP metrics use
bounded method/status labels to avoid high-cardinality telemetry.

Production MongoDB must be replica-set capable because recommendation/audit and goal/profile
writes use transactions. The SPA restores session and financial state from the backend;
tokens, profiles, recommendations, and goals are not persisted in browser local or session
storage. The production Nginx configuration applies CSP, HSTS, frame denial, referrer and
permissions policies, MIME sniffing protection, and cross-origin isolation headers.

Expose `GET /api/metrics` only to an administrator or send the dedicated secret in the
`X-Metrics-Token` header from the monitoring agent. Do not reuse the JWT or ML service
secrets for metrics collection.

---

## Docker Deployment

To spin up the full multi-container application stack (MongoDB, Redis, Express backend, FastAPI ML service, React frontend):

```bash
cp .env.example .env
# Replace the CHANGE_ME values for JWT_SECRET, ML_SERVICE_API_KEY, and ML_OPERATOR_KEY.
docker-compose up --build -d
```

Docker Compose reads the root `.env` file for secret substitution. The frontend
serves `/api/*` through its Nginx reverse proxy to the Express container.

Service mapping:
* **Frontend**: `http://localhost:80`
* **Express Gateway**: `http://localhost:5000`
* **FastAPI ML Service**: `http://localhost:8000`
* **MongoDB**: `localhost:27017`
* **Redis**: `localhost:6379`

---

## Testing & Quality Assurance

### Node.js / Express Backend Test Suite
```bash
cd server
npm test               # Run the unit and integration test suite
npm run test:coverage  # Run test suite with coverage report
```

> **Offline-Resilient Test Database**: All server integration tests use a unified 4-tier database provisioning helper ([`server/test/helpers/mongoTestHelper.js`](server/test/helpers/mongoTestHelper.js)) that auto-selects the best available MongoDB mechanism:
> 1. **`MONGODB_URI` env variable** — Pre-started MongoDB (CI services, local `mongod`). Zero startup latency.
> 2. **Testcontainers** (`@testcontainers/mongodb`) — Spins up a `mongo:7.0` Docker container automatically.
> 3. **MongoMemoryServer** — In-memory binary fallback for environments with internet/cached binary.
> 4. **Fail-Fast Diagnostics** — Immediate actionable error message when no mechanism is available.

### Python ML Microservice Test Suite
```bash
cd ml-service
pytest                 # Run the full ML and RAG test suite
```

### Frontend Client Unit & Accessibility Suite (Vitest + axe-core)
```bash
cd reactapp
npm test               # Run the Vitest unit and accessibility suite
npm run lint           # Run ESLint
npm run typecheck      # Run TypeScript type safety checks
npm run build          # Build the production bundle
```

### Playwright End-to-End Suite (Full User Lifecycle)
```bash
cd reactapp
npm run test:e2e       # Run Playwright E2E full user journey against live local stack
```
> **CI integration:** The required browser job provisions a real replica-set-capable MongoDB, Redis, FastAPI, Express, and Vite before running Playwright. A local run needs the same dependencies; a standalone MongoDB cannot prove the transactional lifecycle.

### Static Docs-vs-Code Sync Check
To verify that documentation claims match code imports and API routes:
```bash
node scripts/docs/check_docs_sync.js
```

---

## Project Structure

```text
WealthGenie-AI-Powered-Financial-Advisory-Platform/
├── .github/
│   └── workflows/
│       └── ci.yml                 # Quality, security, contract, and real-service browser gates
├── docs/
│   └── architecture/              # Technical architecture & pipeline visual diagrams
│       ├── system_architecture.png
│       ├── agent_workflow.png
│       ├── rag_pipeline.png
│       └── portfolio_pipeline.png
├── docker-compose.yml             # Full-stack container orchestration
├── RESEARCH_LOG.md                # Empirical research & engineering audit log
├── PROJECT_STATUS.md              # Feature status & architectural disclosure matrix
├── load_test_report.md            # Autocannon load testing benchmark report
├── reactapp/                      # React 19 Single-Page Application & Design System
│   ├── e2e/                       # Playwright E2E full user lifecycle test suite (full-flow.spec.ts)
│   ├── src/
│   │   ├── components/            # UI Components (ProfilePage, TaxScreen, Rebalancer, etc.)
│   │   ├── styles/                # CSS Design Tokens System (tokens.css, components.css)
│   │   ├── services/              # API client bridge
│   │   ├── utils/                 # Presentation and formatting utilities
│   │   ├── __tests__/             # Vitest unit, privacy, authority, and accessibility tests
│   │   └── App.jsx                # Main entry & router
│   ├── playwright.config.js       # Playwright E2E configuration
│   └── package.json
├── server/                        # Express.js REST API Gateway
│   ├── config/                    # DB, Redis & OpenTelemetry tracing config (tracing.js)
│   ├── middleware/                # Auth, rate-limiter, correlation/traceparent, idempotency
│   ├── models/                    # Mongoose Schemas (User, Profile, Recommendation, AuditRecord)
│   ├── routes/                    # REST Endpoints (recommend, tax, profile, chat, etc.)
│   ├── services/                  # RecommendationPipeline, TaxEngine, GeminiChatService
│   └── test/                      # Node.js unit, integration, transaction, and contract tests
├── ml-service/                    # FastAPI Machine Learning Microservice
│   ├── main.py                    # FastAPI routes (/predict, /rag/query, /health)
│   ├── tracing.py                 # OpenTelemetry instrumentation & FileSpanExporter
│   ├── model/                     # Random Forest (model.pkl) & FT-Transformer checkpoints
│   ├── rag/                       # Multi-tenant vector store, SentenceTransformer 384D embedder
│   ├── reports/                   # Committed JSON evaluation reports
│   └── tests/                     # Pytest ML, registry, persistence, RAG, and contract tests
└── scripts/                       # Orchestration, tracing verification & CSS migration scripts
    ├── run_e2e_stack.ps1          # Automated 5-service Playwright stack orchestrator
    └── verify_distributed_tracing.js # Distributed tracing cross-service assertion script
```

---

## Limitations, Regulatory Disclosures & Jurisdictional Scope

1. **Jurisdiction & Tax Scope**: Scoped strictly to Indian individual personal income tax (Income Tax Act, 1961) and retail investment instruments (PPF, SCSS, SSY, NPS, SGB, Mutual Funds, ETFs, FD). Does not support corporate taxation, HUF, NRI/DTAA provisions, crypto (VDA), or derivative trading (F&O).
2. **"Compliance-Inspired Controls" vs. Regulatory Registration**: WealthGenie applies algorithmic principles inspired by SEBI (Investment Advisers) Regulations, 2013 (risk capacity reconciliation, multi-instrument concentration caps, tamper-evident SHA-256 audit chains) and AMFI risk-o-meter classifications. WealthGenie is an educational research and decision-support platform, **NOT a SEBI-registered Investment Adviser (RIA)**. All outputs are educational projections, not certified investment advice.
3. **Statutory Tax Versioning (`FY2025-26-v1.0`)**: Tax engine reflects FY 2025-26 (AY 2026-27) slabs under Finance Act 2024 / 2025 revisions, including Section 87A rebate (₹12L New Regime with statutory marginal relief vs ₹5L Old Regime statutory cliff), Section 112A LTCG 12.5% rate (>₹1.25L exemption), and Section 288A/288B rounding conventions. When new budgets are announced, update `server/services/taxEngine.js` and bump `REGULATORY_RULE_VERSION`.
4. **Local Load Test Disclosure**: Load test benchmarks were conducted on a single host (`localhost:5000` / `127.0.0.1:8000`). They measure single-node event loop throughput and microservice latency, not multi-region cloud network conditions.
5. **Fine-Tuning Scope**: LoRA/QLoRA LLM fine-tuning pipelines are defined in code interfaces but were deferred due to CPU compute constraints during evaluation. Base `Qwen/Qwen2.5-0.5B-Instruct` was used for LLM evaluation.
6. **Computer Vision**: The platform intentionally focuses on tabular ML, text RAG, and financial tax algorithms. Computer vision (VLM) is explicitly out of scope.
7. **WTI Authority Boundary**: The React client sends only the saved profile ID and parent instrument ID to protected `POST /api/instruments/rank-wti`. Express preserves the parent-category hard-suitability boundary. For explicitly mapped mutual-fund categories, the product universe comes from AMFI; ranking uses a versioned one-year historical NAV-return rule only when complete Growth-option evidence exists. Historical return is never presented as expected return. Missing evidence produces comparable or unavailable results, and the legacy WTI catalog supplies non-financial reference text only.
8. **Benchmark Sourcing & Independent Evaluation**: The 97.05% (FT-Transformer) and 95.63% (Random Forest) test metrics represent rule-approximation fidelity against synthetic baseline allocations. When evaluated against independent Certified Financial Planner (CFP) benchmark profiles, real-world agreement rates are **15.83%** for FT-Transformer and **25.26%** for Random Forest.
9. **In-Memory Vector Search**: MongoDB 7.0 Community Edition does not support Atlas Vector Search. Chunks and embeddings are persisted in MongoDB for cross-replica sharing, but vector similarity search executes in-memory via FAISS/NumPy after loading vectors from Mongo on startup.
10. **Per-Replica Memory Scaling**: Because vector search runs in-memory, each ML service replica loads the complete embedding matrix into local RAM. Memory consumption scales linearly with $N_{\text{replicas}} \times N_{\text{chunks}}$.
11. **DAG Crash Resume Scope**: Redis Streams step persistence allows resuming a deterministic multi-step agent DAG from the last completed step index. External non-deterministic side-effects without compensating transactions are not managed by a distributed saga orchestrator.
12. **Rate Limiter Degrade Behavior**: `authLimiter` strictly fails closed (`passOnStoreError: false`), but `apiLimiter` falls back to in-memory `Map` counters if Redis disconnects, multiplying effective rate limits across independent replicas during an outage.

---

## License

This project is licensed under the **MIT License** — see the [LICENSE](LICENSE) file for details.
