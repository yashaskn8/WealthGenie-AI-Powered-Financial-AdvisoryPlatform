"""Seed only the current, hash-verified documents in the canonical RAG manifest."""

from __future__ import annotations

import logging
from datetime import date

from rag.config import BASE_DIR
from rag.corpus_manifest import (
    MANIFEST_FILENAME,
    current_documents,
    load_corpus_manifest,
)
from rag.ingestion.loaders import DocumentLoader
from rag.ingestion.pipeline import IngestionPipeline

logger = logging.getLogger("wealthgenie.rag.seed_knowledge")
CORPUS_DIR = BASE_DIR / "rag" / "data" / "corpus"


def seed_default_knowledge_base(force_reingest: bool = False) -> int:
    """Ingest verified documents effective today; never infer corpus health from count."""
    manifest = load_corpus_manifest(CORPUS_DIR / MANIFEST_FILENAME, CORPUS_DIR)
    current_entries = current_documents(manifest, as_of=date.today())
    pipeline = IngestionPipeline()
    loader = DocumentLoader()

    for entry in current_entries:
        path = CORPUS_DIR / entry["local_filename"]
        document = loader.load_file(path)
        existing = pipeline.vector_store.get_chunks(document.document_id)
        manifest_hash = manifest["manifest_sha256"]
        already_current = bool(existing) and all(
            chunk.lifecycle_state == "ACTIVE"
            and chunk.metadata.custom_metadata.get("corpus_manifest_sha256") == manifest_hash
            and chunk.metadata.custom_metadata.get("content_sha256") == entry["content_sha256"]
            for chunk in existing
        )
        if already_current and not force_reingest:
            continue
        pipeline.ingest_file(path)

    stats = pipeline.vector_store.get_stats()
    logger.info(
        "Verified RAG corpus seed completed: manifest=%s current_documents=%d active_chunks=%d",
        manifest["manifest_sha256"],
        len(current_entries),
        stats["total_chunks"],
    )
    return stats["total_chunks"]
