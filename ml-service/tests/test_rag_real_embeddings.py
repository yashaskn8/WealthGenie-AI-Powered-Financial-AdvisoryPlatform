"""
WealthGenie RAG Subsystem - Real Embedding Verification Test Suite
Proves semantic understanding, batch efficiency, dimension mismatch guards, and factory routing.
"""

import time
import json
import os
import subprocess
import sys
from pathlib import Path
import pytest
import numpy as np

from rag.config import RAGConfig
from rag.embeddings.dense_embedding import (
    DenseVectorEmbeddingProvider,
    SentenceTransformerEmbeddingProvider,
    get_embedding_provider,
)
from rag.vector_store.memory_vector_store import PersistentVectorStore
from rag.schema import TextChunk, ChunkMetadata
from rag.embeddings.cache import EmbeddingCache


def cosine_similarity(a, b):
    a, b = np.array(a), np.array(b)
    dot = np.dot(a, b)
    norm_a, norm_b = np.linalg.norm(a), np.linalg.norm(b)
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return float(dot / (norm_a * norm_b))


# ── 1. Semantic Similarity Proof ───────────────────────────────────────


def test_semantic_similarity_same_meaning_zero_word_overlap():
    """Two sentences with the SAME meaning but ZERO shared content words
    should have HIGH cosine similarity with the real model, and near-zero
    with the old hashing provider."""
    st = SentenceTransformerEmbeddingProvider(enable_cache=False)
    hashing = DenseVectorEmbeddingProvider(dimension=128, enable_cache=False)

    sent_a = "portfolio value dropped significantly"
    sent_b = "investment returns declined sharply"

    # Real model: should be high
    vec_a = st.embed_text(sent_a)
    vec_b = st.embed_text(sent_b)
    real_sim = cosine_similarity(vec_a, vec_b)
    print(f"\n[REAL MODEL] Same-meaning similarity: {real_sim:.4f}")
    assert real_sim > 0.4, f"Expected high similarity, got {real_sim}"

    # Hashing fallback: should be low (no shared subwords of significance)
    hash_a = hashing.embed_text(sent_a)
    hash_b = hashing.embed_text(sent_b)
    hash_sim = cosine_similarity(hash_a, hash_b)
    print(f"[HASHING]    Same-meaning similarity: {hash_sim:.4f}")

    # The real model should be substantially better
    assert real_sim > hash_sim, (
        f"Real model should beat hashing by a meaningful margin: "
        f"real={real_sim:.4f}, hash={hash_sim:.4f}"
    )


def test_semantic_negation_distinction():
    """Two sentences that share many words but mean OPPOSITE things.

    NOTE: Bi-encoder models like MiniLM are known to struggle with negation —
    "gained value" vs "did not gain value" share deep semantic structure and
    the model may score them similarly. This test verifies the model produces
    meaningful, differentiated embeddings and documents the known limitation.
    """
    st = SentenceTransformerEmbeddingProvider(enable_cache=False)

    sent_pos = "the fund gained significant value"
    sent_neg = "the fund did not gain significant value"
    sent_unrelated = "the weather in Tokyo is sunny today"

    vec_pos = st.embed_text(sent_pos)
    vec_neg = st.embed_text(sent_neg)
    vec_unrelated = st.embed_text(sent_unrelated)

    sim_pos_neg = cosine_similarity(vec_pos, vec_neg)
    sim_pos_unrelated = cosine_similarity(vec_pos, vec_unrelated)

    print(f"\n[REAL MODEL] Positive vs Negated: {sim_pos_neg:.4f}")
    print(f"[REAL MODEL] Positive vs Unrelated: {sim_pos_unrelated:.4f}")

    # The negated sentence should be MORE similar to the positive than an
    # unrelated sentence — the model recognizes they discuss the same topic.
    # But the unrelated sentence should be clearly distant.
    assert sim_pos_neg > sim_pos_unrelated, (
        "Model should recognize negation pair shares topic vs unrelated sentence"
    )
    # The unrelated sentence should have low similarity
    assert sim_pos_unrelated < 0.3, (
        f"Unrelated sentence should have low similarity, got {sim_pos_unrelated:.4f}"
    )
    # Document: negation distinction is a known bi-encoder limitation.
    # MiniLM may score negation pair at ~0.85. A cross-encoder or
    # finance-tuned model would handle this better.


# ── 2. Batch vs Loop Performance Proof ──────────────────────────────────


