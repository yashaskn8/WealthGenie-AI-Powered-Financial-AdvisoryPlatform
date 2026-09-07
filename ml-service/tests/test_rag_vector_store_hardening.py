"""
WealthGenie RAG Subsystem - Vector Store Hardening Test Suite
Tests atomic writes, SHA256 checksums, backup snapshots, and corruption recovery.
"""

import json
from rag.schema import TextChunk, ChunkMetadata
from rag.vector_store.memory_vector_store import PersistentVectorStore


def test_atomic_write_and_checksum(tmp_path):
    index_file = tmp_path / "hardened_index.json"
    store = PersistentVectorStore(index_path=index_file)

    meta = ChunkMetadata(
        chunk_id="c1",
        document_id="d1",
        chunk_index=0,
        title="Tax Guide",
        source="tax.md",
    )
    chunk = TextChunk(chunk_id="c1", document_id="d1", content="Tax text content", metadata=meta, embedding=[1.0, 0.0])

    store.add_chunks([chunk])

    assert index_file.exists()
    with open(index_file, "r", encoding="utf-8") as f:
        data = json.load(f)

    assert data["version"] == "2.1"
    assert "sha256" in data
    assert len(data["chunks"]) == 1


def test_backup_snapshot_creation(tmp_path):
    index_file = tmp_path / "hardened_index.json"
    store = PersistentVectorStore(index_path=index_file)

    meta = ChunkMetadata(chunk_id="c1", document_id="d1", chunk_index=0, title="T1", source="s1.md")
    chunk1 = TextChunk(chunk_id="c1", document_id="d1", content="Initial content", metadata=meta, embedding=[1.0, 0.0])
    store.add_chunks([chunk1])

    # Second save triggers backup creation
    chunk2 = TextChunk(chunk_id="c2", document_id="d2", content="New content", metadata=meta, embedding=[0.0, 1.0])
    store.add_chunks([chunk2])

    assert store.backup_path.exists()


def test_corruption_detection_and_backup_recovery(tmp_path):
    index_file = tmp_path / "hardened_index.json"
    store = PersistentVectorStore(index_path=index_file)

    meta = ChunkMetadata(chunk_id="c1", document_id="d1", chunk_index=0, title="T1", source="s1.md")
    chunk = TextChunk(chunk_id="c1", document_id="d1", content="Valid content", metadata=meta, embedding=[1.0, 0.0])
    store.add_chunks([chunk])
    store.add_chunks([chunk])  # Triggers backup creation

    # Corrupt primary index file
    with open(index_file, "w", encoding="utf-8") as f:
        f.write("{ INVALID CORRUPTED JSON ///")

    # Load should catch corruption and recover from backup snapshot
    recovered_store = PersistentVectorStore(index_path=index_file)
    assert len(recovered_store._chunks) > 0
    assert recovered_store._chunks[0].chunk_id == "c1"
