from types import SimpleNamespace

import pytest

from rag.evaluation.corpus_binding import validate_benchmark_index_binding


def _manifest():
    return {
        "manifest_sha256": "a" * 64,
        "documents": [{
            "document_key": "current-document",
            "content_sha256": "b" * 64,
            "official_source_url": "https://authority.gov.in/current.pdf",
            "supporting_official_sources": [],
            "publishing_authority": "Official Authority",
            "publication_date": "2026-01-01",
            "effective_from": "2026-01-01",
            "effective_to": None,
            "document_version": "2026-01-01",
            "trust_tier": "government_official",
            "jurisdiction": "IN",
            "supported_topics": ["tax"],
            "excluded_topics": [],
        }],
    }


def _chunk(
    manifest,
    *,
    document_key="current-document",
    manifest_sha=None,
    content_sha=None,
    trust_tier=None,
    supporting_sources=None,
    scope="global",
):
    entry = manifest["documents"][0]
    return SimpleNamespace(
        chunk_id="current-document#0000",
        lifecycle_state="ACTIVE",
        metadata=SimpleNamespace(
            source=entry["official_source_url"],
            author=entry["publishing_authority"],
            source_trust_tier=trust_tier or entry["trust_tier"],
            scope=scope,
            tenant_id="default",
            publication_date=entry["publication_date"],
            effective_date=entry["effective_from"],
            custom_metadata={
                "document_key": document_key,
                "corpus_manifest_sha256": manifest_sha or manifest["manifest_sha256"],
                "content_sha256": content_sha or entry["content_sha256"],
                "effective_to": entry["effective_to"],
                "document_revision": entry["document_version"],
                "supporting_official_sources": (
                    entry["supporting_official_sources"]
                    if supporting_sources is None else supporting_sources
                ),
                "supported_topics": entry["supported_topics"],
                "excluded_topics": entry["excluded_topics"],
            },
        ),
        scope=scope,
        tenant_id="default",
    )


def _store(chunks):
    return SimpleNamespace(
        get_chunks=lambda: chunks,
        get_corpus_revision=lambda: "index-revision-1",
    )


def test_benchmark_index_binding_verifies_active_chunks_against_current_manifest():
    manifest = _manifest()

    result = validate_benchmark_index_binding(
        _store([_chunk(manifest)]), manifest,
        {"current-document": {"current-document#0000"}},
    )

    assert result == {
        "status": "VERIFIED",
        "manifest_sha256": manifest["manifest_sha256"],
        "index_revision": "index-revision-1",
        "active_chunk_count": 1,
        "active_document_keys": ["current-document"],
    }


def test_benchmark_index_binding_rejects_empty_or_incomplete_indexes():
    manifest = _manifest()

    with pytest.raises(ValueError, match="no active chunks"):
        validate_benchmark_index_binding(
            _store([]), manifest, {"current-document": {"current-document#0000"}},
        )


def test_benchmark_index_binding_rejects_stale_manifest_chunks():
    manifest = _manifest()

    with pytest.raises(ValueError, match="does not match the current manifest"):
        validate_benchmark_index_binding(
            _store([_chunk(manifest, manifest_sha="c" * 64)]), manifest,
            {"current-document": {"current-document#0000"}},
        )


def test_benchmark_index_binding_rejects_active_documents_outside_manifest():
    manifest = _manifest()

    with pytest.raises(ValueError, match="outside the current manifest"):
        validate_benchmark_index_binding(
            _store([_chunk(manifest, document_key="superseded-document")]), manifest,
            {"current-document": {"current-document#0000"}},
        )


def test_benchmark_index_binding_rejects_incomplete_current_document_chunks():
    manifest = _manifest()

    with pytest.raises(ValueError, match="complete current manifest chunk set"):
        validate_benchmark_index_binding(
            _store([_chunk(manifest)]), manifest,
            {"current-document": {"current-document#0000", "current-document#0001"}},
        )


@pytest.mark.parametrize(
    ("chunk_kwargs", "message"),
    [
        ({"trust_tier": "unverified_user_input"}, "does not match the current manifest"),
        ({"supporting_sources": ["https://attacker.example/source"]}, "does not match the current manifest"),
        ({"scope": "user:someone-else"}, "does not match the current manifest"),
    ],
)
def test_benchmark_index_binding_rejects_mismatched_provenance(chunk_kwargs, message):
    manifest = _manifest()

    with pytest.raises(ValueError, match=message):
        validate_benchmark_index_binding(
            _store([_chunk(manifest, **chunk_kwargs)]), manifest,
            {"current-document": {"current-document#0000"}},
        )
