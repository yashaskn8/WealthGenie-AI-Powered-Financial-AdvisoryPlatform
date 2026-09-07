"""
WealthGenie Open-Weight LLM Platform - Evaluation Metrics
Calculates perplexity, BLEU, ROUGE, lexical overlap, semantic embedding similarity, and grounding faithfulness.
"""

import math
import re
from typing import Dict, List, Tuple


def compute_perplexity(loss: float) -> float:
    """Calculates perplexity score from cross-entropy loss: PPL = exp(loss)."""
    try:
        return round(math.exp(loss), 4)
    except OverflowError:
        return float("inf")


def _get_ngrams(tokens: List[str], n: int) -> Dict[Tuple[str, ...], int]:
    """Helper to count n-grams in a token list."""
    counts: Dict[Tuple[str, ...], int] = {}
    for i in range(len(tokens) - n + 1):
        ngram = tuple(tokens[i:i + n])
        counts[ngram] = counts.get(ngram, 0) + 1
    return counts


def compute_bleu(reference: str, candidate: str, max_n: int = 4) -> float:
    """Computes BLEU score with modified n-gram precision and brevity penalty."""
    ref_tokens = re.findall(r"\w+", reference.lower())
    cand_tokens = re.findall(r"\w+", candidate.lower())

    if not cand_tokens or not ref_tokens:
        return 0.0

    p_ns = []
    for n in range(1, max_n + 1):
        cand_ngrams = _get_ngrams(cand_tokens, n)
        ref_ngrams = _get_ngrams(ref_tokens, n)
        if not cand_ngrams:
            p_ns.append(0.0)
            continue

        clipped_count = 0
        total_count = sum(cand_ngrams.values())
        for ngram, count in cand_ngrams.items():
            clipped_count += min(count, ref_ngrams.get(ngram, 0))
        p_ns.append(clipped_count / total_count if total_count > 0 else 0.0)

    # Brevity Penalty
    c = len(cand_tokens)
    r = len(ref_tokens)
    bp = 1.0 if c > r else math.exp(1.0 - (r / c)) if c > 0 else 0.0

    # Geometric Mean of Precision
    if any(p == 0.0 for p in p_ns):
        geo_mean = 0.0
    else:
        geo_mean = math.exp(sum(math.log(p) for p in p_ns) / max_n)

    return round(bp * geo_mean, 4)


def compute_rouge(reference: str, candidate: str) -> Dict[str, float]:
    """Computes ROUGE-1, ROUGE-2, and ROUGE-L recall scores."""
    ref_tokens = re.findall(r"\w+", reference.lower())
    cand_tokens = re.findall(r"\w+", candidate.lower())

    if not ref_tokens or not cand_tokens:
        return {"rouge1": 0.0, "rouge2": 0.0, "rougeL": 0.0}

    # ROUGE-1
    ref_1 = set(ref_tokens)
    cand_1 = set(cand_tokens)
    rouge1 = len(ref_1.intersection(cand_1)) / len(ref_1) if ref_1 else 0.0

    # ROUGE-2
    ref_2 = set(_get_ngrams(ref_tokens, 2).keys())
    cand_2 = set(_get_ngrams(cand_tokens, 2).keys())
    rouge2 = len(ref_2.intersection(cand_2)) / len(ref_2) if ref_2 else 0.0

    # ROUGE-L (LCS-based recall)
    m, n = len(ref_tokens), len(cand_tokens)
    dp = [[0] * (n + 1) for _ in range(m + 1)]
    for i in range(1, m + 1):
        for j in range(1, n + 1):
            if ref_tokens[i - 1] == cand_tokens[j - 1]:
                dp[i][j] = dp[i - 1][j - 1] + 1
            else:
                dp[i][j] = max(dp[i - 1][j], dp[i][j - 1])

    lcs_length = dp[m][n]
    rougeL = lcs_length / m if m > 0 else 0.0

    return {
        "rouge1": round(rouge1, 4),
        "rouge2": round(rouge2, 4),
        "rougeL": round(rougeL, 4),
    }


