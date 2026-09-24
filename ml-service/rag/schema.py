"""
WealthGenie RAG Subsystem - Data Models & Schemas
Defines Pydantic data contracts for documents, chunks, queries, citations, and metrics.
"""

from datetime import datetime, timezone
from typing import Dict, Any, List, Optional, Literal
from pydantic import BaseModel, ConfigDict, Field


def is_scope_accessible(
    chunk_scope: Optional[str],
    chunk_tenant_id: Optional[str] = None,
    requesting_scope: Optional[str] = None,
    requesting_user_id: Optional[str] = None,
    tenant_id: Optional[str] = None,
) -> bool:
    """
    Evaluates whether a chunk with `chunk_scope` / `chunk_tenant_id` is accessible
    to the requesting query context.

    Rules:
    1. A chunk with scope "global", "default", "*", or "public" (AND tenant_id in ("default", "global", None))
       is accessible to all queries.
    2. A chunk with tenant_id != "default" or user scope "user:{user_id}" is accessible ONLY IF:
       - requesting_user_id == user_id / tenant_id, OR
       - requesting_scope matches, OR
       - tenant_id == chunk_tenant_id
    3. Never returns another user/tenant's scoped content.
    """
    c_scope = (chunk_scope or "global").strip().lower()
    c_tenant = (chunk_tenant_id or "default").strip().lower()

    # If chunk is explicitly scoped to a non-default tenant
    if c_tenant not in ("default", "global", "") and c_scope in ("global", "default", ""):
        c_scope = c_tenant

    if c_scope in ("global", "default", "*", "public", "") and c_tenant in ("default", "global", ""):
        return True

    allowed_scopes = set()
    if requesting_user_id:
        uid = str(requesting_user_id).strip().lower()
        allowed_scopes.add(uid)
        allowed_scopes.add(f"user:{uid}")

    if requesting_scope:
        s = str(requesting_scope).strip().lower()
        allowed_scopes.add(s)
        if s.startswith("user:"):
            allowed_scopes.add(s[5:])
        else:
            allowed_scopes.add(f"user:{s}")

    if tenant_id and str(tenant_id).strip().lower() not in ("default", "global", ""):
        t = str(tenant_id).strip().lower()
        allowed_scopes.add(t)
        if t.startswith("user:"):
            allowed_scopes.add(t[5:])
        else:
            allowed_scopes.add(f"user:{t}")

    return c_scope in allowed_scopes or c_tenant in allowed_scopes


class DocumentMetadata(BaseModel):
    """Metadata retained for every ingested document."""
    title: str = Field(..., description="Document title")
    source: str = Field(..., description="File path, URL, or authoritative source name")
    publication_date: str = Field(default_factory=lambda: datetime.now(timezone.utc).strftime("%Y-%m-%d"), description="Publication date (YYYY-MM-DD)")
    document_type: str = Field("markdown", description="pdf, markdown, text, html, or csv")
    version: str = Field("1.0", description="Document schema version")
    author: Optional[str] = Field(None, description="Authoring authority (e.g. Income Tax Dept, AMFI)")
    effective_date: str = Field(default_factory=lambda: datetime.now(timezone.utc).strftime("%Y-%m-%d"), description="Effective date of regulations (YYYY-MM-DD)")
    source_trust_tier: str = Field(
        "unverified_user_input",
        description="Evidence provenance tier; direct input is unverified unless independently authorized and verified.",
    )
    tenant_id: str = Field("default", description="Tenant isolation scope identifier")
    scope: str = Field("global", description="Tenant isolation scope: 'global' for public corpus or 'user:{user_id}' for user-specific documents")
    custom_metadata: Dict[str, Any] = Field(default_factory=dict)


class Document(BaseModel):
    """Raw loaded document representation."""
    document_id: str = Field(..., description="Unique SHA256 or UUID document identifier")
    content: str = Field(..., description="Full text content of document")
    metadata: DocumentMetadata


class ChunkMetadata(DocumentMetadata):
    """Metadata retained for individual document text chunks."""
    chunk_id: str = Field(..., description="Unique chunk identifier document_id#idx")
    document_id: str = Field(..., description="Parent document identifier")
    chunk_index: int = Field(..., description="Ordinal index of chunk within parent document")
    page_number: Optional[int] = Field(None, description="Page number if applicable")
    token_count: int = Field(0, description="Character or token length of chunk")


class TextChunk(BaseModel):
    """Granular chunk used for vector embedding and retrieval."""
    chunk_id: str
    document_id: str
    content: str
    metadata: ChunkMetadata
    tenant_id: str = Field("default", description="Tenant isolation scope identifier")
    scope: str = Field("global", description="Tenant isolation scope: 'global' or 'user:{user_id}'")
    lifecycle_state: Literal["PENDING", "ACTIVE", "SUPERSEDED", "SOFT_DELETED", "DELETED", "QUARANTINED", "FAILED"] = "ACTIVE"
    embedding: Optional[List[float]] = None


class RetrievedChunk(BaseModel):
    """Chunk retrieved during vector search along with score and rank."""
    chunk: TextChunk
    score: float = Field(..., description="Cosine similarity score [0.0, 1.0]")
    rank: int = Field(..., description="Retrieval rank position (1-based)")


class Citation(BaseModel):
    """Structured reference citation attached to generated advisory responses."""
    citation_id: int = Field(..., description="Numerical reference index [1], [2], ...")
    document_title: str
    source: str
    chunk_id: str
    excerpt: str = Field(..., description="Relevant supporting text excerpt")
    relevance_score: float


class RAGQueryRequest(BaseModel):
    """Request payload for RAG query execution."""
    model_config = ConfigDict(extra="forbid")

    question: str = Field(..., min_length=3, description="User advisory question")
    top_k: Optional[int] = Field(None, ge=1, le=20, description="Override default top-k retrieval count")
    tenant_id: str = Field("default", description="Tenant isolation scope identifier")
    user_id: Optional[str] = Field(None, description="Requesting user ID for scoped retrieval")
    scope: Optional[str] = Field(None, description="Explicit retrieval scope (e.g. 'global' or 'user:{user_id}')")
    user_profile: Optional[Dict[str, Any]] = Field(default_factory=dict, description="Contextual investor profile")
    include_citations: bool = Field(True, description="Whether to format inline citations")


class RAGQueryResponse(BaseModel):
    """Extractive retrieval or explicit abstention returned by the RAG pipeline."""
    answer: str = Field(..., description="Extractive evidence response or explicit abstention")
    citations: List[Citation] = Field(default_factory=list)
    retrieved_chunks: List[RetrievedChunk] = Field(default_factory=list)
    metrics: Dict[str, Any] = Field(default_factory=dict, description="Retrieval and response-construction diagnostics")
    grounded: bool = Field(False, description="True only when trustworthy, sufficiently relevant evidence was returned")
