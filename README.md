# WealthGenie

WealthGenie is an Indian retail-investor financial decision-support platform. It combines a React application with a Node.js financial API, MongoDB persistence, provider adapters, and a Python ML/retrieval service.

[![CI Test Matrix](https://github.com/yashaskn8/WealthGenie-AI-Powered-Financial-AdvisoryPlatform/actions/workflows/ci.yml/badge.svg)](https://github.com/yashaskn8/WealthGenie-AI-Powered-Financial-AdvisoryPlatform/actions/workflows/ci.yml)
[![Node.js](https://img.shields.io/badge/Node.js-v22.x-339933?logo=node.js)](https://nodejs.org/)
[![Python](https://img.shields.io/badge/Python-3.12-3776AB?logo=python)](https://www.python.org/)
[![React](https://img.shields.io/badge/React-v19.x-61DAFB?logo=react)](https://react.dev/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

## Capabilities

- Personalized recommendations with server-side eligibility, suitability, allocation, concentration, and current-state checks.
- Source-qualified product and market evidence from supported adapters, including AMFI, NSE, India Post/Department of Posts, and SBI. Upstox is optional.
- Fiscal-year-versioned tax calculations, projections, and simulations with explicit assumptions and unavailable states.
- Session and ownership controls, durable idempotency, transactional persistence, and a tamper-evident audit chain.
- Grounded explanations and bounded research/agent features that remain separate from financial decision-making.
- React dashboards for recommendations, goals, market context, tax comparisons, and financial evidence.

## Financial authority and architecture

Express is the authoritative boundary for profile facts, eligibility, suitability, instrument ranking, allocation, tax, concentration, projections, and current financial state. The React client presents server results and collects user input; it does not calculate or override financial decisions.

The deterministic market-context policy remains the recommendation champion; the HMM market model is shadow-only. ML confidence and LLM output cannot change eligibility, suitability, ranking, allocation, tax, or product inclusion. NVIDIA NIM is used only for grounded explanation; Gemini and Groq are optional explanation providers, with a deterministic evidence-bound fallback.

The main request flow is:

    React client
      -> authenticated Express API
      -> canonical profile and financial-state checks
      -> deterministic suitability and recommendation services
      -> qualified provider adapters and transactional persistence
      -> response with source, freshness, and policy provenance
      -> React presentation

![System architecture showing the React client, Express API, MongoDB, Redis, and FastAPI service](docs/architecture/system_architecture.png)

Provider data is normalized server-side. Observation time, fetch time, effective date, source, freshness, and unavailable status remain distinct. Stale or unverified inputs do not silently become current facts.

### ML, retrieval, and agents

- ML models are evaluated as diagnostics/shadow predictions, not as investor-outcome forecasts or financial authorities.
- The FastAPI RAG subsystem provides tenant-scoped, trust-gated extractive retrieval and abstention. Its active corpus is controlled by the machine-readable manifest at ml-service/rag/data/corpus/manifest.json; the current trusted manifest includes the official Income-tax Rules 2026 commencement source, not a complete tax-law corpus.
- Plan Review is a bounded, read-only review of the authenticated user’s saved plan. A separate authoritative backend flow handles recomputation.
- ResearchMesh/A2A returns supplemental public-source evidence. It cannot write financial state or repair missing authoritative evidence. The pinned A2A MUST workflow records a reviewed upstream fixture-applicability exception; a green workflow is not a claim of zero raw TCK failures or full upstream conformance.
- MCP exposes an explicit allowlist of calculators as NON_AUTHORITATIVE simulations. It cannot update profiles, recommendations, allocations, goals, or authorization records.
- Prompt/scaffold evolution and live provider evaluations are controlled, offline/manual or operator-gated workflows. No agent or model can self-promote into financial authority.

The deterministic Express API, provider adapters, tax engine, and market-context policy are the financial authorities. LLMs, ML, RAG, A2A, MCP, and agents are constrained supporting systems.

## Technology

| Area | Main technologies |
| --- | --- |
| Web client | React 19, Vite, React Router, Recharts |
| API | Node.js 22, Express, Mongoose, Joi |
| ML and retrieval | Python 3.12, FastAPI, scikit-learn, PyTorch, Sentence Transformers, FAISS |
| Persistence | Transaction-capable MongoDB; Redis for shared cache, sessions, and distributed coordination |
| Delivery | GitHub Actions, Docker/Compose, Kubernetes manifests, Terraform infrastructure scaffolding |

## Repository layout

    .github/workflows/       CI, deployment, conformance, and reliability workflows
    reactapp/                React application, unit tests, and Playwright tests
    server/                  Express API, financial services, migrations, and tests
    ml-service/              FastAPI, model bundles, RAG, and Python tests
    ml-service/rag/data/     Manifest-controlled retrieval corpus
    scripts/                 Repository and documentation verification utilities
    docs/                    CI-consumed reliability contract and image assets
    k8s/                     Kubernetes base and production overlays
    terraform/               Infrastructure scaffolding; not an automatic deploy

README.md is the primary project overview. Subsystem operation files remain only where an explicit test, workflow, generator, or runtime input consumes them.

## Local development

### Requirements

- Node.js 22.x
- Python 3.12
- MongoDB configured as a transaction-capable replica set for transactional financial flows; a typical local URI uses replicaSet=rs0.
- Redis is optional for explicitly configured lightweight local development. Production shared-state and security policies may require healthy Redis.
- Docker is not required for ordinary local development. CI provisions real MongoDB, Redis, browser, and Kubernetes dependencies for integration gates.

Do not use a standalone MongoDB instance for flows that require transactions. Do not enable automatic index creation as a substitute for the explicit migration process.

### Install and configure

Install backend and frontend dependencies, then create local environment files from the checked-in templates:

    npm ci --prefix server
    npm ci --prefix reactapp
    python -m venv ml-service/venv
    python -m pip install -r ml-service/requirements.txt

Use the root, server, ML-service, and React .env.example files as the variable-name reference. Provide secret values through a local secret-aware environment mechanism; never commit real .env files or put provider keys in VITE_* variables.

For a fresh or upgraded Mongo database, run the explicit migrations before starting services. The Phase-2 index migration requires MONGODB_MIGRATION_URI to point at the intended transaction-capable database:

    npm run migrate:phase2-indexes --prefix server

The deployment workflow orders the shared ML/RAG state migration, Plan Review indexes, agent-runtime state, and ResearchAgent task indexes before application replicas. Run those migrations/bootstrap commands only when deploying or enabling the corresponding subsystem; production application startup verifies state and does not perform schema DDL.

Start the services in separate terminals after configuring their required environment:

    npm start --prefix server
    cd ml-service
    python -m uvicorn main:app --port 8000
    npm run dev --prefix reactapp

The React development server is normally available at localhost:5173. The API and ML service default ports are documented in the corresponding environment templates.

### Environment variable names

The following names cover common local and operator workflows; the .env.example files document subsystem-specific settings. No credential values are included here.

| Purpose | Variable names |
| --- | --- |
| API and persistence | MONGODB_URI, MONGODB_MIGRATION_URI, REDIS_URL, JWT_SECRET, CORS_ORIGINS, REQUIRE_REDIS |
| API-to-ML service | ML_SERVICE_URL, ML_SERVICE_API_KEY, ML_OPERATOR_KEY |
| Observability | METRICS_TOKEN, TRACE_LOG_PATH |
| Optional explanation providers | NVIDIA_API_KEY, GEMINI_API_KEY, GROQ_API_KEY |
| Optional authenticated market-data provider | UPSTOX_ACCESS_TOKEN, UPSTOX_ANALYTICS_TOKEN |
| Web client | VITE_API_URL, VITE_DEV_API_TARGET |
| Optional agent/MCP deployment | AGENT_WORKER_MODE, AGENT_WORKER_ENABLED, MCP_ENABLED, MCP_REMOTE_ENABLED, MCP_JWT_AUDIENCE, MCP_REQUIRED_SCOPE, MCP_ALLOWED_HOSTS, MCP_ALLOWED_ORIGINS |

### Optional full-stack Compose environment

Docker Compose is available for local integration testing, but its HTTP topology is not the production TLS topology:

    docker compose up --build

Production requires HTTPS termination, secure cookies, explicit origins, a transaction-capable Mongo-compatible deployment, and the required shared Redis policy. CI/CD runs one-shot migrations before application deployment and blocks rollout if migration or readiness checks fail. Terraform is infrastructure scaffolding; this repository does not run terraform apply.

## Live demo preflight

The live preflight is an explicit operator action, not a mocked test:

    npm run demo:doctor --prefix server
    npm run demo:preflight --prefix server

It is inert unless DEMO_LIVE_PREFLIGHT is enabled. It may create a profile and recommendation, so use only a disposable demo account and isolated demo database. The live backend must prove the expected database, host, port, and operator-provisioned environment sentinel before authenticated mutations. Never use production customer data or credentials.

The demo uses external JSON files named through DEMO_PROFILE_COMPLETION_FILE and DEMO_TAX_CONTEXT_FILE, kept outside the repository, plus DEMO_EMAIL, DEMO_PASSWORD, DEMO_COMPLETION_IDEMPOTENCY_KEY, DEMO_NIFTY_ETF_PARENT_ID, DEMO_EXPECTED_BUILD_SHA, and DEMO_EXPECTED_BUILD_TREE_SHA. Set DEMO_EXPECTED_BUILD_PROVENANCE_SHA256 and DEMO_EXPECTED_FRONTEND_ARTIFACT_SET_SHA256 from the same deployment provenance manifest; preflight requires the backend and served frontend to match the expected commit, tree, manifest hash, and frontend artifact hash. CI exposes the canonical manifest at `/build-provenance/provenance.json` and its hash through `/health/live`. Environment identity is specified by DEMO_EXPECTED_MONGODB_DATABASE, DEMO_EXPECTED_MONGODB_HOST, DEMO_EXPECTED_MONGODB_PORT, and DEMO_EXPECTED_MONGODB_ENVIRONMENT_ID. DEMO_API_BASE_URL, DEMO_FRONTEND_URL, DEMO_TRUSTED_REMOTE_ORIGINS, DEMO_REQUIRE_REDIS, MONGODB_URI, and REDIS_URL apply according to the local/remote deployment.

The gate requires current source-qualified market evidence, matching financial-state provenance, exact product identity, and validated tax input. It does not substitute stale data or infer missing tax facts. Provider/session conditions can make the live check unavailable; a result applies only to that configured environment and observation window.

## Tests and verification

    npm test --prefix server
    npm run lint --prefix server
    npm run typecheck --prefix server
    npm test --prefix reactapp
    npm run lint --prefix reactapp
    npm run typecheck --prefix reactapp
    npm run build --prefix reactapp
    python -m pytest ml-service
    node scripts/docs/check_docs_sync.js

The Playwright lifecycle suite requires the real service dependencies used by CI. The CI workflow provisions MongoDB replica-set behavior, Redis, the ML service, Express, Vite, and Chromium; local Docker is not mandatory if equivalent services are available.

## Security and regulatory scope

- The product is educational financial decision support, not a SEBI-registered Investment Adviser and not certified investment advice.
- The supported tax logic is Indian individual personal income tax with explicit fiscal-year policy. It does not cover corporate taxation, HUF, NRI/DTAA, crypto, or derivatives.
- Financial profile and tax data are sensitive. Logs, metrics, URLs, and external model prompts must not contain unnecessary private facts or credentials.
- Authentication, ownership, validation, CSRF/origin checks, request limits, and persistence fences are enforced server-side. Frontend types and hidden inputs are not trusted.
- Current provider facts, historical observations, assumptions, projections, and simulation outputs remain separately labelled. Historical performance is not a forecast.

## Known limitations

- The live demo preflight is opt-in and environment-specific; ordinary CI does not establish live provider availability or prove an operator’s demo environment.
- The current trusted RAG manifest is intentionally narrow and does not establish broad coverage of tax rates, deductions, or product tax treatment. Retrieval must abstain when the manifest lacks applicable evidence.
- The pinned A2A MUST workflow has an explicitly reviewed upstream fixture-applicability exception. Its workflow result must not be presented as full raw-TCK conformance.
- Market-data sources can be unavailable, stale, or outside a trading session. Such evidence remains unavailable rather than being replaced by a fabricated current value.

## Supporting operational files

- [Production Kubernetes overlay instructions](k8s/overlays/production/README.md)
- [RAG subsystem, migration, and readiness notes](ml-service/rag/README.md)
- The trusted retrieval source content and identity are controlled by the manifest in ml-service/rag/data/corpus/.

## License

MIT. See [LICENSE](LICENSE).
