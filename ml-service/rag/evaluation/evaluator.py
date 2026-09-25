"""
WealthGenie RAG Subsystem - Retrieval and Abstention Evaluation Engine
Evaluates retrieval, citation-ID validity, lexical support, and abstention behavior.
"""

import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Any, List, Set, Optional

from model.config import BASE_DIR
from rag.evaluation.metrics import (
    compute_recall_at_k,
    compute_precision_at_k,
    compute_mrr,
    compute_hit_rate,
    compute_ndcg,
    compute_context_coverage,
    compute_chunk_diversity,
    compute_citation_accuracy,
    compute_grounding_score,
)
from rag.schema import RAGQueryResponse

EVALS_DIR = BASE_DIR / "reports" / "rag_evals"
EVALS_DIR.mkdir(parents=True, exist_ok=True)

logger = logging.getLogger("wealthgenie.rag.evaluation")


class RAGEvaluator:
    """Evaluation engine that keeps retrieval, citations, support, and abstention distinct."""

    def __init__(self, evals_dir: Path = EVALS_DIR):
        self.evals_dir = evals_dir
        self.evals_dir.mkdir(parents=True, exist_ok=True)

    def evaluate_query_response(
        self,
        query: str,
        response: RAGQueryResponse,
        ground_truth_chunk_ids: Optional[Set[str]] = None,
        k: int = 4,
        expected_abstention: Optional[bool] = None,
    ) -> Dict[str, Any]:
        """
        Evaluate one response without treating citation validity as factual entailment.
        """
        retrieved_ids = [r.chunk.chunk_id for r in response.retrieved_chunks]
        retrieved_texts = [r.chunk.content for r in response.retrieved_chunks]
        embeddings = [r.chunk.embedding for r in response.retrieved_chunks if r.chunk.embedding]

        # FIXED: Do NOT fall back to set(retrieved_ids) when ground_truth_chunk_ids is None.
        # That created a self-referential comparison (retrieved vs retrieved) yielding trivial 1.0
        # for every metric. When no ground truth is provided, skip chunk-level IR metrics.
        gt_ids = ground_truth_chunk_ids
        has_ground_truth = gt_ids is not None and len(gt_ids) > 0
        expected_abstention = (
            gt_ids is not None and len(gt_ids) == 0
            if expected_abstention is None else expected_abstention
        )

        if has_ground_truth:
            recall_k = compute_recall_at_k(retrieved_ids, gt_ids, k)
            precision_k = compute_precision_at_k(retrieved_ids, gt_ids, k)
            mrr = compute_mrr(retrieved_ids, gt_ids)
            hit_rate = compute_hit_rate(retrieved_ids, gt_ids, k)
            ndcg = compute_ndcg(retrieved_ids, gt_ids, k)
        else:
            # No ground truth provided — mark IR metrics as NaN to avoid misleading scores
            recall_k = float('nan')
            precision_k = float('nan')
            mrr = float('nan')
            hit_rate = float('nan')
            ndcg = float('nan')

        coverage = compute_context_coverage(query, retrieved_texts)
        diversity = compute_chunk_diversity(embeddings) if embeddings else 1.0
        citation_id_validity = (
            compute_citation_accuracy(response.citations, response.retrieved_chunks)
            if response.citations else None
        )
        lexical_support = (
            compute_grounding_score(response.answer, retrieved_texts)
            if response.grounded else None
        )
        abstention_correctness = (
            (not response.grounded and not response.citations)
            if expected_abstention else None
        )
        retrieval_hit = (
            bool(set(retrieved_ids[:k]).intersection(gt_ids))
            if has_ground_truth else None
        )

        eval_results = {
            "query": query,
            "metrics": {
                f"recall_at_{k}": round(recall_k, 4),
                f"precision_at_{k}": round(precision_k, 4),
                "mrr": round(mrr, 4),
                "hit_rate": round(hit_rate, 4),
                f"ndcg_at_{k}": round(ndcg, 4),
                "context_coverage": round(coverage, 4),
                "chunk_diversity": round(diversity, 4),
                "retrieval_hit": retrieval_hit,
                "citation_id_validity": round(citation_id_validity, 4) if citation_id_validity is not None else None,
                "factual_support": None,
                "lexical_support": round(lexical_support, 4) if lexical_support is not None else None,
                "abstention_correctness": abstention_correctness,
            },
            "retrieved_chunk_count": len(retrieved_ids),
            "citations_count": len(response.citations),
            "timing_metrics": response.metrics,
        }

        return eval_results

    def evaluate_and_persist(
        self,
        query: str,
        response: RAGQueryResponse,
        ground_truth_chunk_ids: Optional[Set[str]] = None,
        k: int = 4,
        expected_abstention: Optional[bool] = None,
    ) -> Path:
        """
        Evaluates query response and persists structured JSON evaluation report to evals_dir.
        """
        results = self.evaluate_query_response(
            query,
            response,
            ground_truth_chunk_ids,
            k=k,
            expected_abstention=expected_abstention,
        )

        timestamp_str = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
        eval_id = f"eval_rag_{timestamp_str}"
        eval_file = self.evals_dir / f"{eval_id}.json"

        report = {
            "eval_id": eval_id,
            "timestamp_utc": datetime.now(timezone.utc).isoformat(),
            **results,
        }

        with open(eval_file, "w", encoding="utf-8") as f:
            json.dump(report, f, indent=2)

        logger.info(f"RAG Evaluation report persisted successfully to {eval_file}")
        return eval_file

    def list_evaluation_reports(self) -> List[Dict[str, Any]]:
        """Lists summaries of all historical RAG evaluation reports."""
        summaries = []
        for path in sorted(self.evals_dir.glob("eval_rag_*.json"), reverse=True):
            try:
                with open(path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                summaries.append({
                    "eval_id": data.get("eval_id"),
                    "timestamp": data.get("timestamp_utc"),
                    "query": data.get("query"),
                    "lexical_support": data.get("metrics", {}).get("lexical_support"),
                    "mrr": data.get("metrics", {}).get("mrr"),
                    "file_path": str(path),
                })
            except Exception as e:
                logger.warning(f"Could not parse eval report {path}: {e}")
        return summaries
