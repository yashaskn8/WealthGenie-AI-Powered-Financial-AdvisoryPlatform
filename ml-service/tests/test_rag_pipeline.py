"""
WealthGenie RAG Subsystem - Comprehensive Test Suite
Tests document loading, text cleaning, chunking, embeddings, vector search, retrieval pipeline, citations, and FastAPI RAG endpoints.
"""

import pytest
import numpy as np
from pathlib import Path
from fastapi.testclient import TestClient

from rag.schema import RAGQueryRequest
from rag.ingestion.loaders import DocumentLoader
from rag.ingestion.cleaner import clean_text
from rag.chunking.fixed_chunker import FixedSizeChunker
from rag.chunking.recursive_chunker import RecursiveCharacterChunker
from rag.embeddings.dense_embedding import DenseVectorEmbeddingProvider
from rag.embeddings.cache import EmbeddingCache
from rag.vector_store.memory_vector_store import PersistentVectorStore
from rag.ingestion.pipeline import IngestionPipeline
from rag.retrieval.pipeline import RAGPipeline
import os
from main import app

@pytest.fixture
def client():
    api_key = os.environ.get("ML_SERVICE_API_KEY", "wealthgenie_secret_api_key_2026")
    with TestClient(app, headers={"X-API-Key": api_key, "X-Verified-User-Id": "test-user-id"}) as c:
        yield c


def test_document_loader():
    loader = DocumentLoader()
    doc = loader.load_text("Tax income slab is 5% for 4L to 8L.", title="Tax Rules", author="Finance Ministry")
    assert doc.document_id is not None
    assert doc.metadata.title == "Tax Rules"
    assert doc.metadata.author == "Finance Ministry"


def test_text_cleaner():
    raw = "  Tax  Rules\n\n\n\nSection 80C   deduction.\r\n "
    cleaned = clean_text(raw)
    assert "Tax Rules" in cleaned
    assert "\n\n\n" not in cleaned
    assert cleaned.startswith("Tax Rules")


def test_chunking_strategies():
    loader = DocumentLoader()
    doc = loader.load_text("Word " * 200, title="Long Document")

    fixed_chunker = FixedSizeChunker(chunk_size=100, chunk_overlap=20)
    fixed_chunks = fixed_chunker.chunk_document(doc)
    assert len(fixed_chunks) > 1
    assert fixed_chunks[0].metadata.document_id == doc.document_id

    recursive_chunker = RecursiveCharacterChunker(chunk_size=100, chunk_overlap=20)
    rec_chunks = recursive_chunker.chunk_document(doc)
    assert len(rec_chunks) > 1


def test_embedding_provider_and_cache(tmp_path):
    cache_file = tmp_path / "test_cache.json"
    cache = EmbeddingCache(cache_path=cache_file)

    embedder = DenseVectorEmbeddingProvider(dimension=64, enable_cache=True)
    embedder.cache = cache

    vec1 = embedder.embed_text("Income Tax FY 2025-26 New Regime")
    assert len(vec1) == 64
    assert np.isclose(np.linalg.norm(vec1), 1.0, atol=1e-3)

    # Test cache hit
    vec2 = embedder.embed_text("Income Tax FY 2025-26 New Regime")
    assert vec1 == vec2
    assert cache.hits == 1


def test_vector_store_search(tmp_path):
    index_file = tmp_path / "test_vector_index.json"
    store = PersistentVectorStore(index_path=index_file)

    loader = DocumentLoader()
    doc = loader.load_text("Section 80C covers ELSS mutual funds and PPF up to 1.5 Lakhs.", title="80C Rules")
    chunker = FixedSizeChunker(chunk_size=200, chunk_overlap=0)
    chunks = chunker.chunk_document(doc)

    embedder = DenseVectorEmbeddingProvider(dimension=64, enable_cache=False)
    for c in chunks:
        c.embedding = embedder.embed_text(c.content)
        c.embedding_identity = embedder.embedding_identity

    store.add_chunks(chunks)
    assert store.get_stats()["total_chunks"] > 0

    query_vec = embedder.embed_text("ELSS mutual fund 80C deduction")
    results = store.search(query_vec, top_k=2)
    assert len(results) > 0
    assert results[0].chunk.metadata.title == "80C Rules"


