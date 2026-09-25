"""
WealthGenie RAG Subsystem - Ingestion Pipeline Orchestrator
Executes end-to-end ingestion: Loader -> Cleaning -> Chunking -> Embedding -> Vector Store.
"""

import logging
import math
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, Any, List, Optional

from rag.chunking.base import BaseChunker
from rag.chunking.fixed_chunker import FixedSizeChunker
from rag.embeddings.base import BaseEmbeddingProvider
from rag.embeddings.dense_embedding import get_embedding_provider
from rag.embeddings.identity import normalize_embedding_identity
from rag.ingestion.cleaner import clean_text
from rag.ingestion.loaders import DocumentLoader
from rag.schema import Document, TextChunk
from rag.vector_store.base import BaseVectorStore
from store_factory import get_vector_store

from rag.lifecycle.manager import DocumentLifecycleManager
from rag.corpus_manifest import (
    MANIFEST_FILENAME,
    CorpusManifestError,
    canonical_text_sha256,
    canonical_text_sha256_from_text,
    load_corpus_manifest,
)

logger = logging.getLogger("wealthgenie.rag.ingestion")

ALLOWED_TRUST_TIERS = {
    "government_official",
    "regulatory_circular",
}


@dataclass(frozen=True)
class AdministrativeIngestionOverride:
    """Explicit internal capability for quarantined administrative ingestion."""

    operator_id: str
    reason: str

    def __post_init__(self):
        if not self.operator_id.strip() or len(self.reason.strip()) < 10:
            raise ValueError("Administrative ingestion override requires an operator ID and a substantive reason.")


class UntrustedSourceError(ValueError):
    """Raised when a document source is not from an approved trusted domain/tier."""
    pass


