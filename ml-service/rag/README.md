# WealthGenie Trust-Gated Retrieval Architecture

The current containment release is a multi-tenant, observable, trust-gated **extractive retrieval** engine. It returns verified excerpts and citation IDs or explicitly abstains. LLM-grounded synthesis is deliberately deferred until factual-support governance is implemented.

---

## 🏛️ 1. Architecture Overview

```mermaid
graph TD
    Client[Client Application / FastAPI Endpoint] -->|1. Request: Q & Tenant ID| Router[Hardened RAG Router /rag/query]
    Router -->|2. Rate Limit & Authentication| RateLimiter[Sliding Window Rate Limiter]
    RateLimiter -->|3. Check Response Cache| Cache[MultiLevelCacheManager]
    
    Cache -- Cache Hit --> ReturnCache[Return Grounded RAG Response]
    Cache -- Cache Miss --> Pipeline[RAGPipeline Orchestrator]
    
    Pipeline -->|4. Query Understanding| QU[Query Understanding Pipeline]
    QU --> Normalizer[Text Normalizer & Spelling Corrector]
    QU --> Acronyms[Financial Acronym Expander]
    QU --> Rewriter[Sub-Query Expansion & Intent Classifier]
    
    Rewriter -->|5. Hybrid Candidate Retrieval| Retrievers[Hybrid Strategy Retriever]
    Retrievers -->|Dense Vector Search| Dense[DenseVectorRetriever]
    Retrievers -->|BM25 Keyword Search| BM25[BM25KeywordRetriever]
    
    Dense -->|Tenant-Scoped Vector Search| VectorStore[(PersistentVectorStore v2.0)]
    BM25 -->|Tenant-Scoped Keyword Search| VectorStore
    
    Dense & BM25 -->|6. Rank Fusion| Fusion[RRF / Weighted Score Fusion]
    Fusion -->|7. Relevance Reranking| Reranker[Relevance Reranker]
    
    Reranker -->|8. Trust & Relevance Gates| Sanitizer[Evidence Sanitizer]
    Sanitizer --> Injection[Injection & Leakage Guard]
    Sanitizer --> Delimiters[Delimiter Escaping]
    
    Sanitizer -->|9. Context Optimization| ContextMgr[Context Manager]
    ContextMgr --> Deduplication[Semantic Deduplication >85%]
    ContextMgr --> Merging[Adjacent Chunk Merging]
    ContextMgr --> Budgeting[Character Budgeting]
    
    ContextMgr -->|10. Extract & Cite| Builder[Extractive Formatter & Citation Engine]
    Builder --> Response[Verified Extracts or Abstention]
    
    Response -->|11. Cache & Telemetry| Telemetry[Observability Metrics & Response Cache]
```

---

## 📦 2. Subsystem Components

| Module | Location | Description |
|:---|:---|:---|
| **Evaluation Framework** | `rag/evaluation/` | Retrieval hit/recall, citation-ID validity, lexical support, and abstention correctness. Citation-ID validity is not factual entailment. |
| **Reranking Pipeline** | `rag/reranking/` | Abstract `BaseReranker` with `NoOpReranker` and `RelevanceScoreReranker` for boosting exact keyword matches. |
| **Hybrid Retrieval** | `rag/retrievers/` | Combines `DenseRetriever` and `BM25KeywordRetriever` with Reciprocal Rank Fusion (RRF) and Weighted Score Fusion. |
| **Query Understanding** | `rag/query_understanding/` | Text normalization, spelling correction, financial acronym expansion, intent classification, and query rewriting. |
| **Prompt Security** | `rag/security/` | Sanitizes inputs against prompt injections, system prompt role leaks, and delimiter escaping. |
| **Context Management** | `rag/context/` | Semantic chunk deduplication (>85% similarity), adjacent chunk merging, and token/character budgeting. |
| **Observability** | `rag/observability/` | Records per-stage execution latency, token counts, cache statistics, and exports JSON telemetry snapshots. |
| **Caching Engine** | `rag/cache/` | Multi-tier TTL caching (response cache, retrieval cache, embedding cache) with tenant isolation. |
| **Vector Store Hardening**| `rag/vector_store/` | Local development uses the persistent file store; shared deployments use Mongo-backed chunks and a corpus revision check. Mongo indexes are migration-owned and verified read-only by the service. |
| **Document Lifecycle** | `rag/lifecycle/` | Manages document versioning, soft deletion, hard deletion with vector chunk purging, and metadata updates. |
| **Multi-Tenant Readiness** | `rag/schema.py`, `vector_store/`, `retrievers/` | Enforces strict `tenant_id` scope isolation across storage, retrieval, caching, and pipelines. |
| **API Hardening** | `rag/router.py`, `main.py` | Sliding window rate limiting (60 req/min), HTTP security headers (`nosniff`, `DENY`), Pydantic validation, and standard error handling. |
| **Configuration** | `rag/config.py` | Centralized `RAGConfig` supporting `.env` variables (`RAG_*`), JSON configuration files, and model validations. |
| **Benchmarking** | `rag/benchmark.py` | Measures ingestion throughput (docs/sec, chunks/sec) and query execution latency percentiles (P50, P90, P99). |
| **Structured Logging** | `rag/logging.py` | Emits structured JSON logs to stdout and persistent `reports/rag_store/rag_execution.log`. |