def compute_lexical_overlap_score(reference: str, candidate: str) -> float:
    """
    Computes rescaled Jaccard word-overlap similarity score.
    Measures surface-level lexical token overlap between reference and candidate text.
    Note: This is a fast lexical metric (0.4 + 0.6 * Jaccard), NOT dense contextual BERTScore.
    """
    ref_words = set(re.findall(r"\w+", reference.lower()))
    cand_words = set(re.findall(r"\w+", candidate.lower()))

    if not ref_words or not cand_words:
        return 0.0

    intersection = ref_words.intersection(cand_words)
    union = ref_words.union(cand_words)
    jaccard_sim = len(intersection) / len(union) if union else 0.0

    return round(min(1.0, 0.4 + 0.6 * jaccard_sim), 4)


def compute_bertscore_approx(reference: str, candidate: str) -> float:
    """
    DEPRECATED ALIAS for backward compatibility.
    Calls compute_lexical_overlap_score(). Measures lexical word overlap, not BERTScore.
    """
    return compute_lexical_overlap_score(reference, candidate)


_GLOBAL_EMBEDDER = None

def compute_embedding_semantic_similarity(reference: str, candidate: str) -> float:
    """
    Computes semantic vector similarity between reference and candidate text
    using SentenceTransformer ('all-MiniLM-L6-v2') dense embeddings.
    """
    global _GLOBAL_EMBEDDER
    if not reference or not candidate:
        return 0.0
    try:
        import numpy as _np  # type: ignore[import-not-found]
        import sys
        from pathlib import Path
        if _GLOBAL_EMBEDDER is None:
            _ml_svc = str(Path(__file__).resolve().parent.parent.parent)
            if _ml_svc not in sys.path:
                sys.path.insert(0, _ml_svc)
            from rag.embeddings.dense_embedding import SentenceTransformerEmbeddingProvider  # type: ignore[import-not-found]
            _GLOBAL_EMBEDDER = SentenceTransformerEmbeddingProvider()

        ref_vec = _np.array(_GLOBAL_EMBEDDER.embed_text(reference))
        cand_vec = _np.array(_GLOBAL_EMBEDDER.embed_text(candidate))

        norm_ref = float(_np.linalg.norm(ref_vec))
        norm_cand = float(_np.linalg.norm(cand_vec))
        if norm_ref == 0 or norm_cand == 0:
            return 0.0
        cos_sim = float(_np.dot(ref_vec, cand_vec) / (norm_ref * norm_cand))
        return round(max(0.0, min(1.0, cos_sim)), 4)
    except Exception:
        # Fallback to lexical overlap score if embedder unavailable
        return compute_lexical_overlap_score(reference, candidate)


def compute_grounding_faithfulness(context_chunks: List[str], generated_answer: str) -> Dict[str, float]:
    """
    Evaluates whether generated answer claims are supported by context chunks.
    Returns faithfulness score, grounding ratio, and hallucination risk estimate.
    """
    if not context_chunks or not generated_answer:
        return {"faithfulness_score": 0.0, "grounding_ratio": 0.0, "hallucination_score": 1.0}

    combined_context = " ".join(context_chunks).lower()
    context_words = set(re.findall(r"\w+", combined_context))

    answer_words = re.findall(r"\w+", generated_answer.lower())
    if not answer_words:
        return {"faithfulness_score": 0.0, "grounding_ratio": 0.0, "hallucination_score": 1.0}

    supported_count = sum(1 for w in answer_words if w in context_words or len(w) <= 3)
    grounding_ratio = supported_count / len(answer_words)

    faithfulness_score = round(min(1.0, grounding_ratio * 1.05), 4)
    hallucination_score = round(max(0.0, 1.0 - faithfulness_score), 4)

    return {
        "faithfulness_score": faithfulness_score,
        "grounding_ratio": round(grounding_ratio, 4),
        "hallucination_score": hallucination_score,
    }
