"""
WealthGenie RAG Subsystem - Cross-Encoder Reranker
Neural reranker that uses a cross-encoder model to compute pairwise relevance
scores between the query and each retrieved chunk, then re-sorts by those scores.

Model: cross-encoder/ms-marco-MiniLM-L-6-v2  (CPU-feasible, ~80 MB)
The model is loaded once at initialization and reused across calls.
"""

import logging
from typing import Any, List, Optional

from sentence_transformers import CrossEncoder

from rag.reranking.base import BaseReranker
from rag.schema import RetrievedChunk

logger = logging.getLogger("wealthgenie.rag.reranking.cross_encoder")

_DEFAULT_MODEL_NAME = "cross-encoder/ms-marco-MiniLM-L-6-v2"


class CrossEncoderReranker(BaseReranker):
    """
    Neural reranker that scores (query, chunk) pairs with a cross-encoder
    transformer model trained on MS MARCO passage ranking data.

    Unlike the heuristic RelevanceScoreReranker, this uses learned semantic
    representations to judge relevance — capturing paraphrase, entailment,
    and contextual similarity that keyword overlap cannot.
    """

    def __init__(self, model_name: str = _DEFAULT_MODEL_NAME, model: Optional[Any] = None):
        """
        Loads the cross-encoder model once at initialization.

        Args:
            model_name: HuggingFace model identifier for the cross-encoder.
                        Defaults to cross-encoder/ms-marco-MiniLM-L-6-v2.
        """
        self._model_name = model_name
        if model is None:
            logger.info(f"Loading cross-encoder model: {model_name}")
            self._model = CrossEncoder(model_name)
            logger.info(f"Cross-encoder model loaded successfully: {model_name}")
        else:
            self._model = model

    def rerank(self, query: str, chunks: List[RetrievedChunk]) -> List[RetrievedChunk]:
        """
        Reranks chunks by cross-encoder relevance score.

        Each (query, chunk.content) pair is scored by the model's .predict()
        method. Chunks are sorted descending by that score and ranks are
        reassigned 1..N following the same pattern as RelevanceScoreReranker.
        """
        if not chunks:
            return chunks

        # Build (query, passage) pairs for batch prediction
        pairs = [[query, chunk.chunk.content] for chunk in chunks]

        # Score all pairs in a single batch call
        scores = self._model.predict(pairs)  # type: ignore[arg-type]

        # Attach scores to chunks
        scored_chunks = []
        for chunk, score in zip(chunks, scores):
            scored_chunks.append(
                RetrievedChunk(
                    chunk=chunk.chunk,
                    score=round(float(score), 4),
                    rank=0,  # Will be reassigned below
                )
            )

        # Sort by cross-encoder score descending
        scored_chunks.sort(key=lambda c: c.score, reverse=True)

        # Reassign ranks
        reranked = []
        for rank, c in enumerate(scored_chunks, start=1):
            reranked.append(
                RetrievedChunk(chunk=c.chunk, score=c.score, rank=rank)
            )

        return reranked

    @property
    def reranker_name(self) -> str:
        return "cross_encoder"
