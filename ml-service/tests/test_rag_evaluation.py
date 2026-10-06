"""
WealthGenie RAG Subsystem - Evaluation Framework Test Suite
Tests RAG metrics calculations (Recall, Precision, MRR, NDCG, Diversity, Grounding) and RAGEvaluator report persistence.
"""

import pytest

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
from rag.evaluation.evaluator import RAGEvaluator
from rag.schema import (
    RAGQueryResponse,
    RetrievedChunk,
    TextChunk,
    ChunkMetadata,
    Citation,
)


def test_retrieval_ranking_metrics():
    retrieved_ids = ["c1", "c2", "c3", "c4"]
    ground_truth = {"c2", "c5"}

    # Recall@4: 1 of 2 ground truth items retrieved = 0.5
    recall = compute_recall_at_k(retrieved_ids, ground_truth, k=4)
    assert recall == 0.5

    # Precision@2: 1 of top 2 items is relevant = 0.5
    precision = compute_precision_at_k(retrieved_ids, ground_truth, k=2)
    assert precision == 0.5

    # MRR: First relevant item is at rank 2 -> 1/2 = 0.5
    mrr = compute_mrr(retrieved_ids, ground_truth)
    assert mrr == 0.5

    # Hit Rate@2: c2 is in top 2 -> 1.0
    hit_rate = compute_hit_rate(retrieved_ids, ground_truth, k=2)
    assert hit_rate == 1.0

    # NDCG@4: > 0.0
    ndcg = compute_ndcg(retrieved_ids, ground_truth, k=4)
    assert ndcg > 0.0


def test_empty_expected_list_never_awards_perfect_retrieval_scores():
    assert compute_recall_at_k(["c1"], set(), k=1) == 0.0
    assert compute_mrr(["c1"], set()) == 0.0
    assert compute_hit_rate(["c1"], set(), k=1) == 0.0
    assert compute_ndcg(["c1"], set(), k=1) == 0.0


def test_context_coverage_and_diversity():
    query = "What is Section 87A tax rebate for FY 2025-26?"
    retrieved_texts = [
        "Under Section 87A rebate for FY 2025-26, income up to 12 Lakhs incurs zero tax."
    ]
    coverage = compute_context_coverage(query, retrieved_texts)
    assert coverage > 0.4

    embeddings = [
        [1.0, 0.0, 0.0],
        [0.0, 1.0, 0.0],
    ]
    diversity = compute_chunk_diversity(embeddings)
    assert pytest.approx(diversity, 0.01) == 1.0


def test_citation_accuracy_and_grounding_score():
    meta = ChunkMetadata(
        chunk_id="doc1#0000",
        document_id="doc1",
        chunk_index=0,
        title="Tax Guide",
        source="tax_doc.md",
    )
    chunk = TextChunk(
        chunk_id="doc1#0000",
        document_id="doc1",
        content="Section 87A rebate gives zero tax for income under 12 Lakhs.",
        metadata=meta,
    )
    ret_chunk = RetrievedChunk(chunk=chunk, score=0.9, rank=1)

    citations = [
        Citation(
            citation_id=1,
            document_title="Tax Guide",
            source="tax_doc.md",
            chunk_id="doc1#0000",
            excerpt="Section 87A rebate gives zero tax",
            relevance_score=0.9,
        )
    ]

    accuracy = compute_citation_accuracy(citations, [ret_chunk])
    assert accuracy == 1.0

    answer = "Section 87A rebate gives zero tax for income under 12 Lakhs."
    grounding = compute_grounding_score(answer, [chunk.content])
    assert grounding == 1.0


def test_rag_evaluator_persistence(tmp_path):
    evaluator = RAGEvaluator(evals_dir=tmp_path)

    meta = ChunkMetadata(
        chunk_id="doc1#0000",
        document_id="doc1",
        chunk_index=0,
        title="Tax Guide",
        source="tax_doc.md",
    )
    chunk = TextChunk(
        chunk_id="doc1#0000",
        document_id="doc1",
        content="Section 87A rebate provides tax relief.",
        metadata=meta,
    )
    ret_chunk = RetrievedChunk(chunk=chunk, score=0.85, rank=1)

    response = RAGQueryResponse(
        answer="Section 87A rebate provides tax relief.",
        citations=[],
        retrieved_chunks=[ret_chunk],
        metrics={"total_latency_ms": 12.4},
        grounded=True,
    )

    eval_file = evaluator.evaluate_and_persist(
        query="PRIVATE_QUERY_SENTINEL What is Section 87A?",
        response=response,
        ground_truth_chunk_ids={"doc1#0000"},
        k=2,
    )

    assert eval_file.exists()
    reports = evaluator.list_evaluation_reports()
    assert len(reports) == 1
    assert "query" not in reports[0]
    assert "PRIVATE_QUERY_SENTINEL" not in eval_file.read_text(encoding="utf-8")


def test_evaluator_distinguishes_abstention_from_retrieval_metrics(tmp_path):
    evaluator = RAGEvaluator(evals_dir=tmp_path)
    response = RAGQueryResponse(
        answer="No trustworthy evidence.", citations=[], retrieved_chunks=[], grounded=False
    )
    result = evaluator.evaluate_query_response(
        query="Who won a football match?",
        response=response,
        ground_truth_chunk_ids=set(),
    )
    assert result["metrics"]["abstention_correctness"] is True
    assert result["metrics"]["citation_id_validity"] is None
    assert result["metrics"]["factual_support"] is None