---

## 🔌 3. REST API Specification

### `POST /rag/query`
Executes trust-gated extractive search over authoritative knowledge-base chunks.
- **Request Payload**:
  ```json
  {
    "question": "What is the Section 87A rebate limit?",
    "top_k": 4,
    "tenant_id": "default"
  }
  ```
- **Response Payload**:
  ```json
  {
    "answer": "Extracts from verified financial or regulatory sources...",
    "citations": [
      { "citation_id": 1, "document_title": "Income Tax Act", "relevance_score": 1.0 }
    ],
    "retrieved_chunks": [...],
    "metrics": { "response_mode": "extractive_retrieval", "chunks_retrieved": 2 },
    "grounded": true
  }
  ```

### `POST /rag/index`
Direct user text is rejected as authoritative advisory evidence. Verified corpus ingestion occurs through the internal ingestion pipeline; explicit administrative overrides are quarantined and cannot influence advisory retrieval.
- **Request Payload**:
  ```json
  {
    "title": "Income Tax Act Section 87A",
    "content": "Section 87A rebate of the Income Tax Act provides tax relief...",
    "source": "tax_code.pdf",
    "tenant_id": "default"
  }
  ```

### `GET /rag/documents`
Lists all registered documents in the knowledge base.

### `DELETE /rag/documents/{doc_id}`
Deletes or soft-deletes a document and purges all associated vector index chunks.

---

## ⚙️ 4. Environment Configuration

All hyperparameters can be overridden via environment variables prefixed with `RAG_`:

| Environment Variable | Default | Description |
|:---|:---|:---|
| `RAG_CHUNK_SIZE` | `512` | Text chunk size in characters |
| `RAG_CHUNK_OVERLAP` | `64` | Overlap size between consecutive chunks |
| `RAG_TOP_K` | `4` | Number of top chunks to retrieve |
| `RAG_SIMILARITY_THRESHOLD` | `0.1` | Minimum cosine similarity threshold |
| `RAG_RETRIEVAL_STRATEGY` | `hybrid` | Retrieval strategy (`dense`, `keyword`, `hybrid`) |
| `RAG_FUSION_MODE` | `rrf` | Rank fusion mode (`rrf` or `weighted`) |
| `RAG_RERANKER_STRATEGY` | `no_op` | Reranker strategy (`no_op`, `relevance_score`) |
| `RAG_VECTOR_STORE_PATH` | `reports/rag_store/vector_index.json` | Index storage file path |

---

## 🧪 5. Testing & Verification

### Shared-state database migration

When `ML_STATE_BACKEND=mongodb` is selected, run the explicit Phase-3 migration
once, after MongoDB is ready and before starting ML service replicas:

```bash
cd ml-service
MONGODB_URI="$MONGODB_URI" python scripts/migrate_phase3_state.py
```

The migration installs the model-registry, vector-chunk, and GridFS indexes and
records schema version `phase3_shared_state/1`. It refuses to create the
one-active-model-per-architecture index when duplicate active records exist.
Application startup only verifies the marker and index definitions; it does not
create indexes or backfill registry state. The CI browser lifecycle and Kind
deployment workflows run this one-shot migration before starting ML replicas.

This migration does not, by itself, make document lifecycle state shared or
make RAG ingestion transactional; those remain separate production-readiness
work and must not be inferred from a successful index migration.

Run the full platform test suite:
```bash
python -m pytest tests/ -p no:phoenix -v
```

Execute performance benchmarking:
```python
from rag.benchmark import RAGBenchmarkSuite
suite = RAGBenchmarkSuite()
print(suite.run_ingestion_benchmark(num_docs=10))
print(suite.run_query_benchmark(num_queries=20))
```
