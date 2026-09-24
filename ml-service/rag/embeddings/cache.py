"""
WealthGenie RAG Subsystem - Embedding Cache Module
Caches text vector embeddings in memory and on disk using SHA256 hashes to prevent recomputation.
"""

import hashlib
import json
import logging
from pathlib import Path
from typing import Dict, List, Optional

from rag.config import RAGConfig

logger = logging.getLogger("wealthgenie.rag.cache")


class EmbeddingCache:
    """Disk and memory-backed cache for text vector embeddings."""

    def __init__(self, cache_path: Optional[Path] = None, embedding_identity: Optional[Dict[str, object]] = None):
        self.cache_path = cache_path or RAGConfig().cache_path
        self.embedding_identity = dict(embedding_identity or {
            "provider": "unspecified",
            "model_id": "unspecified",
            "model_revision": "unspecified",
            "dimension": None,
            "config_hash": "unspecified",
        })
        self._cache: Dict[str, List[float]] = {}
        self.hits = 0
        self.misses = 0
        self._load_cache()

    @staticmethod
    def hash_text(text: str) -> str:
        """Computes SHA256 hash of text."""
        return hashlib.sha256(text.encode("utf-8")).hexdigest()

    def get(self, text: str) -> Optional[List[float]]:
        """Retrieves cached embedding for text if present."""
        key = self._cache_key(text)
        if key in self._cache:
            self.hits += 1
            return self._cache[key]
        self.misses += 1
        return None

    def put(self, text: str, embedding: List[float]) -> None:
        """Stores embedding in cache."""
        key = self._cache_key(text)
        self._cache[key] = embedding

    def _cache_key(self, text: str) -> str:
        identity = {
            **self.embedding_identity,
            "text_sha256": self.hash_text(text),
        }
        canonical = json.dumps(identity, sort_keys=True, separators=(",", ":"))
        return hashlib.sha256(canonical.encode("utf-8")).hexdigest()

    def save(self) -> None:
        """Persists memory cache to disk."""
        self.cache_path.parent.mkdir(parents=True, exist_ok=True)
        with open(self.cache_path, "w", encoding="utf-8") as f:
            json.dump(self._cache, f)
        logger.info(f"Persisted {len(self._cache)} embedding cache entries to {self.cache_path}")

    def _load_cache(self) -> None:
        """Loads cached embeddings from disk if file exists."""
        if self.cache_path.exists():
            try:
                with open(self.cache_path, "r", encoding="utf-8") as f:
                    self._cache = json.load(f)
                logger.info(f"Loaded {len(self._cache)} cached embeddings from disk.")
            except Exception as e:
                logger.warning(f"Could not load embedding cache: {e}")
