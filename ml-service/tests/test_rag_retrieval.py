"""
WealthGenie RAG Subsystem - Retrieval Strategies Test Suite
Tests Dense, BM25 Keyword, and Hybrid (RRF & Weighted Fusion) retrievers.
"""

import pytest
from rag.config import RAGConfig
from rag.embeddings.dense_embedding import DenseVectorEmbeddingProvider
from rag.retrievers.bm25_retriever import BM25KeywordRetriever
from rag.retrievers.dense_retriever import DenseRetriever
from rag.retrievers.hybrid_retriever import HybridRetriever
from rag.retrieval.pipeline import RAGPipeline, get_retriever
from rag.schema import TextChunk, ChunkMetadata, RAGQueryRequest
from rag.vector_store.memory_vector_store import PersistentVectorStore


@pytest.fixture
def populated_vector_store(tmp_path):
    store_path = tmp_path / "test_retrieval_index.json"
    store = PersistentVectorStore(index_path=store_path)
    embedder = DenseVectorEmbeddingProvider(dimension=64, enable_cache=False)

    doc1_content = "Under Section 87A rebate for FY 2025-26, taxable income up to 12 Lakhs has zero tax."
    doc2_content = "ELSS Equity Linked Savings Scheme offers tax deduction under Section 80C up to 1.5 Lakhs with 3 year lockin."
    doc3_content = "Bank Fixed Deposits offer guaranteed returns insured up to 5 Lakhs by DICGC."

    chunks = [
        TextChunk(
            chunk_id="d1#0",
            document_id="d1",
            content=doc1_content,
            metadata=ChunkMetadata(chunk_id="d1#0", document_id="d1", chunk_index=0, title="Tax 87A", source="tax.md", source_trust_tier="government_official"),
            embedding=embedder.embed_text(doc1_content),
        ),
        TextChunk(
            chunk_id="d2#0",
            document_id="d2",
            content=doc2_content,
            metadata=ChunkMetadata(chunk_id="d2#0", document_id="d2", chunk_index=0, title="ELSS 80C", source="elss.md", source_trust_tier="government_official"),
            embedding=embedder.embed_text(doc2_content),
        ),
        TextChunk(
            chunk_id="d3#0",
            document_id="d3",
            content=doc3_content,
            metadata=ChunkMetadata(chunk_id="d3#0", document_id="d3", chunk_index=0, title="Fixed Deposit", source="fd.md", source_trust_tier="government_official"),
            embedding=embedder.embed_text(doc3_content),
        ),
    ]

    store.add_chunks(chunks)
    return store, embedder


def test_dense_retriever(populated_vector_store):
    store, embedder = populated_vector_store
    retriever = DenseRetriever(embedder=embedder, vector_store=store)

    results = retriever.retrieve("Section 87A tax rebate", top_k=2)
    assert len(results) > 0
    assert retriever.strategy_name == "dense"


def test_bm25_keyword_retriever(populated_vector_store):
    store, _ = populated_vector_store
    retriever = BM25KeywordRetriever(vector_store=store)

    results = retriever.retrieve("ELSS 80C deduction lockin", top_k=2)
    assert len(results) > 0
    assert results[0].chunk.chunk_id == "d2#0"
    assert retriever.strategy_name == "keyword_bm25"


def test_hybrid_retriever_rrf(populated_vector_store):
    store, embedder = populated_vector_store
    dense_ret = DenseRetriever(embedder=embedder, vector_store=store)
    keyword_ret = BM25KeywordRetriever(vector_store=store)

    hybrid_ret = HybridRetriever(dense_retriever=dense_ret, keyword_retriever=keyword_ret, fusion_mode="rrf")
    results = hybrid_ret.retrieve("Section 80C ELSS mutual fund tax relief", top_k=2)

    assert len(results) > 0
    assert hybrid_ret.strategy_name == "hybrid_rrf"


def test_hybrid_retriever_weighted(populated_vector_store):
    store, embedder = populated_vector_store
    dense_ret = DenseRetriever(embedder=embedder, vector_store=store)
    keyword_ret = BM25KeywordRetriever(vector_store=store)

    hybrid_ret = HybridRetriever(
        dense_retriever=dense_ret,
        keyword_retriever=keyword_ret,
        fusion_mode="weighted",
        dense_weight=0.7,
        keyword_weight=0.3,
    )
    results = hybrid_ret.retrieve("Fixed Deposits DICGC insurance", top_k=2)

    assert len(results) > 0
    assert results[0].chunk.chunk_id == "d3#0"
    assert hybrid_ret.strategy_name == "hybrid_weighted"


def test_get_retriever_factory(populated_vector_store):
    store, embedder = populated_vector_store
    config = RAGConfig(retrieval_strategy="hybrid", fusion_mode="rrf")

    retriever = get_retriever("hybrid", embedder=embedder, vector_store=store, config=config)
    assert isinstance(retriever, HybridRetriever)

    dense_ret = get_retriever("dense", embedder=embedder, vector_store=store, config=config)
    assert isinstance(dense_ret, DenseRetriever)

    kw_ret = get_retriever("keyword", embedder=embedder, vector_store=store, config=config)
    assert isinstance(kw_ret, BM25KeywordRetriever)


def test_rag_pipeline_hybrid_integration(populated_vector_store):
    store, embedder = populated_vector_store
    config = RAGConfig(retrieval_strategy="hybrid", fusion_mode="rrf")
    from pathlib import Path
    from rag.ingestion.pipeline import IngestionPipeline

    corpus_file = Path(__file__).parents[1] / "rag" / "data" / "corpus" / "income_tax_rules_2026_commencement.md"
    IngestionPipeline(embedder=embedder, vector_store=store).ingest_file(corpus_file)

    pipeline = RAGPipeline(embedder=embedder, vector_store=store, config=config)
    req = RAGQueryRequest(question="When do the Income-tax Rules 2026 take effect?")
    res = pipeline.query(req)

    assert res.grounded
    assert len(res.retrieved_chunks) > 0
    assert "retrieval_strategy" in res.metrics
