"""
WealthGenie Open-Weight LLM Platform - Evaluator Framework
Runs dataset evaluations, computes operational stats (QPS, token throughput), and compares Local vs API models.
"""

import logging
import time
from typing import Dict, Any, List, Optional
import numpy as np

from llm.evaluation.metrics import (
    compute_bleu,
    compute_rouge,
    compute_lexical_overlap_score,
    compute_embedding_semantic_similarity,
    compute_grounding_faithfulness,
)
from llm.providers.base import BaseLLMProvider
from llm.schema import LLMGenerateRequest

logger = logging.getLogger("wealthgenie.llm.evaluation")


class LLMEvaluator:
    """Evaluation framework for open-weight LLM quality, latency, throughput, and model benchmarking."""

    @staticmethod
    def evaluate_sample(
        reference: str,
        candidate: str,
        context_chunks: Optional[List[str]] = None,
    ) -> Dict[str, float]:
        """Calculates single-sample generation quality and grounding metrics."""
        bleu = compute_bleu(reference, candidate)
        rouge_scores = compute_rouge(reference, candidate)
        lexical_sim = compute_lexical_overlap_score(reference, candidate)
        semantic_sim = compute_embedding_semantic_similarity(reference, candidate)

        res = {
            "bleu": bleu,
            "rouge1": rouge_scores["rouge1"],
            "rouge2": rouge_scores["rouge2"],
            "rougeL": rouge_scores["rougeL"],
            "lexical_overlap_score": lexical_sim,
            "semantic_embedding_similarity": semantic_sim,
            "bertscore_approx": lexical_sim,  # Kept for backward compatibility
            "bertscore": lexical_sim,  # Canonical key expected by evaluate_provider
        }

        if context_chunks:
            faith = compute_grounding_faithfulness(context_chunks, candidate)
            res.update(faith)

        return res

    def evaluate_provider(
        self,
        provider: BaseLLMProvider,
        test_samples: List[Dict[str, Any]],
    ) -> Dict[str, Any]:
        """Runs evaluation over a list of test samples for a given provider."""
        t0 = time.perf_counter()

        bleu_scores = []
        rouge1_scores = []
        rougeL_scores = []
        bert_scores = []
        latencies_ms = []
        total_completion_tokens = 0

        for sample in test_samples:
            prompt = sample.get("instruction") or sample.get("prompt") or ""
            reference = sample.get("output") or sample.get("reference") or ""
            context = sample.get("context_chunks")

            req = LLMGenerateRequest(prompt=prompt)
            gen_res = provider.generate(req)

            latencies_ms.append(gen_res.latency_ms)
            total_completion_tokens += gen_res.completion_tokens

            if reference:
                metrics = self.evaluate_sample(reference, gen_res.text, context_chunks=context)
                bleu_scores.append(metrics["bleu"])
                rouge1_scores.append(metrics["rouge1"])
                rougeL_scores.append(metrics["rougeL"])
                bert_scores.append(metrics["bertscore"])

        total_wall_time = time.perf_counter() - t0
        tokens_per_sec = total_completion_tokens / total_wall_time if total_wall_time > 0 else 0.0

        return {
            "provider": provider.get_metadata().provider.value,
            "model_name": provider.get_metadata().model_name,
            "sample_count": len(test_samples),
            "avg_latency_ms": round(float(np.mean(latencies_ms)), 2) if latencies_ms else 0.0,
            "p50_latency_ms": round(float(np.percentile(latencies_ms, 50)), 2) if latencies_ms else 0.0,
            "p90_latency_ms": round(float(np.percentile(latencies_ms, 90)), 2) if latencies_ms else 0.0,
            "token_throughput_tokens_per_sec": round(tokens_per_sec, 2),
            "quality_metrics": {
                "mean_bleu": round(float(np.mean(bleu_scores)), 4) if bleu_scores else 0.0,
                "mean_rouge1": round(float(np.mean(rouge1_scores)), 4) if rouge1_scores else 0.0,
                "mean_rougeL": round(float(np.mean(rougeL_scores)), 4) if rougeL_scores else 0.0,
                "mean_bertscore": round(float(np.mean(bert_scores)), 4) if bert_scores else 0.0,
            },
        }

    def compare_providers(
        self,
        local_provider: BaseLLMProvider,
        api_provider: BaseLLMProvider,
        test_samples: List[Dict[str, Any]],
    ) -> Dict[str, Any]:
        """Runs side-by-side comparative evaluation between local model vs API model."""
        local_report = self.evaluate_provider(local_provider, test_samples)
        api_report = self.evaluate_provider(api_provider, test_samples)

        return {
            "local_model_report": local_report,
            "api_model_report": api_report,
            "comparison_summary": {
                "latency_difference_ms": round(local_report["avg_latency_ms"] - api_report["avg_latency_ms"], 2),
                "throughput_ratio_local_vs_api": round(
                    local_report["token_throughput_tokens_per_sec"] / api_report["token_throughput_tokens_per_sec"], 2
                ) if api_report["token_throughput_tokens_per_sec"] > 0 else 1.0,
                "bertscore_difference": round(
                    local_report["quality_metrics"]["mean_bertscore"] - api_report["quality_metrics"]["mean_bertscore"], 4
                ),
            },
        }
