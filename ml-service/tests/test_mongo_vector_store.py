"""
Integration tests for MongoVectorStore using mongomock.

Verifies that the MongoDB-backed vector store correctly implements the
BaseVectorStore interface and that state written by one instance is
readable from a second instance (cross-replica proof).
"""

import pytest
import numpy as np
import hashlib
from unittest.mock import patch

import mongomock

TEST_MONGO_URI = "mongodb://localhost:27017"
TEST_DB_NAME = "wealthgenie_test_vectorstore"
TEST_COLLECTION = "test_vector_chunks"
TEST_EMBEDDING_IDENTITY = {
    "embedding_provider": "test-provider",
    "embedding_model_id": "test-model",
    "embedding_model_revision": "test-revision-a",
    "embedding_dimension": 384,
    "embedding_config_hash": hashlib.sha256(b"test-embedding-config").hexdigest(),
}


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
        embedding_identity={
            **TEST_EMBEDDING_IDENTITY,
            "embedding_dimension": len(embedding),
        },
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
    from model.migrations.phase3_state import migrate_phase3_state
    migrate_phase3_state(mock_mongo_client[TEST_DB_NAME], vector_collection=TEST_COLLECTION)
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

    def test_constructor_fails_closed_without_explicit_migration(self):
        from model.migrations.phase3_state import Phase3MigrationError
        from rag.vector_store.mongo_vector_store import MongoVectorStore

        client = mongomock.MongoClient(TEST_MONGO_URI)
        try:
            with patch("rag.vector_store.mongo_vector_store.MongoClient", return_value=client):
                with pytest.raises(Phase3MigrationError, match="migration is missing"):
                    MongoVectorStore(
                        mongo_uri=TEST_MONGO_URI,
                        db_name=TEST_DB_NAME + "_unmigrated",
                        collection_name=TEST_COLLECTION,
                        force_numpy=True,
                    )
            assert "chunk_id_1" not in client[TEST_DB_NAME + "_unmigrated"][TEST_COLLECTION].index_information()
        finally:
            client.close()

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

        results = store.search(query_vector=target_emb, top_k=2, threshold=0.0, embedding_identity=TEST_EMBEDDING_IDENTITY)
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

        results = store.search(query_vector=emb, top_k=5, tenant_id="tenant_1", embedding_identity=TEST_EMBEDDING_IDENTITY)
        assert len(results) == 1
        assert results[0].chunk.tenant_id == "tenant_1"

        results = store.search(query_vector=emb, top_k=5, tenant_id="tenant_2", embedding_identity=TEST_EMBEDDING_IDENTITY)
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
        res_u1 = store.search(query_vector=emb, top_k=5, user_id="user_123", embedding_identity=TEST_EMBEDDING_IDENTITY)
        retrieved_ids_u1 = {r.chunk.chunk_id for r in res_u1}
        assert "glob1" in retrieved_ids_u1
        assert "u1c1" in retrieved_ids_u1
        assert "u2c1" not in retrieved_ids_u1, "User 123 leaked User 456 private chunk!"

        # 2. User 456 searches -> Should retrieve public doc + user 456 doc, NEVER user 123 doc
        res_u2 = store.search(query_vector=emb, top_k=5, user_id="user_456", embedding_identity=TEST_EMBEDDING_IDENTITY)
        retrieved_ids_u2 = {r.chunk.chunk_id for r in res_u2}
        assert "glob1" in retrieved_ids_u2
        assert "u2c1" in retrieved_ids_u2
        assert "u1c1" not in retrieved_ids_u2, "User 456 leaked User 123 private chunk!"

        # 3. Unauthenticated/anonymous search -> Should retrieve public doc only
        res_anon = store.search(query_vector=emb, top_k=5, user_id=None, embedding_identity=TEST_EMBEDDING_IDENTITY)
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

        results = replica2.search(query_vector=target_emb, top_k=1, embedding_identity=TEST_EMBEDDING_IDENTITY)
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
        results = store.search(query_vector=_random_embedding(), top_k=5, embedding_identity=TEST_EMBEDDING_IDENTITY)
        assert results == []

    def test_non_active_chunks_are_excluded_after_restart(self, store, mock_mongo_client):
        embedding = _random_embedding()
        store.add_chunks([_make_chunk("life-c1", "life-doc", "Lifecycle test", embedding)])
        assert len(store.search(embedding, top_k=1, embedding_identity=TEST_EMBEDDING_IDENTITY)) == 1

        assert store.set_document_state("life-doc", "SOFT_DELETED") == 1
        from rag.vector_store.mongo_vector_store import MongoVectorStore
        with patch("rag.vector_store.mongo_vector_store.MongoClient", return_value=mock_mongo_client):
            restarted = MongoVectorStore(
                mongo_uri=TEST_MONGO_URI,
                db_name=TEST_DB_NAME,
                collection_name=TEST_COLLECTION,
                force_numpy=True,
            )
        assert restarted.search(embedding, top_k=1, embedding_identity=TEST_EMBEDDING_IDENTITY) == []

        assert restarted.delete_document("life-doc") == 1
        with patch("rag.vector_store.mongo_vector_store.MongoClient", return_value=mock_mongo_client):
            after_delete = MongoVectorStore(
                mongo_uri=TEST_MONGO_URI,
                db_name=TEST_DB_NAME,
                collection_name=TEST_COLLECTION,
                force_numpy=True,
            )
        assert after_delete.search(embedding, top_k=1, embedding_identity=TEST_EMBEDDING_IDENTITY) == []
        assert after_delete.get_stats()["total_chunks"] == 0
        restarted.close()
        after_delete.close()

    def test_replica_refreshes_when_shared_corpus_revision_changes(self, store, mock_mongo_client):
        first_vector = [1.0] + [0.0] * 383
        second_vector = [0.0, 1.0] + [0.0] * 382
        store.add_chunks([_make_chunk("replica-c1", "replica-d1", "first", first_vector)])

        from rag.vector_store.mongo_vector_store import MongoVectorStore
        with patch("rag.vector_store.mongo_vector_store.MongoClient", return_value=mock_mongo_client):
            replica = MongoVectorStore(
                mongo_uri=TEST_MONGO_URI,
                db_name=TEST_DB_NAME,
                collection_name=TEST_COLLECTION,
                force_numpy=True,
            )
        store.add_chunks([_make_chunk("replica-c2", "replica-d2", "second", second_vector)])
        results = replica.search(second_vector, top_k=2, embedding_identity=TEST_EMBEDDING_IDENTITY)
        assert any(item.chunk.chunk_id == "replica-c2" for item in results)
        replica.close()

    def test_malformed_active_vectors_fail_closed_without_index_misalignment(self, store):
        valid = _make_chunk("valid-c1", "valid-d1", "valid", [1.0, 0.0])
        store.add_chunks([valid])
        bad = _make_chunk("bad-c1", "bad-d1", "bad", [1.0, 0.0, 0.0])
        store._collection.insert_one({
            "chunk_id": bad.chunk_id,
            "document_id": bad.document_id,
            "content": bad.content,
            "metadata": bad.metadata.model_dump(),
            "tenant_id": bad.tenant_id,
            "scope": bad.scope,
            "lifecycle_state": "ACTIVE",
            "embedding": bad.embedding,
            "embedding_identity": {
                **TEST_EMBEDDING_IDENTITY,
                "embedding_dimension": len(bad.embedding),
            },
        })

        with pytest.raises(ValueError, match="mixed embedding dimensions"):
            store.load()
        assert store._chunks == []
        assert store._embeddings == []

    def test_same_dimension_different_embedding_model_is_rejected(self, store):
        vector = _random_embedding()
        store.add_chunks([_make_chunk("space-c1", "space-d1", "embedding space", vector)])
        incompatible_identity = dict(TEST_EMBEDDING_IDENTITY)
        incompatible_identity["embedding_model_revision"] = "test-revision-b"

        with pytest.raises(ValueError, match="does not match the active Mongo vector-store generation"):
            store.search(vector, top_k=1, embedding_identity=incompatible_identity)

        incompatible_chunk = _make_chunk("space-c2", "space-d2", "other space", vector)
        incompatible_chunk.embedding_identity = incompatible_identity
        with pytest.raises(ValueError, match="different embedding identity"):
            store.add_chunks([incompatible_chunk])

    def test_active_legacy_chunk_without_identity_fails_closed(self, store):
        store._collection.insert_one({
            "chunk_id": "legacy-c1",
            "document_id": "legacy-d1",
            "content": "legacy vector without model identity",
            "metadata": {
                "title": "Legacy",
                "source": "legacy",
                "chunk_id": "legacy-c1",
                "document_id": "legacy-d1",
                "chunk_index": 0,
            },
            "lifecycle_state": "ACTIVE",
            "embedding": [1.0, 0.0],
        })

        with pytest.raises(ValueError, match="missing or invalid embedding identity"):
            store.load()
        assert store._chunks == []
        assert store._embeddings == []

    def test_same_dimension_mixed_active_generations_fail_closed_on_reload(self, store):
        vector = _random_embedding()
        store.add_chunks([_make_chunk("generation-a", "doc-a", "generation A", vector)])
        other_identity = dict(TEST_EMBEDDING_IDENTITY)
        other_identity["embedding_model_id"] = "different-model-same-dimension"
        store._collection.insert_one({
            "chunk_id": "generation-b",
            "document_id": "doc-b",
            "content": "generation B",
            "metadata": _make_chunk("generation-b", "doc-b", "generation B", vector).metadata.model_dump(),
            "tenant_id": "default",
            "scope": "global",
            "lifecycle_state": "ACTIVE",
            "embedding": vector,
            "embedding_identity": other_identity,
        })

        with pytest.raises(ValueError, match="mixed embedding identities"):
            store.load()
        assert store._chunks == []
        assert store._embeddings == []
