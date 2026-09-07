"""
WealthGenie RAG Subsystem - Abstract Vector Store Repository Interface
Defines the standard repository contract for vector search storage engines.
"""

from abc import ABC, abstractmethod
from typing import List, Dict, Any, Optional
from rag.schema import TextChunk, RetrievedChunk


class BaseVectorStore(ABC):
    """Abstract Base Class for vector database storage implementations."""

    @abstractmethod
    def add_chunks(self, chunks: List[TextChunk]) -> int:
        """Adds a list of embedded TextChunks to vector storage. Returns count added."""
        pass

    @abstractmethod
    def search(
        self,
        query_vector: List[float],
        top_k: int = 4,
        threshold: float = 0.0,
        tenant_id: str = "default",
        user_id: Optional[str] = None,
        scope: Optional[str] = None,
    ) -> List[RetrievedChunk]:
        """Executes tenant-isolated similarity vector search and returns top-k ranked chunks with similarity scores."""
        pass

    @abstractmethod
    def get_stats(self) -> Dict[str, Any]:
        """Returns storage metrics (chunk count, document count, dimension)."""
        pass

    @abstractmethod
    def save(self) -> None:
        """Persists index to storage."""
        pass

    @abstractmethod
    def load(self) -> None:
        """Loads index from storage."""
        pass
