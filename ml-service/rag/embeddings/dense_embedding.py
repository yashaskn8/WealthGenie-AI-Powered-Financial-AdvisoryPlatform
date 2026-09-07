"""
WealthGenie RAG Subsystem - Embedding Providers & Factory
Contains:
  - DenseVectorEmbeddingProvider: Lightweight lexical fallback (n-gram hashing, no semantic understanding)
  - SentenceTransformerEmbeddingProvider: Production semantic embedding using all-MiniLM-L6-v2
  - get_embedding_provider(): Factory function wired to RAGConfig.embedding_provider
"""

import logging
import math
import os
import re
import time
from typing import List, Optional, cast

import numpy as np

from rag.embeddings.base import BaseEmbeddingProvider
from rag.embeddings.cache import EmbeddingCache

logger = logging.getLogger("wealthgenie.rag.embeddings")


class DenseVectorEmbeddingProvider(BaseEmbeddingProvider):
    """Lightweight lexical fallback embedding provider using subword n-gram hashing and TF-IDF scaling.

    WARNING: This provider has ZERO semantic understanding — it computes vectors via
    deterministic hash bucketing of character n-grams. Two sentences that mean the same
    thing but share no words will produce near-zero cosine similarity.

    Use this only in offline/no-download environments where a real model is unavailable.
    For production semantic retrieval, use SentenceTransformerEmbeddingProvider instead.
    """

    def __init__(self, dimension: int = 128, enable_cache: bool = True):
        self._dim = dimension
        self.enable_cache = enable_cache
        self.cache = EmbeddingCache() if enable_cache else None

    @property
    def embedding_dimension(self) -> int:
        return self._dim

    def _tokenize(self, text: str) -> List[str]:
        """Extracts lowercase word and subword n-grams."""
        cleaned = re.sub(r"[^\w\s]", " ", text.lower())
        tokens = cleaned.split()
        ngrams = []
        for token in tokens:
            ngrams.append(token)
            if len(token) >= 4:
                ngrams.append(token[:3])
                ngrams.append(token[-3:])
        return ngrams

    def embed_text(self, text: str) -> List[float]:
        """Generates unit L2-normalized vector embedding for input text."""
        if self.cache and self.enable_cache:
            cached = self.cache.get(text)
            if cached is not None:
                return cached

        tokens = self._tokenize(text)
        vec = np.zeros(self._dim, dtype=np.float32)

        if not tokens:
            norm_vec = vec.tolist()
            if self.cache and self.enable_cache:
                self.cache.put(text, norm_vec)
            return norm_vec

        # Subword feature hashing trick
        for token in tokens:
            h = hash(token) % self._dim
            weight = math.log(1.0 + len(token))
            vec[h] += weight

        # L2 Normalization
        norm = np.linalg.norm(vec)
        if norm > 0:
            vec = vec / norm

        result = vec.tolist()
        if self.cache and self.enable_cache:
            self.cache.put(text, result)

        return result

    def embed_batch(self, texts: List[str]) -> List[List[float]]:
        """Generates dense vector embeddings for a list of texts."""
        return [self.embed_text(t) for t in texts]


