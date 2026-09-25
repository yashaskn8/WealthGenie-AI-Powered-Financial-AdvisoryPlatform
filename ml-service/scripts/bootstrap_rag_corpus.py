"""Explicitly initialize and seed the shared Mongo RAG corpus before serving."""

from __future__ import annotations

import os
import sys
from datetime import date
from pathlib import Path

from pymongo import MongoClient

ML_SERVICE_ROOT = Path(__file__).resolve().parents[1]
if str(ML_SERVICE_ROOT) not in sys.path:
    sys.path.insert(0, str(ML_SERVICE_ROOT))

from model.migrations.phase3_state import verify_phase3_state
from mongo_database import resolve_mongo_database_name
from rag.config import RAGConfig
from rag.corpus_manifest import MANIFEST_FILENAME, current_documents, load_corpus_manifest
from rag.chunking.fixed_chunker import FixedSizeChunker
from rag.embeddings.dense_embedding import get_embedding_provider
from rag.embeddings.identity import normalize_embedding_identity
from rag.ingestion.pipeline import IngestionPipeline
from rag.lifecycle.mongo_store import MongoRAGLifecycleStore
from rag.seed_knowledge import CORPUS_DIR, seed_default_knowledge_base
from rag.vector_store.mongo_vector_store import MongoVectorStore


def bootstrap() -> dict[str, object]:
    if os.environ.get("WEALTHGENIE_RAG_BOOTSTRAP", "").strip().lower() not in {"1", "true", "yes"}:
        raise RuntimeError("set WEALTHGENIE_RAG_BOOTSTRAP=1 for this explicit release operation")
    uri = os.environ.get("MONGODB_URI", "").strip()
    if not uri:
        raise RuntimeError("MONGODB_URI is required for shared RAG corpus bootstrap")
    if os.environ.get("ML_STATE_BACKEND", "").strip().lower() != "mongodb":
        raise RuntimeError("RAG corpus bootstrap requires ML_STATE_BACKEND=mongodb")

    manifest = load_corpus_manifest(CORPUS_DIR / MANIFEST_FILENAME, CORPUS_DIR)
    config = RAGConfig.from_env()
    embedding_provider = get_embedding_provider(config)
    ready = getattr(embedding_provider, "is_ready", True)
    if callable(ready):
        ready = ready()
    identity = normalize_embedding_identity(getattr(embedding_provider, "embedding_identity", None))
    environment = os.environ.get("ENVIRONMENT", "local").strip().lower()
    if environment in {"production", "prod"} and (
        not ready or identity["embedding_provider"] != "sentence_transformers"
    ):
        raise RuntimeError("production corpus bootstrap requires the pinned semantic embedding model")

    client = MongoClient(uri, serverSelectionTimeoutMS=10000)
    try:
        client.admin.command("ping")
        database_name = resolve_mongo_database_name(uri)
        database = client[database_name]
        verify_phase3_state(database)
        MongoRAGLifecycleStore(client, database).initialize_corpus_generation(identity)
    finally:
        client.close()

    store = MongoVectorStore(uri, db_name=database_name)
    try:
        pipeline = IngestionPipeline(
            chunker=FixedSizeChunker(chunk_size=config.chunk_size, chunk_overlap=config.chunk_overlap),
            embedder=embedding_provider,
            vector_store=store,
        )
        seed_default_knowledge_base(pipeline=pipeline)
        generation = store.get_active_generation()
        if not generation or generation.get("manifest_sha256") != manifest["manifest_sha256"]:
            raise RuntimeError("active RAG generation does not match the checked-in corpus manifest")
        if generation.get("embedding_identity") != identity:
            raise RuntimeError("active RAG generation does not match the bootstrap embedding identity")
        if store._loaded_generation_id != generation.get("generation_id"):
            raise RuntimeError("loaded vector index does not match the active RAG corpus generation")
        if store._loaded_corpus_revision != generation.get("revision"):
            raise RuntimeError("loaded vector index revision does not match the active RAG corpus generation")
        expected = current_documents(manifest, as_of=date.today())
        active_keys = {
            chunk.metadata.custom_metadata.get("document_key")
            for chunk in store.get_chunks()
            if chunk.lifecycle_state == "ACTIVE"
            and chunk.metadata.custom_metadata.get("corpus_manifest_sha256") == manifest["manifest_sha256"]
        }
        expected_keys = {entry["document_key"] for entry in expected}
        if not expected_keys or active_keys != expected_keys:
            raise RuntimeError("active trusted global documents do not exactly match the checked-in corpus manifest")
        if store.lifecycle_store.reconcile().get("status") != "CLEAN":
            raise RuntimeError("shared RAG lifecycle reconciliation is not clean")
        return {
            "status": "READY",
            "generation_id": generation["generation_id"],
            "revision": generation["revision"],
            "manifest_sha256": generation["manifest_sha256"],
            "membership_sha256": generation["membership_sha256"],
            "document_count": generation["document_count"],
            "chunk_count": generation["chunk_count"],
            "embedding_identity": identity,
            "mongo_database": database_name,
            "loaded_generation_id": store._loaded_generation_id,
        }
    finally:
        store.close()


def main() -> int:
    try:
        result = bootstrap()
    except Exception as exc:
        print(f"RAG corpus bootstrap failed ({type(exc).__name__}): {exc}", file=sys.stderr)
        return 1
    print("RAG corpus bootstrap verified:", result)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
