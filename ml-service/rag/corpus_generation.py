"""Canonical identities for immutable Mongo-backed RAG corpus generations."""

from __future__ import annotations

import hashlib
from pathlib import Path
from typing import Any, Mapping

from rag.corpus_manifest import MANIFEST_FILENAME, load_corpus_manifest
from rag.embeddings.identity import normalize_embedding_identity


def canonical_json_bytes(value: Any) -> bytes:
    import json

    return json.dumps(
        value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False
    ).encode("utf-8")


def sha256_canonical(value: Any) -> str:
    return hashlib.sha256(canonical_json_bytes(value)).hexdigest()


def current_manifest_sha256() -> str:
    corpus_dir = Path(__file__).resolve().parent / "data" / "corpus"
    return load_corpus_manifest(corpus_dir / MANIFEST_FILENAME, corpus_dir)["manifest_sha256"]


def canonical_member(
    revision: Mapping[str, Any], chunks: list[Mapping[str, Any]]
) -> dict[str, Any]:
    ordered_chunks = sorted(chunks, key=lambda item: str(item.get("chunk_id", "")))
    if not ordered_chunks or any(not isinstance(item.get("chunk_id"), str) for item in ordered_chunks):
        raise ValueError("corpus member must contain a complete, identified chunk set")
    chunk_rows = []
    for chunk in ordered_chunks:
        content = chunk.get("content")
        if not isinstance(content, str):
            raise ValueError("corpus chunk content is unavailable")
        embedding = chunk.get("embedding")
        if not isinstance(embedding, list):
            raise ValueError("corpus chunk embedding is unavailable")
        chunk_rows.append({
            "chunk_id": chunk["chunk_id"],
            "content_sha256": hashlib.sha256(content.encode("utf-8")).hexdigest(),
            "embedding_sha256": hashlib.sha256(canonical_json_bytes(embedding)).hexdigest(),
        })
    return {
        "document_revision_id": revision["document_revision_id"],
        "document_id": revision["document_id"],
        "version_number": int(revision["version_number"]),
        "scope": revision.get("scope", "global"),
        "tenant_id": revision.get("tenant_id", "default"),
        "chunk_count": len(chunk_rows),
        "chunk_set_sha256": sha256_canonical(chunk_rows),
    }


def generation_digest(members: list[Mapping[str, Any]]) -> str:
    # `generation_id` and Mongo's `_id` are storage-envelope fields, not corpus
    # membership. Hash only the canonical member contract so a digest computed
    # before insertion equals the same members read back from Mongo.
    canonical_members = [
        {key: value for key, value in member.items() if key not in {"_id", "generation_id"}}
        for member in members
    ]
    ordered = sorted(canonical_members, key=lambda item: str(item["document_revision_id"]))
    return sha256_canonical(ordered)


def normalize_generation_identity(value: Mapping[str, Any] | None) -> dict[str, Any]:
    return normalize_embedding_identity(value)
