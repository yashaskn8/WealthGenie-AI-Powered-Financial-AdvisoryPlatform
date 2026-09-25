"""
WealthGenie RAG Subsystem - Dense Vector Retriever
Retrieves chunks by embedding the query and searching the vector store using Cosine Similarity.
"""

from typing import List, Optional
from rag.embeddings.base import BaseEmbeddingProvider
from rag.embeddings.dense_embedding import get_embedding_provider
from rag.embeddings.identity import normalize_embedding_identity
from rag.retrievers.base import BaseRetriever
from rag.schema import RetrievedChunk
from rag.vector_store.base import BaseVectorStore
from rag.vector_store.memory_vector_store import PersistentVectorStore


class DenseRetriever(BaseRetriever):
    """Dense vector retriever using embedding similarity search."""

    def __init__(
        self,
        embedder: Optional[BaseEmbeddingProvider] = None,
        vector_store: Optional[BaseVectorStore] = None,
    ):
        self.embedder = embedder or get_embedding_provider()
        self.vector_store = vector_store or PersistentVectorStore()

    def retrieve(
        self,
        query: str,
        top_k: int = 4,
        threshold: float = 0.0,
        tenant_id: str = "default",
        user_id: Optional[str] = None,
        scope: Optional[str] = None,
    ) -> List[RetrievedChunk]:
        """Embeds query and searches vector store within tenant/user scope."""
        embedding_identity = normalize_embedding_identity(
            getattr(self.embedder, "embedding_identity", None)
        )
        query_vector = self.embedder.embed_text(query)
        return self.vector_store.search(
            query_vector=query_vector,
            top_k=top_k,
            threshold=threshold,
            tenant_id=tenant_id,
            user_id=user_id,
            scope=scope,
            embedding_identity=embedding_identity,
        )

    @property
    def strategy_name(self) -> str:
        return "dense"