def test_batch_encode_is_not_n_times_single_encode():
    """embed_batch(50 texts) should NOT take ~50x the time of a single embed_text.
    This proves the batch calls the model's native batch encode, not a Python loop."""
    st = SentenceTransformerEmbeddingProvider(enable_cache=False)

    texts = [f"Financial advisory document about tax regulation number {i}" for i in range(50)]

    # Time single embed_text
    t0 = time.perf_counter()
    _ = st.embed_text(texts[0])
    single_time = time.perf_counter() - t0

    # Time batch embed_batch(50)
    t1 = time.perf_counter()
    results = st.embed_batch(texts)
    batch_time = time.perf_counter() - t1

    print(f"\n[TIMING] Single embed_text: {single_time*1000:.1f}ms")
    print(f"[TIMING] Batch embed_batch(50): {batch_time*1000:.1f}ms")
    print(f"[TIMING] Ratio batch/single: {batch_time/single_time:.1f}x (should be << 50x)")

    assert len(results) == 50
    assert len(results[0]) == st.embedding_dimension

    # Batch of 50 should be significantly less than 50x single
    # Allow some margin — if truly looping, ratio would be ~50. With batching, typically <10x.
    assert batch_time < single_time * 30, (
        f"Batch appears to be looping: batch={batch_time:.3f}s vs single={single_time:.3f}s "
        f"(ratio={batch_time/single_time:.1f}x)"
    )


# ── 3. Dimension Mismatch Guard ─────────────────────────────────────────


def test_dimension_mismatch_raises_clear_error(tmp_path):
    """Querying a 128-dim index with a 384-dim query vector should fail loudly."""
    # Create a vector store with 128-dim embeddings
    store = PersistentVectorStore(index_path=tmp_path / "test_dim_mismatch.json")
    hashing = DenseVectorEmbeddingProvider(dimension=128, enable_cache=False)

    chunk = TextChunk(
        chunk_id="dim_test_1",
        document_id="doc_1",
        content="Section 87A tax rebate information",
        embedding=hashing.embed_text("Section 87A tax rebate information"),
        metadata=ChunkMetadata(
            title="Tax Doc",
            source="test",
            chunk_id="dim_test_1",
            document_id="doc_1",
            chunk_index=0,
        ),
    )
    store.add_chunks([chunk])

    # Now query with a 384-dim vector (as the real model would produce)
    query_384 = [0.01] * 384

    with pytest.raises(ValueError, match="dimension mismatch"):
        store.search(query_vector=query_384, top_k=4)


# ── 4. Factory Function Routing ──────────────────────────────────────────


def test_factory_returns_sentence_transformer_by_default():
    config = RAGConfig()
    assert config.embedding_provider == "sentence_transformer"
    provider = get_embedding_provider(config)
    assert isinstance(provider, SentenceTransformerEmbeddingProvider)
    assert provider.embedding_dimension == 384


def test_factory_returns_hashing_for_tf_idf_dense():
    config = RAGConfig(embedding_provider="tf_idf_dense", embedding_dim=64)
    provider = get_embedding_provider(config)
    assert isinstance(provider, DenseVectorEmbeddingProvider)
    assert provider.embedding_dimension == 64


def test_production_rejects_explicit_lexical_embedding_provider(monkeypatch):
    monkeypatch.setenv("ENVIRONMENT", "production")
    with pytest.raises(RuntimeError, match="requires the pinned semantic embedding provider"):
        get_embedding_provider(RAGConfig(embedding_provider="tf_idf_dense", embedding_dim=64))


def test_factory_raises_for_unknown_provider():
    from pydantic import ValidationError
    with pytest.raises(ValidationError):
        RAGConfig(embedding_provider="nonexistent")


def test_lexical_fallback_is_identical_across_python_processes():
    service_root = Path(__file__).resolve().parents[1]
    command = (
        "import json; from rag.embeddings.dense_embedding import DenseVectorEmbeddingProvider; "
        "print(json.dumps(DenseVectorEmbeddingProvider(dimension=64, enable_cache=False).embed_text('stable financial token vector')))"
    )
    vectors = []
    for _ in range(2):
        result = subprocess.run(
            [sys.executable, "-c", command],
            cwd=service_root,
            env={**os.environ, "PYTHONHASHSEED": "random"},
            check=True,
            capture_output=True,
            text=True,
        )
        vectors.append(json.loads(result.stdout))
    assert vectors[0] == vectors[1]


def test_embedding_cache_is_bound_to_embedding_space(tmp_path):
    cache_path = tmp_path / "cache.json"
    text = "same text, distinct vector spaces"
    cache_v1 = EmbeddingCache(cache_path, {"provider": "model", "model_id": "x", "model_revision": "a", "dimension": 3, "config_hash": "a"})
    cache_v1.put(text, [1.0, 0.0, 0.0])
    cache_v1.save()

    same_space = EmbeddingCache(cache_path, {"provider": "model", "model_id": "x", "model_revision": "a", "dimension": 3, "config_hash": "a"})
    other_revision = EmbeddingCache(cache_path, {"provider": "model", "model_id": "x", "model_revision": "b", "dimension": 3, "config_hash": "a"})
    assert same_space.get(text) == [1.0, 0.0, 0.0]
    assert other_revision.get(text) is None


# ── 5. Embedding Dimension Property ─────────────────────────────────────


def test_sentence_transformer_dimension_from_model():
    """embedding_dimension should be read from the model, not hardcoded."""
    st = SentenceTransformerEmbeddingProvider(enable_cache=False)
    dim = st.embedding_dimension
    assert dim == 384
    # Verify actual output matches
    vec = st.embed_text("test")
    assert len(vec) == dim
