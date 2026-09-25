"""
Unit tests for document metadata schema, effective_date, source_trust_tier, and metadata filtering.
"""

import tempfile
from pathlib import Path
from rag.corpus_manifest import MANIFEST_FILENAME, load_corpus_manifest
from rag.ingestion.pipeline import AdministrativeIngestionOverride, IngestionPipeline
from rag.schema import DocumentMetadata
from rag.vector_store.memory_vector_store import PersistentVectorStore


def test_document_metadata_schema_recency_fields():
    """Verifies DocumentMetadata schema handles effective_date and source_trust_tier."""
    meta = DocumentMetadata(
        title="Income Tax Circular",
        source="incometax.gov.in",
        author="CBDT",
        effective_date="2025-04-01",
        source_trust_tier="government_official",
    )
    assert meta.effective_date == "2025-04-01"
    assert meta.source_trust_tier == "government_official"


def test_unmanifested_official_claim_is_quarantined_not_promoted():
    """A claimed official URL cannot create trusted regulatory evidence."""
    with tempfile.TemporaryDirectory() as tmp_dir:
        index_file = Path(tmp_dir) / "test_meta_index.json"
        store = PersistentVectorStore(index_path=index_file, force_numpy=True)
        pipeline = IngestionPipeline(vector_store=store)

        pipeline.ingest_text(
            text="Section 80C allows tax deduction up to Rs 1,50,000 per financial year.",
            title="Tax Law 2025",
            source="https://www.incometaxindia.gov.in/official/tax-2025",
            author="Income Tax Department",
            effective_date="2025-04-01",
            source_trust_tier="government_official",
            administrative_override=AdministrativeIngestionOverride(
                operator_id="metadata-test",
                reason="Quarantine an unmanifested source claim for metadata testing.",
            ),
        )

        assert len(store._chunks) > 0
        first_chunk = store._chunks[0]
        assert first_chunk.metadata.effective_date == "2025-04-01"
        assert first_chunk.metadata.source_trust_tier == "administrative_override_untrusted"


def test_metadata_filtering_by_trust_tier():
    """Verifies filtering chunks by source_trust_tier metadata property."""
    with tempfile.TemporaryDirectory() as tmp_dir:
        index_file = Path(tmp_dir) / "test_filter_index.json"
        store = PersistentVectorStore(index_path=index_file, force_numpy=True)
        pipeline = IngestionPipeline(vector_store=store)

        corpus_dir = Path(__file__).parents[1] / "rag" / "data" / "corpus"
        manifest = load_corpus_manifest(corpus_dir / MANIFEST_FILENAME, corpus_dir)
        pipeline.ingest_file(corpus_dir / manifest["documents"][0]["local_filename"])

        pipeline.ingest_text(
            text="Third-party blog discussion on potential tax savings.",
            title="Blog Post",
            source="blog.txt",
            effective_date="2024-01-01",
            source_trust_tier="internal_analysis",
            administrative_override=AdministrativeIngestionOverride(
                operator_id="metadata-test",
                reason="Quarantine an untrusted metadata-filtering test document.",
            ),
        )

        gov_chunks = [c for c in store._chunks if c.metadata.source_trust_tier == "government_official"]
        quarantined_chunks = [
            c for c in store._chunks
            if c.metadata.source_trust_tier == "administrative_override_untrusted"
        ]

        assert len(gov_chunks) >= 1
        assert len(quarantined_chunks) >= 1
        assert all(c.metadata.source_trust_tier == "government_official" for c in gov_chunks)
