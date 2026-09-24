"""
WealthGenie RAG Subsystem - BM25 / Keyword Retriever
Computes BM25 term frequency-inverse document frequency keyword scores across indexed chunks.
"""

import math
import re
from typing import List, Dict, Optional
import numpy as np

from rag.retrievers.base import BaseRetriever
from rag.schema import TextChunk, RetrievedChunk, is_scope_accessible
from rag.vector_store.base import BaseVectorStore
from rag.vector_store.memory_vector_store import PersistentVectorStore


class BM25KeywordRetriever(BaseRetriever):
    """Keyword search engine using BM25 scoring algorithm."""

    def __init__(
        self,
        vector_store: Optional[BaseVectorStore] = None,
        k1: float = 1.5,
        b: float = 0.75,
    ):
        self.vector_store = vector_store or PersistentVectorStore()
        self.k1 = k1
        self.b = b

    @property
    def strategy_name(self) -> str:
        return "keyword_bm25"

    @staticmethod
    def _tokenize(text: str) -> List[str]:
        """Tokenizes text into lowercase terms."""
        cleaned = re.sub(r"[^\w\s]", " ", text.lower())
        return [w for w in cleaned.split() if len(w) > 1]

    def retrieve(
        self,
        query: str,
        top_k: int = 4,
        threshold: float = 0.0,
        tenant_id: str = "default",
        user_id: Optional[str] = None,
        scope: Optional[str] = None,
    ) -> List[RetrievedChunk]:
        """Executes BM25 keyword search across tenant/scope-filtered vector store chunks."""
        all_chunks = self.vector_store.get_chunks()
        chunks = [
            c for c in all_chunks
            if c.lifecycle_state == "ACTIVE" and is_scope_accessible(
                chunk_scope=getattr(c, "scope", getattr(c.metadata, "scope", "global")),
                chunk_tenant_id=getattr(c, "tenant_id", getattr(c.metadata, "tenant_id", "default")),
                requesting_scope=scope,
                requesting_user_id=user_id,
                tenant_id=tenant_id,
            )
        ]
        if not chunks:
            return []

        query_terms = self._tokenize(query)
        if not query_terms:
            return []

        num_docs = len(chunks)
        doc_lens = [len(self._tokenize(c.content)) for c in chunks]
        avg_doc_len = sum(doc_lens) / num_docs if num_docs > 0 else 1.0

        # Calculate Document Frequency (DF) for each query term
        doc_freqs: Dict[str, int] = {}
        doc_term_counts: List[Dict[str, int]] = []

        for c in chunks:
            terms = self._tokenize(c.content)
            term_cnt: Dict[str, int] = {}
            for t in terms:
                term_cnt[t] = term_cnt.get(t, 0) + 1
            doc_term_counts.append(term_cnt)

            for t in set(terms):
                doc_freqs[t] = doc_freqs.get(t, 0) + 1

        # Compute BM25 scores
        scores = np.zeros(num_docs, dtype=np.float32)

        for q_term in query_terms:
            df = doc_freqs.get(q_term, 0)
            if df == 0:
                continue

            # Inverse Document Frequency (IDF)
            idf = math.log((num_docs - df + 0.5) / (df + 0.5) + 1.0)

            for idx, term_cnt in enumerate(doc_term_counts):
                tf = term_cnt.get(q_term, 0)
                if tf == 0:
                    continue

                d_len = doc_lens[idx]
                numerator = tf * (self.k1 + 1.0)
                denominator = tf + self.k1 * (1.0 - self.b + self.b * (d_len / avg_doc_len))
                scores[idx] += idf * (numerator / denominator)

        # Normalize scores to [0.0, 1.0] range
        max_score = np.max(scores) if len(scores) > 0 else 1.0
        if max_score > 0:
            norm_scores = scores / max_score
        else:
            norm_scores = scores

        # Rank indices by descending score
        top_indices = np.argsort(norm_scores)[::-1][:top_k]

        results: List[RetrievedChunk] = []
        for rank, idx in enumerate(top_indices, start=1):
            score = float(norm_scores[idx])
            if score >= threshold and score > 0.0:
                results.append(
                    RetrievedChunk(
                        chunk=chunks[idx],
                        score=round(score, 4),
                        rank=rank,
                    )
                )

        return results
