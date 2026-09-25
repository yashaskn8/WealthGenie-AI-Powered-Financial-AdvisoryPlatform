"""Replica-set integration tests for shared RAG lifecycle transactions.

These tests require a transaction-capable Mongo replica set and run in CI. They
skip locally when ML_TEST_MONGODB_URI is not explicitly configured.
"""

from __future__ import annotations

import hashlib
import os
import threading
import uuid
from concurrent.futures import ThreadPoolExecutor

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
    from rag.lifecycle.mongo_store import MongoRAGLifecycleStore
    from rag.vector_store.mongo_vector_store import MongoVectorStore

    db_name = f"wealthgenie_rag_lifecycle_{uuid.uuid4().hex}"
    admin_client = MongoClient(MONGODB_URI, serverSelectionTimeoutMS=5000)
    database = admin_client[db_name]
    migrate_phase3_state(database)
    MongoRAGLifecycleStore(admin_client, database).initialize_corpus_generation(_identity())
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


def test_generation_manifest_is_immutable_and_binds_exact_active_membership(mongo_vector_store):
    store, _ = mongo_vector_store
    lifecycle = store.lifecycle_store
    store.commit_document_revision(_document("generation-bound", "first evidence"), _chunks("generation-bound", "first evidence"))
    first_pointer = store._db["rag_corpus_state"].find_one({"_id": "active_corpus"})
    first_generation = store._db["rag_corpus_generations"].find_one({"generation_id": first_pointer["generation_id"]})
    first_member = store._db["rag_corpus_generation_members"].find_one(
        {"generation_id": first_pointer["generation_id"], "document_id": "generation-bound"}
    )
    assert first_generation["manifest_sha256"]
    assert first_generation["embedding_identity"] == _identity()
    assert first_generation["membership_sha256"]
    assert first_member["chunk_count"] == 1

    lifecycle.soft_delete_document("generation-bound")
    second_pointer = store._db["rag_corpus_state"].find_one({"_id": "active_corpus"})
    assert second_pointer["revision"] == first_pointer["revision"] + 1
    assert second_pointer["generation_id"] != first_pointer["generation_id"]
    assert store._db["rag_corpus_generations"].find_one(
        {"generation_id": first_pointer["generation_id"]}
    ) == first_generation
    assert store._db["rag_corpus_generation_members"].find_one(
        {"generation_id": first_pointer["generation_id"], "document_id": "generation-bound"}
    ) == first_member
    assert store._db["rag_corpus_generation_members"].count_documents(
        {"generation_id": second_pointer["generation_id"]}
    ) == 0


def test_competing_corpus_mutations_commit_one_monotonic_generation(mongo_vector_store):
    store, _ = mongo_vector_store
    lifecycle = store.lifecycle_store
    original = store._db["rag_corpus_state"].find_one({"_id": "active_corpus"})
    barrier = threading.Barrier(2)
    lifecycle._before_generation_record_insert = lambda _generation_id: barrier.wait(timeout=30)

    def ingest(name):
        return store.commit_document_revision(_document(name, f"evidence for {name}"), _chunks(name, f"evidence for {name}"))

    try:
        with ThreadPoolExecutor(max_workers=2) as pool:
            futures = [pool.submit(ingest, "race-a"), pool.submit(ingest, "race-b")]
            results = []
            for future in futures:
                try:
                    results.append(("committed", future.result(timeout=45)))
                except Exception as exc:  # one transaction must lose the generation CAS/index race
                    results.append(("rejected", exc))
        assert sum(state == "committed" for state, _ in results) == 1
        assert sum(state == "rejected" for state, _ in results) == 1
        pointer = store._db["rag_corpus_state"].find_one({"_id": "active_corpus"})
        assert pointer["revision"] == original["revision"] + 1
        assert store._db["rag_corpus_generations"].count_documents({"revision": pointer["revision"]}) == 1
        active_revisions = list(store._db["rag_document_revisions"].find({"lifecycle_state": "ACTIVE"}))
        assert len(active_revisions) == 1
        assert len(store.search([1.0, 0.0, 0.0, 0.0], embedding_identity=_identity())) == 1
    finally:
        lifecycle._before_generation_record_insert = None


def test_tampered_generation_membership_rejects_reload_and_clears_old_index(mongo_vector_store):
    store, _ = mongo_vector_store
    store.commit_document_revision(_document("tampered-generation", "bound evidence"), _chunks("tampered-generation", "bound evidence"))
    pointer = store._db["rag_corpus_state"].find_one({"_id": "active_corpus"})
    assert store._chunks
    store._db["rag_corpus_generation_members"].update_one(
        {"generation_id": pointer["generation_id"]},
        {"$set": {"chunk_set_sha256": "0" * 64}},
    )
    with pytest.raises(RuntimeError, match="member digest"):
        store.load()
    assert store._chunks == []
    assert store._embeddings == []
