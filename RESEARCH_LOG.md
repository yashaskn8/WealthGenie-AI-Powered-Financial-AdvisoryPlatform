# WealthGenie Engineering & Research Log

This log documents the empirical research, system architecture, performance benchmarks, and production integrity fixes implemented across the WealthGenie platform. Every claim in this document maps directly to a committed code module or persisted JSON report in the repository.

---

## 1. What I Built and Verified

1. **Hybrid RAG Integration into Express Product Gateway (Phase 1)**
   - **Implementation**: Built [`server/services/intentGate.js`](server/services/intentGate.js) and [`server/services/ragClient.js`](server/services/ragClient.js) to classify user questions. Factual tax, mutual fund, and regulatory turns route to the FastAPI `/rag/query` pipeline; conversational turns route to Gemini/Groq LLM adapters.
   - **Verification**: Verified via `server/test/ragIntegration.test.js` (100% pass rate, returning inline citations mapped directly to seed knowledge chunk IDs).

2. **Empirical RAG Subsystem Evaluation (Phase 2)**
   - **Implementation**: Evaluated `SentenceTransformer` (`all-MiniLM-L6-v2`) 384D vector search across 35 hand-labeled test queries (25 in-domain tax & regulatory queries + 10 out-of-domain negative controls).
   - **Committed Report**: [`ml-service/reports/rag_eval_report.json`](ml-service/reports/rag_eval_report.json) (In-Domain Recall@4: **96.0%**, In-Domain MRR: **0.9600**, Citation Accuracy: **100.0%**, Mean Grounding Score: **0.7716**).

3. **Model Bundle Evaluation (current repository scope)**
   - The old 20,000-row NAV-derived benchmark, its `multi_model_benchmark.json`, and the named checkpoints are not present in this checkout; those old metrics are not reproducible evidence and are withdrawn from this log.
   - Current per-architecture bundle manifests, metadata, and evaluation reports are under `ml-service/model/bundles/{random_forest,pytorch_mlp,ft_transformer}/`. These artifacts describe synthetic suitability-policy label agreement, not investor outcomes or financial performance; consult each bundle's own lineage and report rather than sharing one architecture's metadata with another.

4. **Base LLM Evaluation Harness (Phase 4)**
   - **Implementation**: Evaluated base open-weight `Qwen/Qwen2.5-0.5B-Instruct` across 25 financial advisory prompts against hand-labeled gold reference answers.
   - **Historical report note**: the report's `0.5608` field is a lexical grounding-overlap heuristic, not faithfulness, entailment, factual support, or a hallucination test. Other scores are historical similarity/overlap measures and do not establish factual correctness.

---

## 2. What I Investigated and What I Found

### Embedding Provider Ablation Study (Phase 5)

I conducted an ablation study comparing the lightweight hash-based n-gram bucket provider ([`DenseVectorEmbeddingProvider`](ml-service/rag/embeddings/dense_embedding.py)) against the production transformer model ([`SentenceTransformerEmbeddingProvider`](ml-service/rag/embeddings/dense_embedding.py)) across the 35 evaluation queries.

- **Committed Report**: [`ml-service/reports/embedding_ablation.json`](ml-service/reports/embedding_ablation.json)

#### Empirical Comparison Summary:

| Metric | Hash Provider (`DenseVectorEmbeddingProvider`) | Semantic Provider (`all-MiniLM-L6-v2`) | Empirical Uplift |
| :--- | :---: | :---: | :---: |
| **Vector Dimension** | 128D (character n-gram hash) | 384D (transformer dense vector) | +256 dimensions |
| **In-Domain Recall@4** | 98.0% | **100.0%** | **+2.0%** |
| **In-Domain Hit Rate** | 100.0% | **100.0%** | 0.0% |
| **Mean Reciprocal Rank (MRR)** | 0.8833 | **0.9733** | **+0.0900** |
| **Mean NDCG@4** | 0.8975 | **0.9800** | **+0.0825** |
| **Execution Time (35 queries)** | 0.03s | 0.52s | +0.49s |

#### Key Investigation Findings:
1. **Semantic Uplift**: Switching to dense transformer embeddings improved Mean Reciprocal Rank by **+0.0900** (from 0.8833 to 0.9733) and NDCG@4 by **+0.0825** (from 0.8975 to 0.9800), ensuring relevant chunks rank higher in search results.
2. **Failure Mode Analysis**: Character n-gram hashing fails on query paraphrases that do not share exact lexical root words with the knowledge base chunk (e.g. Query 21: *"Can I claim ELSS investments under Section 80C under Old Tax Regime?"*), retrieving only 1 of 2 relevant chunks (Recall@4 = 0.50). The dense semantic embedder captures context, retrieving both chunks (Recall@4 = 1.00).

---

## 3. What I Fixed After Finding It Was Wrong