class SentenceTransformerEmbeddingProvider(BaseEmbeddingProvider):
    """Production semantic embedding provider using sentence-transformers/all-MiniLM-L6-v2.

    Produces 384-dimensional dense vector embeddings with genuine semantic understanding.
    Uses the model's native batch encode for efficient multi-text embedding.
    """

    DEFAULT_MODEL_NAME = "sentence-transformers/all-MiniLM-L6-v2"
    _shared_models = {}
    _load_failures = {}
    _failure_retry_seconds = 60.0

    def __init__(self, model_name: Optional[str] = None, enable_cache: bool = True, batch_size: int = 32):
        self._model_name = model_name or self.DEFAULT_MODEL_NAME
        self._batch_size = batch_size
        self.enable_cache = enable_cache
        self.cache = EmbeddingCache() if enable_cache else None

        self._model = self._load_shared_model()
        dimension_getter = getattr(self._model, "get_embedding_dimension", None)
        if not callable(dimension_getter):
            dimension_getter = getattr(
                self._model,
                "get_sentence_embedding_dimension",
                lambda: 384,
            )
        dim = dimension_getter()
        self._dim: int = int(dim) if dim is not None else 384

        logger.info(
            f"Sentence-transformer model loaded: '{self._model_name}' "
            f"(dimension={self._dim}, batch_size={self._batch_size})"
        )

    def _load_shared_model(self):
        """Load one model per process, preferring an existing local snapshot.

        Loading by repository ID can trigger a Hugging Face metadata request even
        when the weights are already cached. Resolve the snapshot locally first so
        service startup and request handling remain deterministic when offline.
        """
        cached_model = self._shared_models.get(self._model_name)
        if cached_model is not None:
            return cached_model

        previous_failure = self._load_failures.get(self._model_name)
        if previous_failure is not None:
            failed_at, failure_message = previous_failure
            if time.monotonic() - failed_at < self._failure_retry_seconds:
                raise RuntimeError(failure_message)

        logger.info(f"Loading sentence-transformer model '{self._model_name}'...")
        from sentence_transformers import SentenceTransformer

        try:
            # Fast path for deployed images and developer machines with a warm cache.
            model = SentenceTransformer(self._model_name, local_files_only=True)
        except Exception as local_error:
            offline = os.environ.get("HF_HUB_OFFLINE", "").lower() in {"1", "true", "yes"}
            offline = offline or os.environ.get("TRANSFORMERS_OFFLINE", "").lower() in {"1", "true", "yes"}
            if offline:
                message = f"Local embedding model unavailable while offline: {local_error}"
                self._load_failures[self._model_name] = (time.monotonic(), message)
                raise RuntimeError(message) from local_error

            try:
                # Cold-start path: allow sentence-transformers to populate its cache once.
                model = SentenceTransformer(self._model_name)
            except Exception as download_error:
                message = f"Embedding model load failed: {download_error}"
                self._load_failures[self._model_name] = (time.monotonic(), message)
                raise RuntimeError(message) from download_error

        self._shared_models[self._model_name] = model
        self._load_failures.pop(self._model_name, None)
        return model

    @property
    def embedding_dimension(self) -> int:
        """Returns the model's actual output dimension (read from the model, not hardcoded)."""
        return self._dim

    def embed_text(self, text: str) -> List[float]:
        """Generates a semantic embedding for a single text using the sentence-transformer model."""
        if self.cache and self.enable_cache:
            cached = self.cache.get(text)
            if cached is not None:
                return cached

        # Encode as single-item batch for consistency
        embedding = self._model.encode([text], batch_size=1, show_progress_bar=False)
        result = embedding[0].tolist()

        if self.cache and self.enable_cache:
            self.cache.put(text, result)

        return result

    def embed_batch(self, texts: List[str]) -> List[List[float]]:
        """Generates semantic embeddings for a batch of texts using native batch encode.

        This calls model.encode() ONCE with the full batch — not N individual calls.
        """
        if not texts:
            return []

        # Check cache for all texts first
        results: List[Optional[List[float]]] = [None] * len(texts)
        uncached_indices = []
        uncached_texts = []

        if self.cache and self.enable_cache:
            for i, text in enumerate(texts):
                cached = self.cache.get(text)
                if cached is not None:
                    results[i] = cached
                else:
                    uncached_indices.append(i)
                    uncached_texts.append(text)
        else:
            uncached_indices = list(range(len(texts)))
            uncached_texts = list(texts)

        # Batch encode all uncached texts in ONE model call
        if uncached_texts:
            embeddings = self._model.encode(
                uncached_texts,
                batch_size=self._batch_size,
                show_progress_bar=False,
            )
            for idx, emb in zip(uncached_indices, embeddings):
                vec = emb.tolist()
                results[idx] = vec
                if self.cache and self.enable_cache:
                    self.cache.put(texts[idx], vec)

        return cast(List[List[float]], results)


def get_embedding_provider(config=None) -> BaseEmbeddingProvider:
    """Factory function that resolves an embedding provider from RAGConfig.embedding_provider.

    Returns:
        - SentenceTransformerEmbeddingProvider for "sentence_transformer" (production default)
        - DenseVectorEmbeddingProvider for "tf_idf_dense" (lightweight lexical fallback)

    If sentence-transformers is not installed, falls back to the hashing provider
    with a warning rather than crashing.
    """
    if config is None:
        from rag.config import RAGConfig
        config = RAGConfig()

    provider_name = config.embedding_provider

    if provider_name == "sentence_transformer":
        try:
            return SentenceTransformerEmbeddingProvider()
        except Exception as e:
            logger.warning(
                f"sentence-transformers model initialization unavailable ({e}). "
                "Falling back to DenseVectorEmbeddingProvider (lexical hashing)."
            )
            return DenseVectorEmbeddingProvider(dimension=config.embedding_dim, enable_cache=True)
    elif provider_name == "tf_idf_dense":
        return DenseVectorEmbeddingProvider(dimension=config.embedding_dim, enable_cache=True)
    else:
        raise ValueError(
            f"Unknown embedding_provider '{provider_name}'. "
            f"Valid options: 'sentence_transformer', 'tf_idf_dense'."
        )
