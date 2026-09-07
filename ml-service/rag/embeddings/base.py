"""
WealthGenie RAG Subsystem - Abstract Embedding Provider Interface
Defines standard contract for generating text vector embeddings.
"""

from abc import ABC, abstractmethod
from typing import List


class BaseEmbeddingProvider(ABC):
    """Abstract Base Class for text embedding providers."""

    @abstractmethod
    def embed_text(self, text: str) -> List[float]:
        """Generates a dense vector embedding for a single text query or chunk."""
        pass

    @abstractmethod
    def embed_batch(self, texts: List[str]) -> List[List[float]]:
        """Generates dense vector embeddings for a batch of texts."""
        pass

    @property
    @abstractmethod
    def embedding_dimension(self) -> int:
        """Returns the fixed vector dimension size."""
        pass
