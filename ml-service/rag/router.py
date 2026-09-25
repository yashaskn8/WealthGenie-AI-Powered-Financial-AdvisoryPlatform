"""
WealthGenie RAG Subsystem - Hardened FastAPI Router
Exposes enterprise RAG endpoints with rate-limiting, error handling, security headers, and document lifecycle control.
"""

import logging
import os
import threading
import time
from datetime import date
from pathlib import Path
from typing import Dict, List, Optional
from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from rag.config import RAGConfig
from rag.corpus_manifest import MANIFEST_FILENAME, CorpusManifestError, current_documents, load_corpus_manifest
from rag.embeddings.identity import EmbeddingIdentityError, normalize_embedding_identity
from rag.ingestion.pipeline import IngestionPipeline, UntrustedSourceError
from rag.lifecycle.manager import DocumentLifecycleManager
from rag.retrieval.pipeline import RAGPipeline
from rag.schema import RAGQueryRequest, RAGQueryResponse
from security import verify_api_key, verify_verified_user_id
from store_factory import get_vector_store

logger = logging.getLogger("wealthgenie.rag.router")

rag_router = APIRouter(prefix="/rag", tags=["Retrieval-Augmented Generation"], dependencies=[Depends(verify_api_key)])

# Instantiate RAG Subsystem instances with shared singleton lifecycle_manager
rag_config = RAGConfig()
vector_store = get_vector_store()
lifecycle_manager = DocumentLifecycleManager(vector_store=vector_store)
ingestion_pipeline = IngestionPipeline(
    vector_store=vector_store,
    lifecycle_manager=lifecycle_manager,
)
query_pipeline = RAGPipeline(
    embedder=ingestion_pipeline.embedder,
    vector_store=vector_store,
    config=rag_config,
)

# In-memory simple rate limiting: IP -> List of request timestamps
_RATE_LIMIT_STORE: Dict[str, List[float]] = {}
_RATE_LIMIT_LOCK = threading.Lock()
MAX_REQUESTS_PER_MINUTE = 60


def check_rate_limit(client_ip: str) -> None:
    """Enforces simple sliding window rate limiting (60 requests/minute)."""
    now = time.monotonic()
    with _RATE_LIMIT_LOCK:
        timestamps = _RATE_LIMIT_STORE.get(client_ip, [])
        # Filter timestamps within last 60s. monotonic() is immune to wall-clock changes.
        recent = [t for t in timestamps if now - t < 60.0]

        if len(recent) >= MAX_REQUESTS_PER_MINUTE:
            logger.warning(f"Rate limit exceeded for IP: {client_ip}")
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Rate limit exceeded. Maximum 60 requests per minute allowed.",
            )

        recent.append(now)
        _RATE_LIMIT_STORE[client_ip] = recent





class IngestTextRequest(BaseModel):
    title: str = Field(..., description="Document title")
    content: str = Field(..., min_length=10, description="Raw text content to ingest")
    source: str = Field("api_input", description="Source identifier")
    author: Optional[str] = Field("Financial Authority", description="Author")
    tenant_id: Optional[str] = Field(None, description="Deprecated/Ignored - Tenant scope derived from verified header")
    scope: Optional[str] = Field(None, description="Deprecated/Ignored - Scope derived from verified header")
    user_id: Optional[str] = Field(None, description="Deprecated/Ignored - User ID derived from verified header")


@rag_router.get("/health")
def rag_health():
    """Health check for RAG subsystem."""
    stats = ingestion_pipeline.vector_store.get_stats()
    return {
        "status": "ok",
        "service": "WealthGenie RAG Platform",
        "chunks_indexed": stats["total_chunks"],
        "documents_indexed": stats["unique_documents"],
    }


