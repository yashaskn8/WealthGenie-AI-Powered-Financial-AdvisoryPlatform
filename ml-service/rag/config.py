"""
WealthGenie RAG Subsystem - Hardened Central Configuration
Defines hyperparameters for chunking, vector embeddings, storage paths, and retrieval bounds with environment variable and JSON file loading support.
"""

import json
import os
from pathlib import Path
from typing import Dict, Any, Literal
from pydantic import BaseModel, ConfigDict, Field, model_validator
from model.config import BASE_DIR

RAG_DIR = BASE_DIR / "rag"
STORAGE_DIR = BASE_DIR / "reports" / "rag_store"
STORAGE_DIR.mkdir(parents=True, exist_ok=True)


class RAGConfig(BaseModel):
    """Centralized configuration for Retrieval-Augmented Generation pipeline."""
    model_config = ConfigDict(extra="forbid")

    chunk_size: int = Field(512, ge=64, le=4096, description="Default chunk size in characters")
    chunk_overlap: int = Field(64, ge=0, le=512, description="Overlap between consecutive chunks")
    embedding_dim: int = Field(384, description="Dense embedding vector dimension")
    embedding_provider: Literal["sentence_transformer", "tf_idf_dense"] = Field("sentence_transformer", description="Embedding provider")
    top_k: int = Field(4, ge=1, le=20, description="Top-k chunks to retrieve")
    similarity_threshold: float = Field(0.1, ge=0.0, le=1.0, description="Minimum cosine similarity score")
    retrieval_strategy: Literal["dense", "keyword", "hybrid"] = Field("hybrid", description="Retrieval strategy")
    fusion_mode: Literal["rrf", "weighted"] = Field("rrf", description="Fusion strategy")
    dense_weight: float = Field(0.6, ge=0.0, le=1.0, description="Dense vector weight in weighted fusion")
    keyword_weight: float = Field(0.4, ge=0.0, le=1.0, description="Keyword BM25 weight in weighted fusion")
    reranker_strategy: Literal["no_op", "relevance_score", "cross_encoder"] = Field("no_op", description="Reranker strategy")
    vector_store_path: Path = Field(STORAGE_DIR / "vector_index.json", description="Persisted vector store index path")
    cache_path: Path = Field(STORAGE_DIR / "embedding_cache.json", description="Persisted embedding cache path")
    document_registry_path: Path = Field(STORAGE_DIR / "documents.json", description="Document metadata store path")

    @model_validator(mode="after")
    def validate_overlap_less_than_size(self) -> "RAGConfig":
        """Ensures chunk overlap is strictly smaller than chunk size."""
        if self.chunk_overlap >= self.chunk_size:
            raise ValueError(f"chunk_overlap ({self.chunk_overlap}) must be strictly less than chunk_size ({self.chunk_size}).")
        if self.fusion_mode == "weighted" and abs(self.dense_weight + self.keyword_weight - 1.0) > 1e-9:
            raise ValueError("dense_weight and keyword_weight must sum to 1.0 for weighted fusion.")
        return self

    @classmethod
    def from_env(cls) -> "RAGConfig":
        """Loads configuration with environment variable overrides (prefixed with RAG_)."""
        overrides: Dict[str, Any] = {}
        if "RAG_CHUNK_SIZE" in os.environ:
            overrides["chunk_size"] = int(os.environ["RAG_CHUNK_SIZE"])
        if "RAG_CHUNK_OVERLAP" in os.environ:
            overrides["chunk_overlap"] = int(os.environ["RAG_CHUNK_OVERLAP"])
        if "RAG_EMBEDDING_DIM" in os.environ:
            overrides["embedding_dim"] = int(os.environ["RAG_EMBEDDING_DIM"])
        if "RAG_EMBEDDING_PROVIDER" in os.environ:
            overrides["embedding_provider"] = os.environ["RAG_EMBEDDING_PROVIDER"]
        if "RAG_TOP_K" in os.environ:
            overrides["top_k"] = int(os.environ["RAG_TOP_K"])
        if "RAG_SIMILARITY_THRESHOLD" in os.environ:
            overrides["similarity_threshold"] = float(os.environ["RAG_SIMILARITY_THRESHOLD"])
        if "RAG_RETRIEVAL_STRATEGY" in os.environ:
            overrides["retrieval_strategy"] = os.environ["RAG_RETRIEVAL_STRATEGY"]
        if "RAG_FUSION_MODE" in os.environ:
            overrides["fusion_mode"] = os.environ["RAG_FUSION_MODE"]
        if "RAG_RERANKER_STRATEGY" in os.environ:
            overrides["reranker_strategy"] = os.environ["RAG_RERANKER_STRATEGY"]
        if "RAG_VECTOR_STORE_PATH" in os.environ:
            overrides["vector_store_path"] = Path(os.environ["RAG_VECTOR_STORE_PATH"])
        return cls(**overrides)

    @classmethod
    def from_json(cls, json_path: Path) -> "RAGConfig":
        """Loads configuration from a JSON configuration file."""
        if not json_path.exists():
            raise FileNotFoundError(f"Configuration file '{json_path}' does not exist.")
        with open(json_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        if "vector_store_path" in data:
            data["vector_store_path"] = Path(data["vector_store_path"])
        if "cache_path" in data:
            data["cache_path"] = Path(data["cache_path"])
        if "document_registry_path" in data:
            data["document_registry_path"] = Path(data["document_registry_path"])
        return cls(**data)

    def to_dict(self) -> Dict[str, Any]:
        """Exports configuration as serializable dictionary."""
        d = self.model_dump()
        d["vector_store_path"] = str(self.vector_store_path)
        d["cache_path"] = str(self.cache_path)
        d["document_registry_path"] = str(self.document_registry_path)
        return d
