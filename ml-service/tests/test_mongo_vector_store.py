"""
Integration tests for MongoVectorStore using mongomock.

Verifies that the MongoDB-backed vector store correctly implements the
BaseVectorStore interface and that state written by one instance is
readable from a second instance (cross-replica proof).
"""

import pytest
import numpy as np
from unittest.mock import patch

import mongomock

TEST_MONGO_URI = "mongodb://localhost:27017"
TEST_DB_NAME = "wealthgenie_test_vectorstore"
TEST_COLLECTION = "test_vector_chunks"


def _make_chunk(chunk_id, doc_id, content, embedding, tenant_id="default", scope="global"):
    from rag.schema import TextChunk, ChunkMetadata
    metadata = ChunkMetadata(
        title="Test Doc",
        source="test_source",
        chunk_id=chunk_id,
        document_id=doc_id,
        chunk_index=0,
        tenant_id=tenant_id,
        scope=scope,
    )
    return TextChunk(
        chunk_id=chunk_id,
        document_id=doc_id,
        content=content,
        metadata=metadata,
        tenant_id=tenant_id,
        scope=scope,
        embedding=embedding,
    )


def _random_embedding(dim=384):
    vec = np.random.randn(dim).astype(np.float32)
    vec = vec / np.linalg.norm(vec)
    return vec.tolist()


@pytest.fixture
def mock_mongo_client():
    """Provides a shared in-memory MongoClient mock across vector store instances."""
    client = mongomock.MongoClient(TEST_MONGO_URI)
    yield client
    client.close()


@pytest.fixture
def store(mock_mongo_client):
    from rag.vector_store.mongo_vector_store import MongoVectorStore
    with patch("rag.vector_store.mongo_vector_store.MongoClient", return_value=mock_mongo_client):
        s = MongoVectorStore(
            mongo_uri=TEST_MONGO_URI,
            db_name=TEST_DB_NAME,
            collection_name=TEST_COLLECTION,
            force_numpy=True,
        )
        yield s
        s.close()