def rag_readiness_snapshot() -> dict:
    """Report only checks the current process can actually establish."""
    checks = {
        "corpus_manifest": False,
        "current_documents": False,
        "active_corpus_chunks": False,
        "embedding_provider": False,
        "vector_embedding_identity": False,
        "corpus_generation": False,
        "generation_manifest_current": False,
        "lifecycle_reconciliation": False,
        "shared_production_state": True,
    }
    manifest_hash = None
    active_generation_id = None
    loaded_generation_id = None
    corpus_revision = None
    try:
        corpus_dir = Path(__file__).resolve().parent / "data" / "corpus"
        manifest = load_corpus_manifest(corpus_dir / MANIFEST_FILENAME, corpus_dir)
        manifest_hash = manifest["manifest_sha256"]
        entries = current_documents(manifest, as_of=date.today())
        checks["corpus_manifest"] = True
        checks["current_documents"] = bool(entries)
        expected_keys = {entry["document_key"] for entry in entries}
        active_keys = {
            chunk.metadata.custom_metadata.get("document_key")
            for chunk in ingestion_pipeline.vector_store.get_chunks()
            if chunk.lifecycle_state == "ACTIVE"
            and chunk.metadata.custom_metadata.get("corpus_manifest_sha256") == manifest_hash
            and chunk.metadata.source_trust_tier == "government_official"
        }
        checks["active_corpus_chunks"] = bool(expected_keys) and expected_keys.issubset(active_keys)
        store = ingestion_pipeline.vector_store
        get_snapshot = getattr(store, "get_generation_snapshot", None)
        get_active = getattr(store, "get_active_generation", None)
        if callable(get_snapshot) and callable(get_active):
            snapshot = get_snapshot()
            generation = get_active()
            active_generation_id = generation.get("generation_id") if generation else None
            loaded_generation_id = getattr(store, "get_loaded_generation_id", lambda: None)()
            corpus_revision = snapshot.get("revision")
            checks["corpus_generation"] = bool(
                generation
                and snapshot.get("generation_id") == generation.get("generation_id")
                and loaded_generation_id == generation.get("generation_id")
            )
            checks["generation_manifest_current"] = bool(
                generation and generation.get("manifest_sha256") == manifest_hash
            )
            lifecycle_store = getattr(store, "lifecycle_store", None)
            reconcile = getattr(lifecycle_store, "reconcile", None)
            checks["lifecycle_reconciliation"] = bool(
                callable(reconcile) and reconcile().get("status") == "CLEAN"
            )
        elif os.environ.get("ENVIRONMENT", "local").strip().lower() in {"production", "prod"}:
            checks["corpus_generation"] = False
            checks["generation_manifest_current"] = False
            checks["lifecycle_reconciliation"] = False
        else:
            # Local memory/file stores do not use the Mongo generation pointer.
            checks["corpus_generation"] = True
            checks["generation_manifest_current"] = True
            checks["lifecycle_reconciliation"] = True
    except Exception:
        checks["corpus_manifest"] = False

    identity = getattr(ingestion_pipeline.embedder, "embedding_identity", {})
    is_ready = getattr(ingestion_pipeline.embedder, "is_ready", True)
    if callable(is_ready):
        is_ready = is_ready()
    checks["embedding_provider"] = bool(
        is_ready
        and identity.get("provider") not in {None, "unavailable"}
        and identity.get("model_id")
        and identity.get("model_revision")
        and identity.get("dimension") == ingestion_pipeline.embedder.embedding_dimension
        and identity.get("config_hash")
    )
    try:
        vector_identity = normalize_embedding_identity(
            ingestion_pipeline.vector_store.get_stats().get("embedding_identity")
        )
        checks["vector_embedding_identity"] = (
            vector_identity == normalize_embedding_identity(identity)
        )
    except (EmbeddingIdentityError, TypeError, ValueError):
        checks["vector_embedding_identity"] = False

    environment = os.environ.get("ENVIRONMENT", "local").strip().lower()
    if environment in {"production", "prod"}:
        vector_is_shared = type(ingestion_pipeline.vector_store).__name__ == "MongoVectorStore"
        lifecycle_is_shared = bool(getattr(lifecycle_manager, "is_shared", False))
        checks["shared_production_state"] = vector_is_shared and lifecycle_is_shared
        checks["embedding_provider"] = checks["embedding_provider"] and identity.get("provider") == "sentence_transformers"

    ready = all(checks.values())
    return {
        "status": "READY" if ready else "NOT_READY",
        "manifest_sha256": manifest_hash,
        "active_generation_id": active_generation_id,
        "loaded_generation_id": loaded_generation_id,
        "corpus_revision": corpus_revision,
        "embedding_identity": identity,
        "checks": checks,
    }


@rag_router.get("/readyz")
def rag_readyz():
    snapshot = rag_readiness_snapshot()
    return JSONResponse(status_code=200 if snapshot["status"] == "READY" else 503, content=snapshot)


@rag_router.get("/status")
def rag_status():
    """Returns vector store index metrics and embedding parameters."""
    stats = ingestion_pipeline.vector_store.get_stats()
    return {
        "vector_store_stats": stats,
        "embedding_provider": rag_config.embedding_provider,
        "embedding_dimension": rag_config.embedding_dim,
        "chunk_size": rag_config.chunk_size,
        "chunk_overlap": rag_config.chunk_overlap,
        "retrieval_strategy": rag_config.retrieval_strategy,
        "reranker_strategy": rag_config.reranker_strategy,
    }


