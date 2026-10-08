from __future__ import annotations

from datetime import date
from typing import Any

from rag.corpus_manifest import current_documents


def validate_benchmark_index_binding(
    vector_store,
    manifest: dict[str, Any],
    expected_chunk_ids_by_document: dict[str, set[str]],
    as_of: date | None = None,
) -> dict[str, Any]:
    """Require the persisted benchmark index to contain only complete, current manifest evidence."""
    manifest_sha256 = manifest.get("manifest_sha256")
    if not isinstance(manifest_sha256, str) or len(manifest_sha256) != 64:
        raise ValueError("Benchmark corpus manifest identity is invalid.")

    expected_documents = {
        entry["document_key"]: entry
        for entry in current_documents(manifest, as_of=as_of)
    }
    if not expected_documents:
        raise ValueError("Benchmark corpus manifest has no currently effective documents.")
    if set(expected_chunk_ids_by_document) != set(expected_documents):
        raise ValueError("Expected benchmark chunks do not match the current manifest document set.")
    if any(not chunk_ids for chunk_ids in expected_chunk_ids_by_document.values()):
        raise ValueError("A currently effective manifest document produced no expected chunks.")

    chunks = vector_store.get_chunks()
    active_chunks = [chunk for chunk in chunks if getattr(chunk, "lifecycle_state", None) == "ACTIVE"]
    if not active_chunks:
        raise ValueError("Benchmark vector index has no active chunks for the current manifest.")

    observed_chunk_ids_by_document: dict[str, set[str]] = {
        document_key: set() for document_key in expected_documents
    }
    for chunk in active_chunks:
        metadata = getattr(chunk, "metadata", None)
        custom = getattr(metadata, "custom_metadata", None)
        if not isinstance(custom, dict):
            raise ValueError("Benchmark vector index chunk metadata is invalid.")
        document_key = custom.get("document_key")
        expected = expected_documents.get(document_key)
        if expected is None:
            raise ValueError("Benchmark vector index contains active evidence outside the current manifest.")
        chunk_id = getattr(chunk, "chunk_id", None)
        if not isinstance(chunk_id, str) or chunk_id not in expected_chunk_ids_by_document[document_key]:
            raise ValueError("Benchmark vector index contains a chunk outside the current manifest corpus.")
        if chunk_id in observed_chunk_ids_by_document[document_key]:
            raise ValueError("Benchmark vector index contains a duplicate active chunk.")
        identity_matches = (
            custom.get("corpus_manifest_sha256") == manifest_sha256
            and custom.get("content_sha256") == expected["content_sha256"]
            and metadata.source == expected["official_source_url"]
            and metadata.author == expected["publishing_authority"]
            and metadata.source_trust_tier == expected["trust_tier"]
            and metadata.scope == "global"
            and metadata.tenant_id in {"default", "global"}
            and getattr(chunk, "scope", None) == "global"
            and getattr(chunk, "tenant_id", None) in {"default", "global"}
            and metadata.publication_date == expected["publication_date"]
            and metadata.effective_date == expected["effective_from"]
            and custom.get("effective_to") == expected["effective_to"]
            and custom.get("document_revision") == expected["document_version"]
            and custom.get("supporting_official_sources") == expected["supporting_official_sources"]
            and custom.get("supported_topics") == expected["supported_topics"]
            and custom.get("excluded_topics") == expected["excluded_topics"]
        )
        if not identity_matches:
            raise ValueError("Benchmark vector index evidence does not match the current manifest.")
        observed_chunk_ids_by_document[document_key].add(chunk_id)

    if observed_chunk_ids_by_document != expected_chunk_ids_by_document:
        raise ValueError("Benchmark vector index does not contain the complete current manifest chunk set.")

    return {
        "status": "VERIFIED",
        "manifest_sha256": manifest_sha256,
        "index_revision": str(vector_store.get_corpus_revision()),
        "active_chunk_count": len(active_chunks),
        "active_document_keys": sorted(observed_chunk_ids_by_document),
    }