class TestMongoVectorStore:

    def test_add_chunks_and_stats(self, store):
        chunks = [
            _make_chunk("c1", "doc1", "Income tax deduction under 80C", _random_embedding()),
            _make_chunk("c2", "doc1", "NPS contribution benefits under 80CCD", _random_embedding()),
            _make_chunk("c3", "doc2", "SEBI mutual fund categorization", _random_embedding()),
        ]
        added = store.add_chunks(chunks)
        assert added == 3

        stats = store.get_stats()
        assert stats["total_chunks"] == 3
        assert stats["unique_documents"] == 2
        assert stats["backend"] == "mongodb"
        assert stats["embedding_dimension"] == 384

    def test_add_duplicate_chunk_is_upserted(self, store):
        emb = _random_embedding()
        c1 = _make_chunk("dup1", "doc1", "Original content", emb)
        added1 = store.add_chunks([c1])
        assert added1 == 1

        c1_updated = _make_chunk("dup1", "doc1", "Updated content", emb)
        added2 = store.add_chunks([c1_updated])
        assert added2 == 0

        stats = store.get_stats()
        assert stats["total_chunks"] == 1

    def test_search_returns_relevant_results(self, store):
        target_emb = _random_embedding(384)
        similar_emb = target_emb.copy()
        noise_emb = _random_embedding(384)

        chunks = [
            _make_chunk("relevant", "doc1", "Relevant document about taxes", similar_emb),
            _make_chunk("noise", "doc2", "Irrelevant noise document", noise_emb),
        ]
        store.add_chunks(chunks)

        results = store.search(query_vector=target_emb, top_k=2, threshold=0.0)
        assert len(results) > 0
        assert results[0].chunk.chunk_id == "relevant"
        assert results[0].score >= 0.99

    def test_tenant_isolation(self, store):
        emb = _random_embedding()
        chunks = [
            _make_chunk("t1c1", "doc1", "Tenant 1 data", emb, tenant_id="tenant_1"),
            _make_chunk("t2c1", "doc2", "Tenant 2 data", emb, tenant_id="tenant_2"),
        ]
        store.add_chunks(chunks)

        results = store.search(query_vector=emb, top_k=5, tenant_id="tenant_1")
        assert len(results) == 1
        assert results[0].chunk.tenant_id == "tenant_1"

        results = store.search(query_vector=emb, top_k=5, tenant_id="tenant_2")
        assert len(results) == 1
        assert results[0].chunk.tenant_id == "tenant_2"

    def test_scope_and_user_isolation(self, store):
        emb = _random_embedding()
        chunks = [
            _make_chunk("glob1", "gdoc", "Public tax rules Section 80C", emb, tenant_id="default", scope="global"),
            _make_chunk("u1c1", "udoc1", "User 123 confidential bank statement", emb, tenant_id="user_123", scope="user:user_123"),
            _make_chunk("u2c1", "udoc2", "User 456 confidential salary slip", emb, tenant_id="user_456", scope="user:user_456"),
        ]
        store.add_chunks(chunks)

        # 1. User 123 searches -> Should retrieve public doc + user 123 doc, NEVER user 456 doc
        res_u1 = store.search(query_vector=emb, top_k=5, user_id="user_123")
        retrieved_ids_u1 = {r.chunk.chunk_id for r in res_u1}
        assert "glob1" in retrieved_ids_u1
        assert "u1c1" in retrieved_ids_u1
        assert "u2c1" not in retrieved_ids_u1, "User 123 leaked User 456 private chunk!"

        # 2. User 456 searches -> Should retrieve public doc + user 456 doc, NEVER user 123 doc
        res_u2 = store.search(query_vector=emb, top_k=5, user_id="user_456")
        retrieved_ids_u2 = {r.chunk.chunk_id for r in res_u2}
        assert "glob1" in retrieved_ids_u2
        assert "u2c1" in retrieved_ids_u2
        assert "u1c1" not in retrieved_ids_u2, "User 456 leaked User 123 private chunk!"

        # 3. Unauthenticated/anonymous search -> Should retrieve public doc only
        res_anon = store.search(query_vector=emb, top_k=5, user_id=None)
        retrieved_ids_anon = {r.chunk.chunk_id for r in res_anon}
        assert "glob1" in retrieved_ids_anon
        assert "u1c1" not in retrieved_ids_anon
        assert "u2c1" not in retrieved_ids_anon

    def test_save_is_noop(self, store):
        store.save()

    def test_cross_replica_read(self, store, mock_mongo_client):
        """
        CROSS-REPLICA PROOF: Write chunks with one instance,
        read back with a separate instance sharing the same MongoDB connection.
        """
        target_emb = _random_embedding()
        chunks = [
            _make_chunk("cross1", "crossdoc", "Cross-replica test chunk", target_emb),
        ]
        store.add_chunks(chunks)

        from rag.vector_store.mongo_vector_store import MongoVectorStore
        with patch("rag.vector_store.mongo_vector_store.MongoClient", return_value=mock_mongo_client):
            replica2 = MongoVectorStore(
                mongo_uri=TEST_MONGO_URI,
                db_name=TEST_DB_NAME,
                collection_name=TEST_COLLECTION,
                force_numpy=True,
            )

        stats = replica2.get_stats()
        assert stats["total_chunks"] == 1

        results = replica2.search(query_vector=target_emb, top_k=1)
        assert len(results) == 1
        assert results[0].chunk.chunk_id == "cross1"
        assert results[0].score >= 0.99

        replica2.close()

    def test_get_stats_empty_store(self, store):
        stats = store.get_stats()
        assert stats["total_chunks"] == 0
        assert stats["unique_documents"] == 0
        assert stats["embedding_dimension"] == 0

    def test_search_empty_store_returns_empty(self, store):
        results = store.search(query_vector=_random_embedding(), top_k=5)
        assert results == []