@rag_router.post("/query", response_model=RAGQueryResponse)
def query_rag(
    request: RAGQueryRequest,
    req: Request,
    verified_user_id: str = Depends(verify_verified_user_id),
):
    """
    Executes grounded RAG query search over authoritative knowledge base.
    Scoped strictly to the verified_user_id extracted from X-Verified-User-Id header.
    Any user_id or tenant_id provided in the request body is strictly ignored.
    """
    client_ip = req.client.host if req.client else "127.0.0.1"
    check_rate_limit(client_ip)

    # SECURITY: Overwrite any client-supplied identity with verified header identity
    request.user_id = verified_user_id
    request.scope = f"user:{verified_user_id}"
    request.tenant_id = "default"

    try:
        return query_pipeline.query(request)
    except Exception as e:
        logger.error(f"RAG query execution failed: {e}")
        raise HTTPException(status_code=500, detail=f"RAG query error: {str(e)}")


@rag_router.post("/index")
def index_document(
    request: IngestTextRequest,
    req: Request,
    verified_user_id: str = Depends(verify_verified_user_id),
):
    """
    Ingests text document into vector store index incrementally.
    Scoped strictly to the verified_user_id extracted from X-Verified-User-Id header.
    Any user_id or tenant_id provided in the request body is strictly ignored.
    """
    client_ip = req.client.host if req.client else "127.0.0.1"
    check_rate_limit(client_ip)

    try:
        # Direct user content is deliberately unverified. Claimed source/author fields
        # cannot elevate it into the authoritative regulatory corpus.
        res = ingestion_pipeline.ingest_text(
            text=request.content,
            title=request.title,
            source=f"user_supplied:{verified_user_id}",
            author=None,
            source_trust_tier="unverified_user_input",
            tenant_id="default",
            user_id=verified_user_id,
            scope=f"user:{verified_user_id}",
        )
        # Sync the router's lifecycle_manager with disk state written by the pipeline's
        # ephemeral DocumentLifecycleManager during ingest_document().
        lifecycle_manager.load_registry()
        return {"status": "success", "ingestion_result": res}
    except UntrustedSourceError as e:
        logger.warning(f"Rejected untrusted direct RAG ingestion: {e}")
        raise HTTPException(status_code=400, detail="Direct user content is not accepted as authoritative advisory evidence.")
    except Exception as e:
        logger.error(f"Document ingestion failed: {e}")
        raise HTTPException(status_code=400, detail=f"Ingestion error: {str(e)}")


@rag_router.get("/documents")
def list_documents(
    include_inactive: bool = False,
    verified_user_id: str = Depends(verify_verified_user_id),
):
    """Lists registered documents accessible to the verified user (global + user:{verified_user_id})."""
    return {"documents": lifecycle_manager.list_documents(
        include_inactive=include_inactive,
        requesting_user_id=verified_user_id,
    )}


@rag_router.delete("/documents/{doc_id}")
def delete_document(
    doc_id: str,
    hard_delete: bool = True,
    verified_user_id: str = Depends(verify_verified_user_id),
):
    """Deletes or soft-deletes a document and purges vector index chunks with caller ownership enforcement."""
    try:
        if hard_delete:
            success = lifecycle_manager.hard_delete_document(doc_id, requesting_user_id=verified_user_id)
        else:
            success = lifecycle_manager.soft_delete_document(doc_id, requesting_user_id=verified_user_id)

        if not success:
            raise HTTPException(status_code=404, detail=f"Document '{doc_id}' not found.")
        return {"status": "success", "message": f"Document '{doc_id}' deleted successfully."}
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))


@rag_router.put("/documents/{doc_id}")
def update_document(
    doc_id: str,
    title: Optional[str] = None,
    author: Optional[str] = None,
    verified_user_id: str = Depends(verify_verified_user_id),
):
    """Updates metadata across document registry and vector store chunks with caller ownership enforcement."""
    try:
        success = lifecycle_manager.update_metadata(
            doc_id,
            new_title=title,
            new_author=author,
            requesting_user_id=verified_user_id,
        )
        if not success:
            raise HTTPException(status_code=404, detail=f"Document '{doc_id}' not found.")
        return {"status": "success", "message": f"Metadata updated for document '{doc_id}'."}
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))


@rag_router.get("/reconcile")
def reconcile_documents(
    verified_user_id: str = Depends(verify_verified_user_id),
):
    """Reconciles document registry entries against vector store chunks within verified user's scope."""
    return lifecycle_manager.reconcile_registry_and_vector_store(
        requesting_user_id=verified_user_id
    )
