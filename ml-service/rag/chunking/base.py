"""
WealthGenie RAG Subsystem - Abstract Base Chunker Interface
Defines standard contract for chunking strategies (FixedSize, Recursive, Semantic).
"""

from abc import ABC, abstractmethod
from typing import List
from rag.schema import Document, TextChunk


class BaseChunker(ABC):
    """Abstract base class for all text chunking strategies."""

    def __init__(self, chunk_size: int = 512, chunk_overlap: int = 64):
        self.chunk_size = chunk_size
        self.chunk_overlap = chunk_overlap

    @abstractmethod
    def chunk_document(self, document: Document) -> List[TextChunk]:
        """Splits a Document into a list of TextChunks preserving metadata."""
        pass
