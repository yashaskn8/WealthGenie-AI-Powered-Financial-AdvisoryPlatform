"""Replica-set integration tests for shared RAG lifecycle transactions.

These tests require a transaction-capable Mongo replica set and run in CI. They
skip locally when ML_TEST_MONGODB_URI is not explicitly configured.
"""

from __future__ import annotations

import hashlib
import os
import uuid

import pytest
from pymongo import MongoClient


MONGODB_URI = os.environ.get("ML_TEST_MONGODB_URI", "").strip()
pytestmark = pytest.mark.skipif(not MONGODB_URI, reason="transaction-capable Mongo replica-set URI is not configured")


def _identity():
    return {
        "embedding_provider": "fixture",
        "embedding_model_id": "fixture-v1",
        "embedding_model_revision": "immutable-test-rev",
        "embedding_dimension": 4,
        "embedding_config_hash": hashlib.sha256(b"fixture-config").hexdigest(),
    }


def _document(document_id: str, content: str):
    from rag.schema import Document, DocumentMetadata

    return Document(
        document_id=document_id,
        content=content,
        metadata=DocumentMetadata(
            title=document_id,
            source="test fixture",
            source_trust_tier="regulatory_circular",
            scope="global",
        ),
    )


def _chunks(document_id: str, content: str, vector=None):
    from rag.schema import ChunkMetadata, TextChunk

    return [TextChunk(
        chunk_id=f"{document_id}#0",
        document_id=document_id,
        content=content,
        metadata=ChunkMetadata(
            title=document_id,
            source="test fixture",
            chunk_id=f"{document_id}#0",
            document_id=document_id,
            chunk_index=0,
            scope="global",
        ),
        scope="global",
        lifecycle_state="PENDING",
        embedding=vector or [1.0, 0.0, 0.0, 0.0],
        embedding_identity=_identity(),
    )]


@pytest.fixture
def mongo_vector_store():
    from model.migrations.phase3_state import migrate_phase3_state
    from rag.vector_store.mongo_vector_store import MongoVectorStore

    db_name = f"wealthgenie_rag_lifecycle_{uuid.uuid4().hex}"
    admin_client = MongoClient(MONGODB_URI, serverSelectionTimeoutMS=5000)
    database = admin_client[db_name]
    migrate_phase3_state(database)
    store = MongoVectorStore(MONGODB_URI, db_name=db_name, force_numpy=True)
    try:
        yield store, db_name
    finally:
        store.close()
        admin_client.drop_database(db_name)
        admin_client.close()


def test_ingestion_soft_delete_and_reingest_are_active_revision_bound(mongo_vector_store):
    from rag.lifecycle.manager import DocumentLifecycleManager

    store, _ = mongo_vector_store
    manager = DocumentLifecycleManager(vector_store=store)
    document_id = "regulatory-doc"
    query = [1.0, 0.0, 0.0, 0.0]

    store.commit_document_revision(_document(document_id, "first revision"), _chunks(document_id, "first revision"))
    first = store.lifecycle_store.list_documents()[0]
    assert first["version_number"] == 1
    assert len(store.search(query, top_k=2, embedding_identity=_identity())) == 1

    assert manager.soft_delete_document(document_id) is True
    assert store.search(query, top_k=2, embedding_identity=_identity()) == []

    store.commit_document_revision(_document(document_id, "second revision"), _chunks(document_id, "second revision"))
    active = store.lifecycle_store.list_documents()
    assert len(active) == 1
    assert active[0]["version_number"] == 2
    results = store.search(query, top_k=2, embedding_identity=_identity())
    assert [result.chunk.content for result in results] == ["second revision"]
    assert results[0].chunk.document_revision_id == active[0]["document_revision_id"]


def test_hard_delete_persists_across_store_restart(mongo_vector_store):
    from rag.lifecycle.manager import DocumentLifecycleManager
    from rag.vector_store.mongo_vector_store import MongoVectorStore

    store, db_name = mongo_vector_store
    document_id = "hard-delete-doc"
    query = [1.0, 0.0, 0.0, 0.0]
    store.commit_document_revision(_document(document_id, "must remain deleted"), _chunks(document_id, "must remain deleted"))
    assert DocumentLifecycleManager(vector_store=store).hard_delete_document(document_id) is True
    store.close()

    restarted = MongoVectorStore(MONGODB_URI, db_name=db_name, force_numpy=True)
    try:
        assert restarted.search(query, top_k=2, embedding_identity=_identity()) == []
        assert restarted.lifecycle_store.list_documents(include_inactive=True) == []
    finally:
        restarted.close()


def test_other_replica_refreshes_after_shared_lifecycle_revision_changes(mongo_vector_store):
    from rag.lifecycle.manager import DocumentLifecycleManager
    from rag.vector_store.mongo_vector_store import MongoVectorStore

    writer, db_name = mongo_vector_store
    reader = MongoVectorStore(MONGODB_URI, db_name=db_name, force_numpy=True)
    document_id = "cross-replica-doc"
    query = [1.0, 0.0, 0.0, 0.0]
    try:
        writer.commit_document_revision(_document(document_id, "active evidence"), _chunks(document_id, "active evidence"))
        assert [item.chunk.content for item in reader.search(query, top_k=2, embedding_identity=_identity())] == ["active evidence"]

        assert DocumentLifecycleManager(vector_store=writer).soft_delete_document(document_id) is True
        assert reader.search(query, top_k=2, embedding_identity=_identity()) == []
    finally:
        reader.close()


def test_active_chunk_identity_corruption_fails_closed(mongo_vector_store):
    store, _ = mongo_vector_store
    document_id = "active-pointer-corruption"
    store.commit_document_revision(_document(document_id, "bound evidence"), _chunks(document_id, "bound evidence"))
    assert store._chunks

    store._collection.update_one(
        {"document_id": document_id},
        {"$set": {"document_id": "different-document"}},
    )
    with pytest.raises(RuntimeError, match="does not match its document revision pointer"):
        store.load()
    assert store._chunks == []
    assert store._embeddings == []


def test_incomplete_active_chunk_set_fails_closed(mongo_vector_store):
    store, _ = mongo_vector_store
    document_id = "active-chunk-set-corruption"
    store.commit_document_revision(_document(document_id, "bound evidence"), _chunks(document_id, "bound evidence"))
    store._collection.delete_one({"document_id": document_id})

    with pytest.raises(RuntimeError, match="chunk set is incomplete"):
        store.load()
    assert store._chunks == []
    assert store._embeddings == []
