"""
WealthGenie Open-Weight LLM Platform - RAG Compatibility Adapter
Compatibility wrapper for the trust-gated extractive RAG pipeline.
"""

from typing import TYPE_CHECKING, Optional

from rag.retrieval.pipeline import RAGPipeline
from rag.schema import RAGQueryRequest, RAGQueryResponse

if TYPE_CHECKING:
    from llm.registry import LLMModelRegistry

class RAGLLMPipeline:
    """Retains the existing interface while RAG synthesis is safety-deferred."""

    def __init__(
        self,
        rag_pipeline: Optional[RAGPipeline] = None,
        model_registry: Optional["LLMModelRegistry"] = None,
    ):
        self.rag_pipeline = rag_pipeline or RAGPipeline()
        if model_registry is None:
            from llm.registry import llm_registry

            model_registry = llm_registry
        self.model_registry = model_registry

    def query(self, request: RAGQueryRequest) -> RAGQueryResponse:
        """
        Return trust-gated extracts or abstention. Full grounded synthesis is
        deliberately deferred until factual-support governance is implemented.
        """
        response = self.rag_pipeline.query(request)
        response.metrics["synthesis_status"] = "deferred_pending_grounding_governance"
        return response