def test_ingestion_and_rag_pipeline(tmp_path):
    index_file = tmp_path / "rag_pipeline_index.json"
    embedder = DenseVectorEmbeddingProvider(dimension=64, enable_cache=False)
    pipeline = IngestionPipeline(embedder=embedder, vector_store=PersistentVectorStore(index_path=index_file))
    corpus_file = Path(__file__).parents[1] / "rag" / "data" / "corpus" / "income_tax_rules_2026_commencement.md"
    res = pipeline.ingest_file(corpus_file)
    assert res["status"] == "success"
    stored_embedding_identity = pipeline.vector_store.get_stats()["embedding_identity"]
    assert stored_embedding_identity["embedding_provider"] == embedder.embedding_identity["provider"]
    assert stored_embedding_identity["embedding_model_revision"] == embedder.embedding_identity["model_revision"]

    query_pipe = RAGPipeline(embedder=embedder, vector_store=pipeline.vector_store)
    req = RAGQueryRequest(question="When do the Income-tax Rules 2026 take effect?")
    response = query_pipe.query(req)

    assert response.grounded
    assert len(response.retrieved_chunks) > 0
    assert len(response.citations) > 0
    assert response.citations[0].document_title == "Income Tax Rules 2026 Commencement"

    unsupported = query_pipe.query(RAGQueryRequest(question="What exact tax rebate amount applies today?"))
    assert not unsupported.grounded


def test_rag_readiness_rejects_same_dimension_wrong_embedding_revision(monkeypatch):
    from rag import router as rag_router_module

    embedder = DenseVectorEmbeddingProvider(dimension=64, enable_cache=False)
    stale_vector_identity = {
        "embedding_provider": embedder.embedding_identity["provider"],
        "embedding_model_id": embedder.embedding_identity["model_id"],
        "embedding_model_revision": "different-revision-same-dimension",
        "embedding_dimension": embedder.embedding_dimension,
        "embedding_config_hash": embedder.embedding_identity["config_hash"],
    }

    class VectorStoreWithStaleSpace:
        def get_stats(self):
            return {"embedding_identity": stale_vector_identity}

        def get_chunks(self):
            return []

    monkeypatch.setattr(rag_router_module.ingestion_pipeline, "embedder", embedder)
    monkeypatch.setattr(rag_router_module.ingestion_pipeline, "vector_store", VectorStoreWithStaleSpace())
    monkeypatch.setenv("ENVIRONMENT", "test")

    snapshot = rag_router_module.rag_readiness_snapshot()
    assert snapshot["status"] == "NOT_READY"
    assert snapshot["checks"]["vector_embedding_identity"] is False


def test_fastapi_rag_endpoints(client):
    # 1. Health Probe
    res_health = client.get("/rag/health")
    assert res_health.status_code == 200
    assert res_health.json()["status"] == "ok"

    # 2. Status Probe
    res_status = client.get("/rag/status")
    assert res_status.status_code == 200
    assert "vector_store_stats" in res_status.json()

    # 3. Index Endpoint
    res_index = client.post(
        "/rag/index",
        json={
            "title": "NPS Tax Relief",
            "content": "Section 80CCD(1B) provides an additional tax deduction of Rs 50,000 for National Pension System.",
            "source": "api_test",
        },
    )
    assert res_index.status_code == 400
    assert "not accepted as authoritative" in res_index.json()["detail"]

    # 4. Query Endpoint
    res_query = client.post(
        "/rag/query",
        json={"question": "How much additional tax deduction is allowed for NPS under 80CCD?"},
    )
    assert res_query.status_code == 200
    data = res_query.json()
    assert "answer" in data
    assert "citations" in data
