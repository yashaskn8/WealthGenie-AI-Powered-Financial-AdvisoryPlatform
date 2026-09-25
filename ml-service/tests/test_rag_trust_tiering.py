"""
WealthGenie RAG Subsystem - Ingestion Trust Tiering Test Suite
Verifies that only verified sources are advisory-eligible and administrative
overrides remain quarantined from advisory retrieval.
"""

import pytest
from rag.ingestion.pipeline import (
    AdministrativeIngestionOverride,
    IngestionPipeline,
    UntrustedSourceError,
)
from rag.embeddings.dense_embedding import DenseVectorEmbeddingProvider
from rag.vector_store.memory_vector_store import PersistentVectorStore


def test_untrusted_source_rejection(tmp_path):
    index_file = tmp_path / "test_trust_index.json"
    embedder = DenseVectorEmbeddingProvider(dimension=64, enable_cache=False)
    pipeline = IngestionPipeline(embedder=embedder, vector_store=PersistentVectorStore(index_path=index_file))

    # Attempt to ingest document from an untrusted blog source
    with pytest.raises(UntrustedSourceError) as exc_info:
        pipeline.ingest_text(
            text="Get rich quick scheme with guaranteed 50% returns in 30 days.",
            title="Random Investment Blog",
            source="http://random-crypto-blog.com/tips.html",
            source_trust_tier="unverified_web",
        )

    assert "Ingestion rejected" in str(exc_info.value)
    assert "random-crypto-blog.com" in str(exc_info.value)


def test_untrusted_source_administrative_override_is_quarantined(tmp_path):
    index_file = tmp_path / "test_trust_override_index.json"
    embedder = DenseVectorEmbeddingProvider(dimension=64, enable_cache=False)
    pipeline = IngestionPipeline(embedder=embedder, vector_store=PersistentVectorStore(index_path=index_file))

    override = AdministrativeIngestionOverride(
        operator_id="security-reviewer",
        reason="Quarantine document for security review only.",
    )
    res = pipeline.ingest_text(
        text="Special manual audit document.",
        title="Audit Doc",
        source="http://internal-audit-server.local/doc.pdf",
        administrative_override=override,
    )
    assert res["status"] == "success"
    assert res["chunks_created"] > 0
    stored = pipeline.vector_store._chunks[0]
    assert stored.metadata.source_trust_tier == "administrative_override_untrusted"
    assert stored.metadata.custom_metadata["quarantined_from_advisory"] is True


def test_casual_boolean_override_is_not_supported(tmp_path):
    pipeline = IngestionPipeline(
        embedder=DenseVectorEmbeddingProvider(dimension=64, enable_cache=False),
        vector_store=PersistentVectorStore(index_path=tmp_path / "boolean_override.json"),
    )
    with pytest.raises(TypeError):
        pipeline.ingest_text(
            text="Untrusted financial claim that must not be indexed.",
            title="Untrusted",
            source="https://attacker.example/claim",
            manual_override=True,
        )


def test_official_domain_claim_without_manifest_is_rejected(tmp_path):
    index_file = tmp_path / "test_trust_gov_index.json"
    embedder = DenseVectorEmbeddingProvider(dimension=64, enable_cache=False)
    pipeline = IngestionPipeline(embedder=embedder, vector_store=PersistentVectorStore(index_path=index_file))

    # Domain identity and caller-supplied trust labels are not the trust root.
    with pytest.raises(UntrustedSourceError):
        pipeline.ingest_text(
            text="SEBI mutual fund categorization guidelines require 65% equity allocation for flexicap funds.",
            title="SEBI Mutual Fund Circular",
            source="https://www.sebi.gov.in/legal/circulars/feb-2026/categorization_99983.html",
            source_trust_tier="government_official",
        )
    assert pipeline.vector_store.get_stats()["total_chunks"] == 0
