"""
WealthGenie Production Open-Weight LLM Platform - Evaluation Test Suite (Phase 3.4)
Tests perplexity, BLEU, ROUGE, BERTScore, grounding faithfulness, dataset evaluation, and provider comparison.
"""

from llm.evaluation.evaluator import LLMEvaluator
from llm.evaluation.metrics import (
    compute_perplexity,
    compute_bleu,
    compute_rouge,
    compute_bertscore_approx,
    compute_grounding_faithfulness,
)
from llm.providers.api_provider import APILLMProvider
from llm.providers.mock_provider import MockLLMProvider


def test_perplexity_metric():
    assert compute_perplexity(0.0) == 1.0
    assert compute_perplexity(1.0) == round(2.718281828, 4)


def test_bleu_and_rouge_metrics():
    ref = "Section 87A provides tax rebate up to Rs 25,000 for income up to Rs 7 lakh."
    cand = "Section 87A provides tax rebate up to Rs 25,000 for income up to Rs 7 lakh."

    # Identical texts -> High scores
    assert compute_bleu(ref, cand) == 1.0
    rouge = compute_rouge(ref, cand)
    assert rouge["rouge1"] == 1.0
    assert rouge["rougeL"] == 1.0

    # Partial match
    cand_partial = "Section 87A provides tax rebate."
    bleu_partial = compute_bleu(ref, cand_partial)
    assert 0.0 <= bleu_partial <= 1.0


def test_bertscore_approx():
    ref = "Income tax slabs for assessment year 2026."
    cand = "Income tax rates for assessment year 2026."
    score = compute_bertscore_approx(ref, cand)
    assert 0.5 <= score <= 1.0


def test_grounding_faithfulness_metric():
    context = ["Section 87A rebate gives Rs 25,000 tax relief for resident individuals."]
    answer = "Section 87A rebate gives tax relief."

    faith = compute_grounding_faithfulness(context, answer)
    assert faith["faithfulness_score"] > 0.8
    assert faith["hallucination_score"] < 0.2


def test_evaluator_provider_evaluation_and_comparison():
    evaluator = LLMEvaluator()
    mock_p = MockLLMProvider()
    api_p = APILLMProvider()

    test_samples = [
        {
            "instruction": "What is Section 87A rebate?",
            "output": "Section 87A provides tax rebate up to Rs 25,000 for income up to Rs 7 lakh.",
        },
        {
            "instruction": "How to allocate investment portfolio?",
            "output": "A balanced wealth management portfolio allocates assets across equities and fixed income.",
        },
    ]

    mock_report = evaluator.evaluate_provider(mock_p, test_samples)
    assert mock_report["sample_count"] == 2
    assert mock_report["avg_latency_ms"] >= 0.0
    assert "mean_bleu" in mock_report["quality_metrics"]

    comparison = evaluator.compare_providers(mock_p, api_p, test_samples)
    assert "local_model_report" in comparison
    assert "api_model_report" in comparison
    assert "comparison_summary" in comparison
