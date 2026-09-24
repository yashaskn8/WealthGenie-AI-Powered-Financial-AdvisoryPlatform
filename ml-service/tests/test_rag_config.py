"""
WealthGenie RAG Subsystem - Configuration Test Suite
Tests default config instantiation, overlap validation, environment variable overrides, and JSON loading.
"""

import json
import os
import pytest
from pydantic import ValidationError
from rag.config import RAGConfig


def test_default_rag_config():
    config = RAGConfig()
    assert config.chunk_size == 512
    assert config.chunk_overlap == 64
    assert config.top_k == 4
    assert config.retrieval_strategy == "hybrid"
    assert config.reranker_strategy == "no_op"


def test_invalid_chunk_overlap_validation():
    with pytest.raises(ValidationError) as exc_info:
        RAGConfig(chunk_size=100, chunk_overlap=120)
    assert "chunk_overlap" in str(exc_info.value)


def test_unknown_rag_strategies_and_invalid_weighted_fusion_fail_configuration():
    with pytest.raises(ValidationError):
        RAGConfig(retrieval_strategy="unknown")
    with pytest.raises(ValidationError):
        RAGConfig(embedding_provider="unknown")
    with pytest.raises(ValidationError):
        RAGConfig(reranker_strategy="unknown")
    with pytest.raises(ValidationError, match="sum to 1.0"):
        RAGConfig(fusion_mode="weighted", dense_weight=0.8, keyword_weight=0.8)


def test_from_env_overrides():
    os.environ["RAG_CHUNK_SIZE"] = "1024"
    os.environ["RAG_TOP_K"] = "8"
    os.environ["RAG_SIMILARITY_THRESHOLD"] = "0.25"
    os.environ["RAG_RERANKER_STRATEGY"] = "relevance_score"

    try:
        config = RAGConfig.from_env()
        assert config.chunk_size == 1024
        assert config.top_k == 8
        assert config.similarity_threshold == 0.25
        assert config.reranker_strategy == "relevance_score"
    finally:
        os.environ.pop("RAG_CHUNK_SIZE", None)
        os.environ.pop("RAG_TOP_K", None)
        os.environ.pop("RAG_SIMILARITY_THRESHOLD", None)
        os.environ.pop("RAG_RERANKER_STRATEGY", None)


def test_from_json_and_to_dict(tmp_path):
    json_file = tmp_path / "custom_config.json"
    custom_data = {
        "chunk_size": 256,
        "chunk_overlap": 32,
        "top_k": 5,
        "retrieval_strategy": "dense",
    }
    json_file.write_text(json.dumps(custom_data), encoding="utf-8")

    loaded_config = RAGConfig.from_json(json_file)
    assert loaded_config.chunk_size == 256
    assert loaded_config.chunk_overlap == 32
    assert loaded_config.top_k == 5
    assert loaded_config.retrieval_strategy == "dense"

    export_dict = loaded_config.to_dict()
    assert export_dict["chunk_size"] == 256
    assert "vector_store_path" in export_dict
