"""
WealthGenie RAG Subsystem - MongoDB-backed Vector Store

Stores document chunks and embeddings in MongoDB for cross-replica shared state.
Vector search is performed in-memory using FAISS/NumPy after loading embeddings
from MongoDB — MongoDB 7.0 Community Edition does not support Atlas Vector Search.

Known limitation: Each replica loads the full embedding set into RAM on startup.
For very large corpora this will not scale well memory-wise per replica.
"""

import logging
from typing import Dict, List, Any, Optional
import numpy as np

try:
    import faiss
    FAISS_AVAILABLE = True
except ImportError:
    faiss = None
    FAISS_AVAILABLE = False

from pymongo import MongoClient
from pymongo.errors import ConnectionFailure

from rag.schema import TextChunk, RetrievedChunk, ChunkMetadata, is_scope_accessible
from rag.vector_store.base import BaseVectorStore

logger = logging.getLogger("wealthgenie.rag.vector_store.mongo")


class MongoVectorStore(BaseVectorStore):
    """
    MongoDB-backed vector store with in-memory FAISS/NumPy search.

    Chunks and embeddings are persisted in MongoDB for cross-replica access.
    On load(), all embeddings are pulled into memory and a FAISS IndexFlatIP
    is built for cosine similarity search. This is the same search strategy
    as PersistentVectorStore, but with MongoDB replacing JSON files.
    """

    VERSION = "3.1"

    def __init__(
        self,
        mongo_uri: str,
        db_name: str = "wealthgenie",
        collection_name: str = "vector_chunks",
        force_numpy: bool = False,
    ):
        self._client = MongoClient(mongo_uri, serverSelectionTimeoutMS=5000)
        self._db = self._client[db_name]
        self._collection = self._db[collection_name]
        self.force_numpy = force_numpy

        # In-memory search state
        self._chunks: List[TextChunk] = []
        self._embeddings: List[List[float]] = []
        self._stored_embedding_dim: int = 0
        self._faiss_index: Any = None
        self._faiss_dirty: bool = True

        self._init_indexes()
        self.load()

    def _init_indexes(self) -> None:
        """Create MongoDB indexes for efficient querying."""
        try:
            self._collection.create_index("chunk_id", unique=True)
            self._collection.create_index("document_id")
            self._collection.create_index("tenant_id")
            self._collection.create_index("scope")
            logger.info("MongoVectorStore indexes initialized")
        except ConnectionFailure as e:
            logger.error(f"Failed to connect to MongoDB for vector store: {e}")
            raise

    @property
    def is_using_faiss(self) -> bool:
        return FAISS_AVAILABLE and not self.force_numpy

    def add_chunks(self, chunks: List[TextChunk]) -> int:
        """Adds embedded text chunks to MongoDB, avoiding duplicate chunk_ids."""
        added_count = 0
        for chunk in chunks:
            if not chunk.embedding:
                continue

            scope = getattr(chunk, "scope", None) or getattr(chunk.metadata, "scope", "global")
            doc = {
                "chunk_id": chunk.chunk_id,
                "document_id": chunk.document_id,
                "content": chunk.content,
                "metadata": chunk.metadata.model_dump(),
                "tenant_id": chunk.tenant_id,
                "scope": scope,
                "embedding": chunk.embedding,
            }

            # Upsert: update if exists, insert if new
            result = self._collection.update_one(
                {"chunk_id": chunk.chunk_id},
                {"$set": doc},
                upsert=True,
            )
            if result.upserted_id is not None:
                added_count += 1

        # Reload in-memory index after adding
        self._reload_in_memory()
        logger.info(
            f"Added {added_count} new chunks to MongoVectorStore. "
            f"Total: {self._collection.count_documents({})}"
        )
        return added_count

    def search(
        self,
        query_vector: List[float],
        top_k: int = 4,
        threshold: float = 0.0,
        tenant_id: str = "default",
        user_id: Optional[str] = None,
        scope: Optional[str] = None,
    ) -> List[RetrievedChunk]:
        """
        Executes tenant/scope-isolated similarity vector search.
        Filters chunks to scope=='global' OR scope=='user:{requesting_user_id}',
        never returning another user's scoped content.
        """
        if not self._chunks or not self._embeddings:
            return []

        q_vec = np.array(query_vector, dtype=np.float32)
        q_norm = np.linalg.norm(q_vec)
        if q_norm == 0:
            return []
        q_vec = q_vec / q_norm

        # Scope & Tenant filtering: global content or matching user's private content
        valid_indices = [
            i for i, c in enumerate(self._chunks)
            if is_scope_accessible(
                chunk_scope=getattr(c, "scope", getattr(c.metadata, "scope", "global")),
                chunk_tenant_id=getattr(c, "tenant_id", getattr(c.metadata, "tenant_id", "default")),
                requesting_scope=scope,
                requesting_user_id=user_id,
                tenant_id=tenant_id,
            )
        ]
        if not valid_indices:
            return []

        stored_dim = self._stored_embedding_dim
        if len(q_vec) != stored_dim:
            logger.warning(
                f"Query dim {len(q_vec)} != stored dim {stored_dim}. Skipping search."
            )
            return []

        if self.is_using_faiss:
            return self._search_faiss(q_vec, valid_indices, top_k, threshold, stored_dim)
        else:
            return self._search_numpy(q_vec, valid_indices, top_k, threshold)

    def _rebuild_faiss_index(self) -> None:
        """Rebuilds the in-memory FAISS IndexFlatIP from normalized embeddings."""
        if not self.is_using_faiss or not self._embeddings:
            self._faiss_index = None
            self._faiss_dirty = False
            return

        matrix = np.array(self._embeddings, dtype=np.float32)
        norms = np.linalg.norm(matrix, axis=1, keepdims=True)
        norms[norms == 0] = 1.0
        matrix_normed = np.ascontiguousarray(matrix / norms, dtype=np.float32)

        dim = matrix_normed.shape[1]
        self._faiss_index = faiss.IndexFlatIP(dim)
        self._faiss_index.add(matrix_normed)
        self._faiss_dirty = False
        logger.info(f"Rebuilt FAISS index with {matrix_normed.shape[0]} vectors (dim={dim})")

    def _search_faiss(
        self,
        q_vec: np.ndarray,
        valid_indices: List[int],
        top_k: int,
        threshold: float,
        stored_dim: int,
    ) -> List[RetrievedChunk]:
        """Executes vector search using FAISS IndexFlatIP."""
        all_tenant_matched = len(valid_indices) == len(self._chunks)

        if all_tenant_matched:
            if self._faiss_dirty or self._faiss_index is None:
                self._rebuild_faiss_index()

            q_matrix = np.ascontiguousarray(q_vec.reshape(1, -1), dtype=np.float32)
            search_k = min(top_k, self._faiss_index.ntotal)
            scores, indices = self._faiss_index.search(q_matrix, search_k)

            results: List[RetrievedChunk] = []
            for rank, (score_val, idx_val) in enumerate(
                zip(scores[0], indices[0]), start=1
            ):
                if idx_val < 0 or idx_val >= len(self._chunks):
                    continue
                score = float(score_val)
                if score >= threshold:
                    results.append(
                        RetrievedChunk(
                            chunk=self._chunks[idx_val],
                            score=round(score, 4),
                            rank=rank,
                        )
                    )
            return results
        else:
            # Sub-index for filtered tenant subset
            sub_embeddings = [self._embeddings[i] for i in valid_indices]
            matrix = np.array(sub_embeddings, dtype=np.float32)
            norms = np.linalg.norm(matrix, axis=1, keepdims=True)
            norms[norms == 0] = 1.0
            matrix_normed = np.ascontiguousarray(matrix / norms, dtype=np.float32)

            sub_index = faiss.IndexFlatIP(stored_dim)
            sub_index.add(matrix_normed)

            q_matrix = np.ascontiguousarray(q_vec.reshape(1, -1), dtype=np.float32)
            search_k = min(top_k, len(valid_indices))
            scores, indices = sub_index.search(q_matrix, search_k)

            results = []
            for rank, (score_val, sub_idx) in enumerate(
                zip(scores[0], indices[0]), start=1
            ):
                if sub_idx < 0 or sub_idx >= len(valid_indices):
                    continue
                score = float(score_val)
                if score >= threshold:
                    original_idx = valid_indices[sub_idx]
                    results.append(
                        RetrievedChunk(
                            chunk=self._chunks[original_idx],
                            score=round(score, 4),
                            rank=rank,
                        )
                    )
            return results

    def _search_numpy(
        self,
        q_vec: np.ndarray,
        valid_indices: List[int],
        top_k: int,
        threshold: float,
    ) -> List[RetrievedChunk]:
        """Pure-Python / NumPy fallback path for cosine similarity search."""
        sub_embeddings = [self._embeddings[i] for i in valid_indices]
        matrix = np.array(sub_embeddings, dtype=np.float32)
        norms = np.linalg.norm(matrix, axis=1, keepdims=True)
        norms[norms == 0] = 1.0
        matrix_normed = matrix / norms

        similarities = np.dot(matrix_normed, q_vec)
        top_sub_indices = np.argsort(similarities)[::-1][:top_k]

        results: List[RetrievedChunk] = []
        for rank, sub_idx in enumerate(top_sub_indices, start=1):
            score = float(similarities[sub_idx])
            if score >= threshold:
                original_idx = valid_indices[sub_idx]
                results.append(
                    RetrievedChunk(
                        chunk=self._chunks[original_idx],
                        score=round(score, 4),
                        rank=rank,
                    )
                )
        return results

    def get_stats(self) -> Dict[str, Any]:
        """Returns metadata stats for the vector store."""
        total = self._collection.count_documents({})
        unique_docs = len(self._collection.distinct("document_id"))
        dimension = self._stored_embedding_dim
        return {
            "version": self.VERSION,
            "total_chunks": total,
            "total_chunks_in_memory": len(self._chunks),
            "unique_documents": unique_docs,
            "embedding_dimension": dimension,
            "backend": "mongodb",
            "faiss_available": FAISS_AVAILABLE,
            "is_using_faiss": self.is_using_faiss,
        }

    def save(self) -> None:
        """
        No-op for MongoDB store — data is already persisted on every add_chunks().
        Exists to satisfy the BaseVectorStore interface.
        """
        pass

    def load(self) -> None:
        """
        Loads all chunks and embeddings from MongoDB into memory for search.
        Rebuilds the FAISS index after loading.
        """
        self._reload_in_memory()

    def _reload_in_memory(self) -> None:
        """Pull all chunks from MongoDB into in-memory arrays for search."""
        cursor = self._collection.find({}, {"_id": 0})
        self._chunks = []
        self._embeddings = []

        for doc in cursor:
            try:
                meta_dict = dict(doc.get("metadata", {}))
                scope = doc.get("scope", meta_dict.get("scope", "global"))
                meta_dict["scope"] = scope
                metadata = ChunkMetadata(**meta_dict)
                chunk = TextChunk(
                    chunk_id=doc["chunk_id"],
                    document_id=doc["document_id"],
                    content=doc["content"],
                    metadata=metadata,
                    tenant_id=doc.get("tenant_id", "default"),
                    scope=scope,
                    embedding=doc.get("embedding"),
                )
                self._chunks.append(chunk)
                if chunk.embedding:
                    self._embeddings.append(chunk.embedding)
            except Exception as e:
                logger.warning(f"Skipping invalid chunk {doc.get('chunk_id')}: {e}")

        self._stored_embedding_dim = (
            len(self._embeddings[0]) if self._embeddings else 0
        )
        self._faiss_dirty = True

        logger.info(
            f"Loaded {len(self._chunks)} chunks (dim={self._stored_embedding_dim}) "
            f"from MongoDB into MongoVectorStore"
        )

    def close(self) -> None:
        """Close the MongoDB connection."""
        if self._client:
            self._client.close()
