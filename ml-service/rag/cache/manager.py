"""
WealthGenie RAG Subsystem - Multi-Level Cache Manager
Provides embedding, retrieval, and response caching with TTL, invalidation, and hit/miss statistics.
"""

import hashlib
import logging
import time
from pathlib import Path
from typing import Dict, Any, List, Optional

from model.config import BASE_DIR
from rag.schema import RAGQueryResponse

CACHE_DIR = BASE_DIR / "reports" / "rag_cache"
CACHE_DIR.mkdir(parents=True, exist_ok=True)

logger = logging.getLogger("wealthgenie.rag.cache")


class CacheItem:
    """Wrapper storing value, creation timestamp, and TTL in seconds."""

    def __init__(self, value: Any, ttl_seconds: float = 3600.0):
        self.value = value
        self.created_at = time.time()
        self.ttl_seconds = ttl_seconds

    def is_expired(self) -> bool:
        """Returns True if item exceeded its TTL."""
        if self.ttl_seconds <= 0:
            return False
        return (time.time() - self.created_at) > self.ttl_seconds


class MultiLevelCacheManager:
    """Enterprise multi-level cache managing embedding, retrieval, and response caches."""

    def __init__(
        self,
        cache_dir: Path = CACHE_DIR,
        response_ttl: float = 3600.0,
        retrieval_ttl: float = 1800.0,
        embedding_ttl: float = 86400.0,
    ):
        self.cache_dir = cache_dir
        self.cache_dir.mkdir(parents=True, exist_ok=True)

        self.response_ttl = response_ttl
        self.retrieval_ttl = retrieval_ttl
        self.embedding_ttl = embedding_ttl

        self._response_cache: Dict[str, CacheItem] = {}
        self._retrieval_cache: Dict[str, CacheItem] = {}
        self._embedding_cache: Dict[str, CacheItem] = {}

        self.stats = {
            "response_hits": 0,
            "response_misses": 0,
            "retrieval_hits": 0,
            "retrieval_misses": 0,
            "embedding_hits": 0,
            "embedding_misses": 0,
        }

    @staticmethod
    def _hash_key(key: str) -> str:
        """Computes deterministic SHA256 hash string for key."""
        return hashlib.sha256(key.encode("utf-8")).hexdigest()

    # --- Response Cache ---
    def get_response(self, query: str, tenant_id: str = "default") -> Optional[RAGQueryResponse]:
        """Retrieves cached response for identical query text within a tenant scope."""
        k = self._hash_key(f"{tenant_id}:{query}")
        item = self._response_cache.get(k)
        if item:
            if item.is_expired():
                del self._response_cache[k]
                self.stats["response_misses"] += 1
                return None
            self.stats["response_hits"] += 1
            return item.value
        self.stats["response_misses"] += 1
        return None

    def put_response(self, query: str, response: RAGQueryResponse, tenant_id: str = "default") -> None:
        """Stores RAG query response in tenant-scoped response cache."""
        k = self._hash_key(f"{tenant_id}:{query}")
        self._response_cache[k] = CacheItem(response, ttl_seconds=self.response_ttl)

    # --- Retrieval Candidate Cache ---
    def get_retrieval(self, query: str, strategy: str) -> Optional[List[Any]]:
        """Retrieves cached chunk candidates for query and strategy."""
        k = self._hash_key(f"{strategy}:{query}")
        item = self._retrieval_cache.get(k)
        if item:
            if item.is_expired():
                del self._retrieval_cache[k]
                self.stats["retrieval_misses"] += 1
                return None
            self.stats["retrieval_hits"] += 1
            return item.value
        self.stats["retrieval_misses"] += 1
        return None

    def put_retrieval(self, query: str, strategy: str, chunks: List[Any]) -> None:
        """Stores retrieval candidates in retrieval cache."""
        k = self._hash_key(f"{strategy}:{query}")
        self._retrieval_cache[k] = CacheItem(chunks, ttl_seconds=self.retrieval_ttl)

    # --- Invalidation & Stats ---
    def invalidate_all(self) -> None:
        """Flushes all in-memory caches."""
        self._response_cache.clear()
        self._retrieval_cache.clear()
        self._embedding_cache.clear()
        logger.info("Flushed all RAG multi-level memory caches.")

    def get_cache_stats(self) -> Dict[str, Any]:
        """Returns cache sizes, hits, misses, and hit rates."""
        resp_total = self.stats["response_hits"] + self.stats["response_misses"]
        ret_total = self.stats["retrieval_hits"] + self.stats["retrieval_misses"]

        return {
            "response_cache_size": len(self._response_cache),
            "response_hit_rate": round(self.stats["response_hits"] / resp_total, 4) if resp_total > 0 else 0.0,
            "retrieval_cache_size": len(self._retrieval_cache),
            "retrieval_hit_rate": round(self.stats["retrieval_hits"] / ret_total, 4) if ret_total > 0 else 0.0,
            "stats": self.stats,
        }
