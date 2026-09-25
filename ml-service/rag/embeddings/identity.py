"""Canonical, validated identity for persisted embedding spaces."""

from __future__ import annotations

import re
from typing import Any, Mapping


class EmbeddingIdentityError(ValueError):
    """Raised when vector-space provenance is absent or malformed."""


_SHA256_RE = re.compile(r"^[0-9a-f]{64}$")


def normalize_embedding_identity(identity: Mapping[str, Any] | None) -> dict[str, Any]:
    """Validate provider metadata and return one canonical persistence shape.

    Provider implementations historically used short keys. The canonical names
    below are persisted with every chunk so equal dimensions cannot be mistaken
    for equal vector spaces.
    """
    if not isinstance(identity, Mapping):
        raise EmbeddingIdentityError("Embedding identity is required.")

    provider = identity.get("embedding_provider", identity.get("provider"))
    model_id = identity.get("embedding_model_id", identity.get("model_id"))
    model_revision = identity.get("embedding_model_revision", identity.get("model_revision"))
    dimension = identity.get("embedding_dimension", identity.get("dimension"))
    config_hash = identity.get("embedding_config_hash", identity.get("config_hash"))

    if any(not isinstance(value, str) or not value.strip() for value in (provider, model_id, model_revision)):
        raise EmbeddingIdentityError("Embedding provider, model ID, and revision are required.")
    if isinstance(dimension, bool) or not isinstance(dimension, int) or dimension < 1:
        raise EmbeddingIdentityError("Embedding dimension must be a positive integer.")
    if not isinstance(config_hash, str) or not _SHA256_RE.fullmatch(config_hash):
        raise EmbeddingIdentityError("Embedding configuration must be identified by a SHA-256 hash.")

    return {
        "embedding_provider": provider.strip(),
        "embedding_model_id": model_id.strip(),
        "embedding_model_revision": model_revision.strip(),
        "embedding_dimension": dimension,
        "embedding_config_hash": config_hash,
    }