class IngestionPipeline:
    """Orchestrates document loading, text cleaning, chunking, embedding, and vector storage."""

    def __init__(
        self,
        chunker: Optional[BaseChunker] = None,
        embedder: Optional[BaseEmbeddingProvider] = None,
        vector_store: Optional[BaseVectorStore] = None,
        lifecycle_manager: Optional[DocumentLifecycleManager] = None,
    ):
        self.loader = DocumentLoader()
        self.chunker = chunker or FixedSizeChunker(chunk_size=512, chunk_overlap=64)
        self.embedder = embedder or get_embedding_provider()
        self.vector_store = vector_store or get_vector_store()
        self.lifecycle_manager = lifecycle_manager

    def is_source_trusted(self, document: Document) -> bool:
        """Trust global regulatory content only through the verified corpus manifest."""
        if document.metadata.scope not in {"global", "public"}:
            return False
        try:
            corpus_dir = Path(__file__).resolve().parents[1] / "data" / "corpus"
            manifest = load_corpus_manifest(corpus_dir / MANIFEST_FILENAME, corpus_dir)
            custom = document.metadata.custom_metadata
            entry = next(
                item for item in manifest["documents"]
                if item["document_key"] == custom.get("document_key")
            )
            return (
                custom.get("corpus_manifest_sha256") == manifest["manifest_sha256"]
                and custom.get("content_sha256") == entry["content_sha256"]
                and canonical_text_sha256_from_text(document.content) == entry["content_sha256"]
                and document.metadata.source == entry["official_source_url"]
                and document.metadata.publication_date == entry["publication_date"]
                and document.metadata.effective_date == entry["effective_from"]
                and custom.get("effective_to") == entry["effective_to"]
                and document.metadata.author == entry["publishing_authority"]
                and document.metadata.source_trust_tier == entry["trust_tier"]
            )
        except (CorpusManifestError, StopIteration, TypeError):
            return False

    @staticmethod
    def _trusted_tier_for(document: Document) -> str:
        supplied = (document.metadata.source_trust_tier or "").lower()
        return supplied if supplied in ALLOWED_TRUST_TIERS else "government_official"

    def ingest_file(
        self,
        file_path: Path,
        title: Optional[str] = None,
        author: Optional[str] = None,
        effective_date: Optional[str] = None,
        source_trust_tier: Optional[str] = None,
        tenant_id: str = "default",
        user_id: Optional[str] = None,
        scope: Optional[str] = None,
        administrative_override: Optional[AdministrativeIngestionOverride] = None,
    ) -> Dict[str, Any]:
        """Loads and ingests a single document file into the RAG vector store."""
        resolved_scope = scope or (f"user:{user_id}" if user_id else "global")
        document = self.loader.load_file(
            file_path,
            title=title,
            author=author,
            effective_date=effective_date,
            source_trust_tier=source_trust_tier,
            tenant_id=tenant_id,
            scope=resolved_scope,
        )
        if resolved_scope in {"global", "public"}:
            corpus_dir = Path(__file__).resolve().parents[1] / "data" / "corpus"
            manifest = load_corpus_manifest(corpus_dir / MANIFEST_FILENAME, corpus_dir)
            resolved_file = Path(file_path).resolve(strict=True)
            if resolved_file.parent != corpus_dir.resolve(strict=True):
                raise UntrustedSourceError("trusted global corpus files must be direct manifest members")
            entry = next(
                (item for item in manifest["documents"] if item["local_filename"] == Path(file_path).name),
                None,
            )
            if entry is None:
                raise UntrustedSourceError("global corpus file is not listed in the trusted corpus manifest")
            if canonical_text_sha256(resolved_file) != entry["content_sha256"]:
                raise UntrustedSourceError("global corpus file content does not match its manifest hash")
            document.metadata.source = entry["official_source_url"]
            document.metadata.author = entry["publishing_authority"]
            document.metadata.publication_date = entry["publication_date"]
            document.metadata.effective_date = entry["effective_from"]
            document.metadata.source_trust_tier = entry["trust_tier"]
            document.metadata.custom_metadata.update({
                "document_key": entry["document_key"],
                "document_version": entry["document_version"],
                "content_sha256": entry["content_sha256"],
                "effective_to": entry["effective_to"],
                "corpus_manifest_sha256": manifest["manifest_sha256"],
                "supporting_official_sources": entry["supporting_official_sources"],
                "supported_topics": entry["supported_topics"],
                "excluded_topics": entry["excluded_topics"],
                "document_revision": entry["document_version"],
            })
        return self.ingest_document(document, administrative_override=administrative_override)

    def ingest_text(
        self,
        text: str,
        title: str,
        source: str = "direct_input",
        author: Optional[str] = None,
        effective_date: Optional[str] = None,
        source_trust_tier: Optional[str] = None,
        tenant_id: str = "default",
        user_id: Optional[str] = None,
        scope: Optional[str] = None,
        administrative_override: Optional[AdministrativeIngestionOverride] = None,
    ) -> Dict[str, Any]:
        """Ingests raw text directly into the RAG vector store."""
        resolved_scope = scope or (f"user:{user_id}" if user_id else "global")
        document = self.loader.load_text(
            text,
            title=title,
            source=source,
            author=author,
            effective_date=effective_date,
            source_trust_tier=source_trust_tier,
            tenant_id=tenant_id,
            scope=resolved_scope,
        )
        return self.ingest_document(document, administrative_override=administrative_override)

    def ingest_document(
        self,
        document: Document,
        administrative_override: Optional[AdministrativeIngestionOverride] = None,
    ) -> Dict[str, Any]:
        """Cleans, chunks, embeds, and stores a Document object after trust tiering validation."""
        trusted = self.is_source_trusted(document)
        if not trusted and administrative_override is None:
            logger.error(f"Ingestion rejected for untrusted source: '{document.metadata.source}' (tier: '{document.metadata.source_trust_tier}')")
            raise UntrustedSourceError(
                f"Ingestion rejected: document source '{document.metadata.source}' (trust tier: '{document.metadata.source_trust_tier}') "
                f"does not have verified provenance from an approved source."
            )
        if trusted:
            document.metadata.source_trust_tier = self._trusted_tier_for(document)
        else:
            document.metadata.source_trust_tier = "administrative_override_untrusted"
            document.metadata.custom_metadata.update({
                "override_operator_id": administrative_override.operator_id,
                "override_reason": administrative_override.reason,
                "quarantined_from_advisory": True,
            })
            logger.warning(
                "Administratively overridden RAG document quarantined from advisory retrieval: "
                f"operator={administrative_override.operator_id}, source={document.metadata.source}"
            )
        logger.info(f"Ingesting document '{document.metadata.title}' (ID: {document.document_id})...")

        # 1. Clean Content
        document.content = clean_text(document.content)

        # 2. Chunk Document
        chunks: List[TextChunk] = self.chunker.chunk_document(document)

        if not chunks:
            logger.warning(f"Document '{document.metadata.title}' yielded 0 chunks.")
            return {"status": "empty", "chunks_added": 0}

        # 3. Generate Vector Embeddings
        chunk_texts = [c.content for c in chunks]
        embeddings = self.embedder.embed_batch(chunk_texts)
        embedding_identity = normalize_embedding_identity(
            getattr(self.embedder, "embedding_identity", None)
        )
        if len(embeddings) != len(chunks):
            raise RuntimeError("Embedding provider returned a different number of vectors than chunks.")
        dimensions = {len(vector) for vector in embeddings if isinstance(vector, list)}
        if len(dimensions) != 1 or any(
            not isinstance(vector, list)
            or not vector
            or any(not isinstance(value, (int, float)) or not math.isfinite(value) for value in vector)
            or len(vector) != embedding_identity["embedding_dimension"]
            for vector in embeddings
        ):
            raise RuntimeError("Embedding provider returned malformed vectors or vectors inconsistent with its declared identity.")

        for chunk, emb in zip(chunks, embeddings):
            chunk.embedding = emb
            chunk.embedding_identity = embedding_identity
            # A crash between vector persistence and lifecycle registration keeps
            # this generation out of retrieval.
            chunk.lifecycle_state = "PENDING"

        # Mongo production commits lifecycle metadata, all chunks and corpus
        # revision in one transaction. Local disk keeps pending-then-active
        # publication semantics.
        if callable(getattr(self.vector_store, "commit_document_revision", None)):
            added_count = self.vector_store.commit_document_revision(document, chunks)
        else:
            added_count = self.vector_store.add_chunks(chunks)
            lifecycle_mgr = self.lifecycle_manager or DocumentLifecycleManager(vector_store=self.vector_store)
            lifecycle_mgr.register_document(document, len(chunks))

        return {
            "status": "success",
            "document_id": document.document_id,
            "title": document.metadata.title,
            "chunks_created": len(chunks),
            "chunks_added": added_count,
            "vector_dimension": self.embedder.embedding_dimension,
        }
