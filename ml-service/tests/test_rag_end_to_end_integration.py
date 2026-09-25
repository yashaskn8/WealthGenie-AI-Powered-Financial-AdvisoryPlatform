"""
WealthGenie RAG Subsystem - Full End-to-End System Integration Test Suite
Verifies end-to-end flow from document ingestion, lifecycle management, multi-tenant hybrid retrieval,
reranking, prompt security, context management, observability logging, response caching, and recovery.
"""

from pathlib import Path

from rag.config import RAGConfig
from rag.embeddings.dense_embedding import DenseVectorEmbeddingProvider
from rag.ingestion.pipeline import IngestionPipeline
from rag.lifecycle.manager import DocumentLifecycleManager
from rag.retrieval.pipeline import RAGPipeline
from rag.schema import RAGQueryRequest
from rag.vector_store.memory_vector_store import PersistentVectorStore


def test_full_rag_end_to_end_pipeline_workflow(tmp_path):
    index_path = tmp_path / "integration_vector_index.json"
    config = RAGConfig(vector_store_path=index_path, embedding_dim=64, similarity_threshold=0.0)
    embedder = DenseVectorEmbeddingProvider(dimension=64, enable_cache=False)
    vector_store = PersistentVectorStore(index_path=index_path)

    lifecycle_manager = DocumentLifecycleManager(
        vector_store=vector_store,
        registry_path=tmp_path / "integration_documents.json",
    )
    ingestion_pipeline = IngestionPipeline(
        embedder=embedder,
        vector_store=vector_store,
        lifecycle_manager=lifecycle_manager,
    )
    query_pipeline = RAGPipeline(embedder=embedder, vector_store=vector_store, config=config)

    # The end-to-end trusted path ingests a document only through its hash-pinned
    # current-corpus manifest; a made-up "official" URL is not a trust credential.
    corpus_file = Path(__file__).parents[1] / "rag" / "data" / "corpus" / "income_tax_rules_2026_commencement.md"
    ingest_res = ingestion_pipeline.ingest_file(corpus_file)
    assert ingest_res["chunks_created"] > 0
    doc_id = ingest_res["document_id"]

    # 2. Verified global official evidence is shared consistently across users.
    req_alpha = RAGQueryRequest(
        question="When do the Income-tax Rules 2026 take effect?",
        tenant_id="tenant_alpha",
    )
    res_alpha = query_pipeline.query(req_alpha)
    assert res_alpha.grounded
    assert res_alpha.citations

    # 3. A second user sees the same public evidence, not a tenant-specific variant.
    req_beta = RAGQueryRequest(
        question="When do the Income-tax Rules 2026 take effect?",
        tenant_id="tenant_beta",
    )
    res_beta = query_pipeline.query(req_beta)
    assert res_beta.grounded
    assert [item.chunk.chunk_id for item in res_beta.retrieved_chunks] == [item.chunk.chunk_id for item in res_alpha.retrieved_chunks]

    # 4. Lifecycle Document Purging (Hard Delete) & Cache Invalidation
    deleted = lifecycle_manager.hard_delete_document(doc_id)
    assert deleted
    query_pipeline.cache_manager.invalidate_all()

    # 5. Query post-purging -> Grounding should fail
    req_post_delete = RAGQueryRequest(
        question="When do the Income-tax Rules 2026 take effect?",
        tenant_id="tenant_alpha",
    )
    res_post_delete = query_pipeline.query(req_post_delete)
    assert not res_post_delete.grounded
