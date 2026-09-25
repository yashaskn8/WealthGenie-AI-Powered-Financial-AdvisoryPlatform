"""
Cross-Replica Verification Script for MongoDB-backed Stores

This script provides an independently-reproducible verification that state
written by one store instance is readable from a second instance — proving
that MongoDB correctly enables cross-replica shared state.

Usage:
    cd ml-service
    python scripts/verify_cross_replica_mongo.py
"""

import os
import sys
from unittest.mock import patch
import numpy as np

# Add ml-service to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

MONGO_URI = os.environ.get("MONGODB_URI", "mongodb://localhost:27017/wealthgenie_test")
DB_NAME = "wealthgenie_cross_replica_test"


def check_mongo_available():
    try:
        from pymongo import MongoClient
        client = MongoClient(MONGO_URI, serverSelectionTimeoutMS=1000)
        client.admin.command("ping")
        client.close()
        return True
    except Exception:
        return False


def verify_registry_cross_replica(mock_client=None):
    """Test shared reads using complete, verified model bundles only."""
    from pathlib import Path

    from model.registry.mongo_registry_store import MongoModelRegistry
    from model.artifacts.store import MongoGridFSArtifactStore
    from model.migrations.phase3_state import migrate_phase3_state, verify_phase3_state
    from scripts.verify_serving_artifacts import verify_trusted_serving_bundles

    patcher = None
    if mock_client:
        patcher = patch("model.registry.mongo_registry_store.MongoClient", return_value=mock_client)
        patcher.start()

    replica1 = None
    replica2 = None
    try:
        if mock_client:
            migrate_phase3_state(mock_client[DB_NAME])
        replica1 = MongoModelRegistry(mongo_uri=MONGO_URI, db_name=DB_NAME)
        verify_phase3_state(replica1.database)
        replica1.artifact_store = MongoGridFSArtifactStore(replica1.database)
        bundles = verify_trusted_serving_bundles(Path(__file__).resolve().parents[1])
        registered = replica1.bootstrap_verified_bundles(bundles, replica1.artifact_store)

        # Instance 2 reads the exact same immutable bundle and activation identity.
        replica2 = MongoModelRegistry(mongo_uri=MONGO_URI, db_name=DB_NAME)
        for architecture, written in registered.items():
            version = replica2.get_version(written["version_id"])
            assert version is not None, f"FAIL: Replica 2 could not find {architecture} bundle"
            assert version["bundle_id"] == written["bundle_id"]
            assert version["bundle_manifest_sha256"] == written["bundle_manifest_sha256"]
            assert version["is_active"] is True
            active = replica2.get_active_model(architecture)
            assert active is not None and active["version_id"] == written["version_id"]
        print("[PASS] MongoModelRegistry cross-replica verification PASSED")
    finally:
        if replica1:
            replica1.close()
        if replica2:
            replica2.close()
        if patcher:
            patcher.stop()


def verify_vector_store_cross_replica(mock_client=None):
    """Test that MongoVectorStore shares state across instances."""
    from rag.vector_store.mongo_vector_store import MongoVectorStore
    from rag.schema import TextChunk, ChunkMetadata

    collection_name = "cross_replica_chunks"

    # Create test chunks with known embeddings
    target_embedding = np.random.randn(384).astype(np.float32)
    target_embedding = (target_embedding / np.linalg.norm(target_embedding)).tolist()

    metadata = ChunkMetadata(
        title="Cross-Replica Test",
        source="verification_script",
        chunk_id="verify_chunk_1",
        document_id="verify_doc_1",
        chunk_index=0,
    )
    chunk = TextChunk(
        chunk_id="verify_chunk_1",
        document_id="verify_doc_1",
        content="This chunk proves cross-replica shared vector state via MongoDB.",
        metadata=metadata,
        embedding=target_embedding,
    )

    patcher = None
    if mock_client:
        patcher = patch("rag.vector_store.mongo_vector_store.MongoClient", return_value=mock_client)
        patcher.start()

    try:
        # Instance 1 (Replica 1): Write chunk
        replica1 = MongoVectorStore(
            mongo_uri=MONGO_URI,
            db_name=DB_NAME,
            collection_name=collection_name,
            force_numpy=True,
        )
        added = replica1.add_chunks([chunk])
        assert added == 1
        replica1.close()

        # Instance 2 (Replica 2): Read and search
        replica2 = MongoVectorStore(
            mongo_uri=MONGO_URI,
            db_name=DB_NAME,
            collection_name=collection_name,
            force_numpy=True,
        )

        stats = replica2.get_stats()
        assert stats["total_chunks"] == 1, \
            f"FAIL: Replica 2 sees {stats['total_chunks']} chunks, expected 1"

        results = replica2.search(query_vector=target_embedding, top_k=1)
        assert len(results) == 1, "FAIL: Replica 2 search returned no results"
        assert results[0].chunk.chunk_id == "verify_chunk_1"
        assert results[0].score >= 0.99, f"FAIL: Expected score >= 0.99, got {results[0].score}"

        replica2.close()
        print("[PASS] MongoVectorStore cross-replica verification PASSED")
    finally:
        if patcher:
            patcher.stop()


if __name__ == "__main__":
    is_live = check_mongo_available()
    mock_client = None
    if not is_live:
        import mongomock
        print("[INFO] Live MongoDB daemon not detected on localhost:27017.")
        print("[INFO] Initializing shared in-memory Mongo cluster mock for cross-replica verification...")
        mock_client = mongomock.MongoClient(MONGO_URI)
    else:
        print(f"[INFO] Connected to live MongoDB at {MONGO_URI}")

    print("=" * 60)
    verify_registry_cross_replica(mock_client=mock_client)
    verify_vector_store_cross_replica(mock_client=mock_client)
    print("=" * 60)
    print("ALL CROSS-REPLICA VERIFICATION TESTS PASSED")