1. **Fail-Open Authentication Vulnerability**
   - **Problem**: `verify_api_key()` in `ml-service/main.py` previously checked `if not expected_key: return api_key or "dev-mode"`, silently disabling authentication whenever `ML_SERVICE_API_KEY` was unset in any environment.
   - **Fix**: Updated `verify_api_key()` to fail closed by default. An explicit `ENVIRONMENT=local` env flag is now mandatory to permit dev-mode bypass when `ML_SERVICE_API_KEY` is unset. Non-local environments return HTTP 500 (misconfiguration error). Verified by [`test_fail_closed_auth_when_api_key_unset`](ml-service/tests/test_ml_validation.py#L231).

2. **Mislabeled Metric & Import Path Fix (`compute_bertscore_approx`)**
   - **Problem**: `compute_bertscore_approx()` in `ml-service/llm/evaluation/metrics.py` computed a rescaled Jaccard word-overlap score (surface n-gram token overlap) while claiming to approximate BERTScore. Additionally, `compute_embedding_semantic_similarity()` contained an invalid import path (`from rag.embeddings.provider import ...` instead of `rag.embeddings.dense_embedding`), causing a silent fallback to the lexical score (0.4998).
   - **Fix**: Renamed the lexical function to [`compute_lexical_overlap_score()`](ml-service/llm/evaluation/metrics.py#L102), corrected the import path to `rag.embeddings.dense_embedding.SentenceTransformerEmbeddingProvider`, cached the embedder instance, and re-evaluated the benchmark. The true SentenceTransformer dense semantic embedding similarity score is **0.6660** (compared to the silent fallback score of 0.4998).

3. **Horizontal Scaling Claims & Disclosure Honesty**
   - **Problem**: Prior documentation could be interpreted as claiming multi-host container cluster infrastructure.
   - **Fix**: Clarified in `README.md` and `RESEARCH_LOG.md` that horizontal scaling tests represent local single-host multi-process load simulations using worker processes.

4. **Documentation & Code Sync CI Check**
   - **Problem**: Architecture claims in documentation could silently drift from backend code implementation.
   - **Fix**: Created [`scripts/check_docs_sync.js`](scripts/check_docs_sync.js) which statically inspects `server/services/geminiChatService.js`, `server/services/ragClient.js`, and `ml-service/main.py` to enforce that docs match code logic before CI passes.

5. **Recommendation Engine Architectural Gaps (WG-030)**
   - **Problem**: Three untracked gaps in the recommendation and ranking pipelines, none of which appeared in PROJECT_STATUS.md, RESEARCH_LOG.md, or the WG-XXX ticket history:
     - **(a) Dead CONCENTRATION_CAPS**: `CONCENTRATION_CAPS` (Smallcap ≤15%, Direct Equity ≤20%, SGB ≤10%, NPS ≤25%, etc.) were declared in `investmentDatabase.js` but never imported or enforced anywhere. `enforceAllocationTargets` only clamped at the tier level (Low/Medium/High), not per-instrument. Empirically confirmed: an aggressive profile produced 85.6% allocated to a single Mid Cap stock, vs a 20% policy cap.
     - **(b) Disconnected Live Market Data**: `getLiveInstrumentParams()` populated the `INSTRUMENT_PARAMS` Proxy cache but was never called from `POST /api/recommend` or consumed by `computeInstrumentScore()`. Return scoring always used static catalog `expectedReturn` values, regardless of live market conditions.
     - **(c) WTI Risk-Inference Mismatch**: `rankWhereToInvestBackend()` used a hardcoded default `productRisk = 5` for all candidates, never looking up the authoritative `investmentDatabase` catalog `riskLevel` (1–5 scale). This caused the backend "Where to Invest" ranking to diverge from the frontend's `wtiGenerator.js` keyword-based risk classification.
   - **Fix**: 
     - **(a)** Added `applyConcentrationCaps()` helper to `RecommendationPipeline.js`, wired into all three Stage 5 exit paths (optimizer-success, optimizer-catch→heuristic, and heuristic). Implements iterative excess redistribution with an all-capped proportional fallback.
     - **(b)** `POST /api/recommend` now awaits `getLiveInstrumentParams().catch(() => {})` before `runPipeline()`. `computeInstrumentScore()` reads `INSTRUMENT_PARAMS[backendType]?.nominalRate` when present (falling back to `inv.expectedReturn || inv.rate || 7.0`).
     - **(c)** `rankWhereToInvestBackend()` now looks up `item.id` in the `investmentDatabase` catalog, converts catalog `riskLevel` (1–5) to WTI scale (1–9) via `1 + (catalogRisk - 1) * 2`, and falls back to keyword matching aligned with `reactapp/src/utils/wtiGenerator.js`.
   - **Commits**: `4d58720`, `97d97e6`, `1833833`.
   - **Verification**: 41/41 unit tests in `recommendationPipeline.test.js` (including synthetic identical-name candidate pair proving catalog lookup executes by `item.id`), 5/5 tests in `proofCriticalAuditFixes.test.js` (including 2 HTTP wire integration tests exercising Express→Joi→pipeline→response for both endpoints).

---

## 4. What Is Explicitly Out of Scope Right Now

1. **LoRA / QLoRA Fine-Tuning**
   - **Status**: Out of scope for this evaluation pass.
   - **Reason**: Evaluation in Phase 4 was conducted on the base open-weight `Qwen/Qwen2.5-0.5B-Instruct` model to establish a clean, non-fine-tuned performance baseline. Fine-tuning pipelines were excluded due to CPU compute constraints.

2. **Computer Vision / VLM (Vision-Language Models)**
   - **Status**: Out of scope.
   - **Reason**: The WealthGenie platform is designed strictly for tabular investor suitability classification, text-based financial RAG, and regulatory advisory. Image processing and vision capabilities are not relevant to the problem domain.

---

## 5. Architecture Notes

### Server-Side WTI Ranking Endpoint (`POST /api/instruments/rank-wti`)

The current Express route is defined in `server/routes/instruments.js` and delegates to the current server-side WTI ranking service. Do not use the legacy `RecommendationPipeline.js` path or this historical note as proof of current financial/tax semantics; inspect the route, service, schemas, and tests together.

**Current status**: The API client contains a helper for this endpoint, but no production React call site was found in the inspected tree. The UI ranking path must be confirmed from actual call sites rather than inferred from helper presence.

**Decision**: This paragraph is a source note, not an approval to move ranking authority to React. The deterministic backend remains the financial authority; any UI integration must call the backend API and preserve the current product, suitability, evidence, and tax contracts.
