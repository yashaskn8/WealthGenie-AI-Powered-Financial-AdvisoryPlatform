"""
WealthGenie RAG Subsystem - Retrieval Quality Evaluation Metrics
Calculates Recall@k, Precision@k, MRR, NDCG, Hit Rate, Context Precision/Recall, Diversity, and Grounding Score.
"""

import math
import numbers
from typing import Dict, List, Set, Any
import numpy as np

from rag.schema import RetrievedChunk, Citation


def summarize_metric_values(raw_values: List[object]) -> Dict[str, Any]:
    """Summarize finite numeric observations without turning missing evidence into zero."""
    values = []
    nan_count = 0
    unavailable_count = 0
    invalid_count = 0
    for value in raw_values:
        if value is None:
            unavailable_count += 1
            continue
        if not isinstance(value, numbers.Real):
            invalid_count += 1
            continue
        numeric = float(value)
        if math.isnan(numeric):
            nan_count += 1
        elif math.isfinite(numeric):
            values.append(numeric)
        else:
            invalid_count += 1

    return {
        "mean": round(sum(values) / len(values), 4) if values else None,
        "min": round(min(values), 4) if values else None,
        "max": round(max(values), 4) if values else None,
        "valid_count": len(values),
        "nan_count": nan_count,
        "unavailable_count": unavailable_count,
        "invalid_count": invalid_count,
    }


def compute_recall_at_k(retrieved_chunk_ids: List[str], ground_truth_ids: Set[str], k: int) -> float:
    """Computes Recall@k: proportion of ground truth relevant chunks retrieved in top k."""
    if not ground_truth_ids:
        return 0.0
    top_k_ids = set(retrieved_chunk_ids[:k])
    relevant_retrieved = len(top_k_ids.intersection(ground_truth_ids))
    return float(relevant_retrieved / len(ground_truth_ids))


def compute_precision_at_k(retrieved_chunk_ids: List[str], ground_truth_ids: Set[str], k: int) -> float:
    """Computes Precision@k: proportion of top k retrieved chunks that are ground truth relevant."""
    if k <= 0 or not retrieved_chunk_ids:
        return 0.0
    top_k_ids = retrieved_chunk_ids[:k]
    relevant_retrieved = sum(1 for cid in top_k_ids if cid in ground_truth_ids)
    return float(relevant_retrieved / min(k, len(top_k_ids)))


def compute_mrr(retrieved_chunk_ids: List[str], ground_truth_ids: Set[str]) -> float:
    """Computes Mean Reciprocal Rank (MRR): 1 / rank of first relevant chunk."""
    if not ground_truth_ids:
        return 0.0
    for rank, cid in enumerate(retrieved_chunk_ids, start=1):
        if cid in ground_truth_ids:
            return float(1.0 / rank)
    return 0.0


def compute_hit_rate(retrieved_chunk_ids: List[str], ground_truth_ids: Set[str], k: int) -> float:
    """Computes Hit Rate@k: 1.0 if at least 1 relevant chunk is in top k, else 0.0."""
    if not ground_truth_ids:
        return 0.0
    top_k_ids = set(retrieved_chunk_ids[:k])
    return 1.0 if len(top_k_ids.intersection(ground_truth_ids)) > 0 else 0.0


def compute_ndcg(retrieved_chunk_ids: List[str], ground_truth_ids: Set[str], k: int) -> float:
    """Computes Normalized Discounted Cumulative Gain (NDCG@k)."""
    if not ground_truth_ids or k <= 0:
        return 0.0

    dcg = 0.0
    for idx, cid in enumerate(retrieved_chunk_ids[:k]):
        if cid in ground_truth_ids:
            dcg += 1.0 / math.log2(idx + 2)

    idcg = sum(1.0 / math.log2(idx + 2) for idx in range(min(k, len(ground_truth_ids))))
    return float(dcg / idcg) if idcg > 0 else 0.0


def compute_context_coverage(query: str, retrieved_texts: List[str]) -> float:
    """Computes Context Coverage: proportion of distinct query keywords present in retrieved text."""
    words = set(query.lower().replace("?", "").replace(",", "").split())
    words = {w for w in words if len(w) > 3}  # Filter short stop words
    if not words:
        return 1.0

    combined_text = " ".join(retrieved_texts).lower()
    matches = sum(1 for word in words if word in combined_text)
    return float(matches / len(words))


def compute_chunk_diversity(embeddings: List[List[float]]) -> float:
    """Computes Chunk Diversity: average pairwise cosine distance (1.0 - cosine_similarity) between chunks."""
    if len(embeddings) < 2:
        return 1.0

    matrix = np.array(embeddings, dtype=np.float32)
    norms = np.linalg.norm(matrix, axis=1, keepdims=True)
    norms[norms == 0] = 1.0
    matrix_normed = matrix / norms

    sim_matrix = np.dot(matrix_normed, matrix_normed.T)
    # Extract upper triangle excluding diagonal
    n = len(embeddings)
    triu_indices = np.triu_indices(n, k=1)
    pairwise_sims = sim_matrix[triu_indices]

    pairwise_distances = 1.0 - np.clip(pairwise_sims, 0.0, 1.0)
    return float(np.mean(pairwise_distances))


def compute_citation_accuracy(citations: List[Citation], retrieved_chunks: List[RetrievedChunk]) -> float:
    """Validate sequential citation IDs and retrieved chunk references, not entailment."""
    if not citations:
        return 0.0
    identifiers = [citation.citation_id for citation in citations]
    if (not all(type(identifier) is int for identifier in identifiers)
            or len(set(identifiers)) != len(identifiers)
            or set(identifiers) != set(range(1, len(identifiers) + 1))):
        return 0.0
    retrieved_chunk_ids = {r.chunk.chunk_id for r in retrieved_chunks}
    valid_citations = sum(1 for citation in citations if citation.chunk_id in retrieved_chunk_ids)
    return float(valid_citations / len(citations))


def format_metric_value(value: object) -> str:
    """Format a measured metric, preserving unavailable/invalid values as N/A."""
    if not isinstance(value, numbers.Real):
        return "N/A"
    numeric = float(value)
    if not math.isfinite(numeric):
        return "N/A"
    return f"{numeric:.4f}"


def compute_grounding_score(response_text: str, retrieved_texts: List[str]) -> float:
    """
    Computes Grounding Score: alignment between response sentences and retrieved evidence.
    Returns ratio of response sentences that share term overlap with context.
    """
    sentences = [s.strip() for s in response_text.split(".") if len(s.strip()) > 10]
    if not sentences or not retrieved_texts:
        return 0.0

    combined_context = " ".join(retrieved_texts).lower()
    grounded_count = 0

    for s in sentences:
        words = [w.lower() for w in s.split() if len(w) > 4]
        if not words:
            grounded_count += 1
            continue
        # If at least 40% of key words in sentence appear in context, count as grounded
        match_ratio = sum(1 for w in words if w in combined_context) / len(words)
        if match_ratio >= 0.35:
            grounded_count += 1

    return float(grounded_count / len(sentences))
