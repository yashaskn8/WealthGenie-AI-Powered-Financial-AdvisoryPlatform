"""
WealthGenie RAG Subsystem - Ingestion Pipeline Orchestrator
Executes end-to-end ingestion: Loader -> Cleaning -> Chunking -> Embedding -> Vector Store.
"""

import logging
import math
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, Any, List, Optional
from urllib.parse import urlparse

from rag.chunking.base import BaseChunker
from rag.chunking.fixed_chunker import FixedSizeChunker
from rag.embeddings.base import BaseEmbeddingProvider
from rag.embeddings.dense_embedding import get_embedding_provider
from rag.ingestion.cleaner import clean_text
from rag.ingestion.loaders import DocumentLoader
from rag.schema import Document, TextChunk
from rag.vector_store.base import BaseVectorStore
from store_factory import get_vector_store

from rag.lifecycle.manager import DocumentLifecycleManager

logger = logging.getLogger("wealthgenie.rag.ingestion")

ALLOWED_TRUSTED_DOMAINS = [
    "sebi.gov.in",
    "incometaxindia.gov.in",
    "pib.gov.in",
    "rbi.org.in",
    "dicgc.org.in",
]

ALLOWED_TRUSTED_FILES = [
    "income_tax_act_fy2025_26",
    "income_tax_deductions_master_reference",
    "sebi_mutual_fund_categorization_and_riskometer",
    "rbi_and_dicgc_guidelines",
]

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
        """Validate source provenance without trusting caller-controlled titles or tiers."""
        source = (document.metadata.source or "").lower()
        parsed = urlparse(source)
        hostname = (parsed.hostname or "").lower()
        source_stem = Path(parsed.path or source).stem.lower()

        if source_stem in ALLOWED_TRUSTED_FILES:
            return True

        if any(hostname == domain or hostname.endswith(f".{domain}") for domain in ALLOWED_TRUSTED_DOMAINS):
            return True

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
        if len(embeddings) != len(chunks):
            raise RuntimeError("Embedding provider returned a different number of vectors than chunks.")
        dimensions = {len(vector) for vector in embeddings if isinstance(vector, list)}
        if len(dimensions) != 1 or any(
            not isinstance(vector, list)
            or not vector
            or any(not isinstance(value, (int, float)) or not math.isfinite(value) for value in vector)
            for vector in embeddings
        ):
            raise RuntimeError("Embedding provider returned malformed or inconsistent vectors.")

        for chunk, emb in zip(chunks, embeddings):
            chunk.embedding = emb
            # A crash between vector persistence and lifecycle registration keeps
            # this generation out of retrieval.
            chunk.lifecycle_state = "PENDING"

        # 4. Store Chunks in Vector Store
        added_count = self.vector_store.add_chunks(chunks)

        # 5. Register Document Metadata in DocumentLifecycleManager
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
