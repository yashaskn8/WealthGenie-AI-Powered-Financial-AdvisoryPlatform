"""
WealthGenie RAG Subsystem - MongoDB-backed Vector Store

Stores document chunks and embeddings in MongoDB for cross-replica shared state.
Vector search is performed in-memory using FAISS/NumPy after loading embeddings
from MongoDB — MongoDB 7.0 Community Edition does not support Atlas Vector Search.

Known limitation: Each replica loads the full embedding set into RAM on startup.
For very large corpora this will not scale well memory-wise per replica.
"""

import logging
import math
from typing import Dict, List, Any, Optional
import numpy as np

try:
    import faiss
    FAISS_AVAILABLE = True
except ImportError:
    faiss = None
    FAISS_AVAILABLE = False

from pymongo import MongoClient

from rag.schema import TextChunk, RetrievedChunk, ChunkMetadata, is_scope_accessible
from rag.embeddings.identity import EmbeddingIdentityError, normalize_embedding_identity
from rag.vector_store.base import BaseVectorStore
from model.migrations.phase3_state import verify_phase3_state

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
        self._revision_collection = self._db["rag_state"]
        self._loaded_corpus_revision: Optional[int] = None
        self.force_numpy = force_numpy

        # In-memory search state
        self._chunks: List[TextChunk] = []
        self._embeddings: List[List[float]] = []
        self._stored_embedding_dim: int = 0
        self._stored_embedding_identity: Optional[Dict[str, Any]] = None
        self._faiss_index: Any = None
        self._faiss_dirty: bool = True

        try:
            verify_phase3_state(self._db, vector_collection=collection_name)
        except Exception:
            self._client.close()
            raise
        self.load()

    @property
    def is_using_faiss(self) -> bool:
        return FAISS_AVAILABLE and not self.force_numpy

    def add_chunks(self, chunks: List[TextChunk]) -> int:
        """Adds embedded text chunks to MongoDB, avoiding duplicate chunk_ids."""
        embedded_chunks = [chunk for chunk in chunks if chunk.embedding is not None]
        incoming = [chunk.embedding for chunk in embedded_chunks]
        if any(
            not isinstance(vector, list)
            or not vector
            or any(not isinstance(value, (int, float)) or not math.isfinite(value) for value in vector)
            for vector in incoming
        ):
            raise ValueError("Cannot persist malformed or non-finite embeddings.")
        dimensions = {len(vector) for vector in incoming}
        if len(dimensions) > 1 or (self._stored_embedding_dim and dimensions and dimensions != {self._stored_embedding_dim}):
            raise ValueError("Cannot mix embedding dimensions in a Mongo vector-store generation.")
        identities = [
            normalize_embedding_identity(chunk.embedding_identity)
            for chunk in embedded_chunks
        ]
        if any(identity["embedding_dimension"] != len(chunk.embedding) for identity, chunk in zip(identities, embedded_chunks)):
            raise ValueError("Persisted vector dimension does not match its embedding identity.")
        if identities and any(identity != identities[0] for identity in identities[1:]):
            raise ValueError("Cannot mix embedding identities in a Mongo vector-store generation.")
        incoming_identity = identities[0] if identities else None
        if (
            incoming_identity is not None
            and self._stored_embedding_identity is not None
            and incoming_identity != self._stored_embedding_identity
        ):
            raise ValueError("Cannot write a different embedding identity into the active Mongo vector-store generation.")
        added_count = 0
        for chunk in chunks:
            if chunk.embedding is None:
                continue

            identity = normalize_embedding_identity(chunk.embedding_identity)

            scope = getattr(chunk, "scope", None) or getattr(chunk.metadata, "scope", "global")
            doc = {
                "chunk_id": chunk.chunk_id,
                "document_id": chunk.document_id,
                "content": chunk.content,
                "metadata": chunk.metadata.model_dump(),
                "tenant_id": chunk.tenant_id,
                "scope": scope,
                "lifecycle_state": chunk.lifecycle_state,
                "embedding": chunk.embedding,
                "embedding_identity": identity,
            }

            # Upsert: update if exists, insert if new
            result = self._collection.update_one(
                {"chunk_id": chunk.chunk_id},
                {"$set": doc},
                upsert=True,
            )
            if result.upserted_id is not None:
                added_count += 1

        if incoming:
            self._advance_corpus_revision()
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
        embedding_identity: Optional[Dict[str, Any]] = None,
    ) -> List[RetrievedChunk]:
        """
        Executes tenant/scope-isolated similarity vector search.
        Filters chunks to scope=='global' OR scope=='user:{requesting_user_id}',
        never returning another user's scoped content.
        """
        self._refresh_if_changed()
        if not self._chunks or not self._embeddings:
            return []

        query_identity = normalize_embedding_identity(embedding_identity)
        if query_identity != self._stored_embedding_identity:
            raise ValueError("Query embedding identity does not match the active Mongo vector-store generation.")

        q_vec = np.array(query_vector, dtype=np.float32)
        if q_vec.ndim != 1 or not np.isfinite(q_vec).all():
            raise ValueError("Query embedding must be a finite one-dimensional vector.")
        if len(q_vec) != query_identity["embedding_dimension"]:
            raise ValueError("Query vector dimension does not match its declared embedding identity.")
        q_norm = np.linalg.norm(q_vec)
        if q_norm == 0:
            return []
        q_vec = q_vec / q_norm

        # Scope & Tenant filtering: global content or matching user's private content
        valid_indices = [
            i for i, c in enumerate(self._chunks)
            if c.lifecycle_state == "ACTIVE" and is_scope_accessible(
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
            "embedding_identity": self._stored_embedding_identity,
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

    def get_chunks(self, document_id: Optional[str] = None) -> List[TextChunk]:
        query = {"document_id": document_id} if document_id is not None else {}
        return [self._chunk_from_document(doc) for doc in self._collection.find(query, {"_id": 0})]

    def delete_document(self, document_id: str) -> int:
        result = self._collection.delete_many({"document_id": document_id})
        if result.deleted_count:
            self._advance_corpus_revision()
            self._reload_in_memory()
        return result.deleted_count

    def set_document_state(self, document_id: str, state: str) -> int:
        allowed = {"PENDING", "ACTIVE", "SUPERSEDED", "SOFT_DELETED", "DELETED", "QUARANTINED", "FAILED"}
        if state not in allowed:
            raise ValueError("Unsupported document lifecycle state.")
        result = self._collection.update_many(
            {"document_id": document_id}, {"$set": {"lifecycle_state": state}}
        )
        if result.modified_count:
            self._advance_corpus_revision()
            self._reload_in_memory()
        return result.modified_count

    def update_document_metadata(
        self,
        document_id: str,
        title: Optional[str] = None,
        author: Optional[str] = None,
    ) -> int:
        updates = {}
        if title is not None:
            updates["metadata.title"] = title
        if author is not None:
            updates["metadata.author"] = author
        if not updates:
            return 0
        result = self._collection.update_many({"document_id": document_id}, {"$set": updates})
        if result.modified_count:
            self._advance_corpus_revision()
            self._reload_in_memory()
        return result.modified_count

    def get_corpus_revision(self) -> str:
        record = self._revision_collection.find_one({"_id": "active_corpus"}) or {}
        return str(record.get("revision", 0))

    def _advance_corpus_revision(self) -> None:
        self._revision_collection.update_one(
            {"_id": "active_corpus"}, {"$inc": {"revision": 1}}, upsert=True
        )

    def _refresh_if_changed(self) -> None:
        current = int(self.get_corpus_revision())
        if self._loaded_corpus_revision != current:
            self._reload_in_memory()

    @staticmethod
    def _chunk_from_document(doc: Dict[str, Any]) -> TextChunk:
        embedding = doc.get("embedding")
        if not isinstance(embedding, list) or not embedding:
            raise ValueError(f"Chunk {doc.get('chunk_id')} has no valid embedding.")
        if any(not isinstance(value, (int, float)) or not math.isfinite(value) for value in embedding):
            raise ValueError(f"Chunk {doc.get('chunk_id')} has non-finite embedding values.")
        try:
            embedding_identity = normalize_embedding_identity(doc.get("embedding_identity"))
        except EmbeddingIdentityError as exc:
            raise ValueError(f"Chunk {doc.get('chunk_id')} has missing or invalid embedding identity.") from exc
        if len(embedding) != embedding_identity["embedding_dimension"]:
            raise ValueError(f"Chunk {doc.get('chunk_id')} embedding dimension does not match its identity.")
        metadata = dict(doc.get("metadata", {}))
        scope = doc.get("scope", metadata.get("scope", "global"))
        metadata["scope"] = scope
        return TextChunk(
            chunk_id=doc["chunk_id"],
            document_id=doc["document_id"],
            content=doc["content"],
            metadata=ChunkMetadata(**metadata),
            tenant_id=doc.get("tenant_id", "default"),
            scope=scope,
            lifecycle_state=doc.get("lifecycle_state", "QUARANTINED"),
            embedding=embedding,
            embedding_identity=embedding_identity,
        )

    def _reload_in_memory(self) -> None:
        """Pull all chunks from MongoDB into in-memory arrays for search."""
        # Clear the old generation first: corruption must never leave a stale
        # index available after a failed reload.
        self._chunks = []
        self._embeddings = []
        self._stored_embedding_dim = 0
        self._stored_embedding_identity = None
        self._faiss_index = None
        self._faiss_dirty = True
        revision_before = int(self.get_corpus_revision())
        cursor = self._collection.find({"lifecycle_state": "ACTIVE"}, {"_id": 0})
        chunks: List[TextChunk] = []
        embeddings: List[List[float]] = []
        expected_dimension: Optional[int] = None
        expected_identity: Optional[Dict[str, Any]] = None
        for doc in cursor:
            chunk = self._chunk_from_document(doc)
            embedding = chunk.embedding
            if embedding is None:
                raise ValueError(f"Chunk {chunk.chunk_id} has no embedding.")
            if expected_dimension is None:
                expected_dimension = len(embedding)
            elif len(embedding) != expected_dimension:
                raise ValueError("Mongo vector store contains mixed embedding dimensions.")
            if expected_identity is None:
                expected_identity = chunk.embedding_identity
            elif chunk.embedding_identity != expected_identity:
                raise ValueError("Mongo vector store contains mixed embedding identities.")
            chunks.append(chunk)
            embeddings.append(embedding)

        # Publish only a fully validated generation: chunk/vector positions stay aligned.
        self._chunks = chunks
        self._embeddings = embeddings
        self._stored_embedding_dim = expected_dimension or 0
        self._stored_embedding_identity = expected_identity
        self._loaded_corpus_revision = int(self.get_corpus_revision())
        if self._loaded_corpus_revision != revision_before:
            self._loaded_corpus_revision = None
            raise RuntimeError("RAG corpus changed during vector index reload; retry required.")
        self._faiss_dirty = True

        logger.info(
            f"Loaded {len(self._chunks)} chunks (dim={self._stored_embedding_dim}) "
            f"from MongoDB into MongoVectorStore"
        )

    def close(self) -> None:
        """Close the MongoDB connection."""
        if self._client:
            self._client.close()
