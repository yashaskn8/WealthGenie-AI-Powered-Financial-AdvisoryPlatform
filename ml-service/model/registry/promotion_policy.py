"""Shared deterministic quality gate for evidence-bound model promotion."""

import math
from typing import Any, Dict, List


PROMOTION_MAX_REGRESSION = 0.02
PROMOTION_TRACKED_METRICS = [
    "rule_approximation_fidelity",
    "balanced_accuracy",
    "macro_f1",
]


def has_complete_promotion_metrics(metrics: Any) -> bool:
    return isinstance(metrics, dict) and all(
        name in metrics
        and not isinstance(metrics[name], bool)
        and isinstance(metrics[name], (int, float))
        and math.isfinite(metrics[name])
        and 0 <= metrics[name] <= 1
        for name in PROMOTION_TRACKED_METRICS
    )


def metrics_from_verified_evaluation_report(report: Any) -> Dict[str, float]:
    """Extract only metrics whose definitions match the promotion evaluator."""
    if not isinstance(report, dict):
        return {}
    direct = report.get("metrics")
    if has_complete_promotion_metrics(direct):
        return {name: float(direct[name]) for name in PROMOTION_TRACKED_METRICS}

    test_metrics = report.get("test_metrics")
    definitions = report.get("metric_definitions")
    if (
        report.get("interpretation") != "synthetic suitability-policy approximation fidelity; not investor outcomes or investment performance"
        or not isinstance(definitions, dict)
        or definitions.get("accuracy") != "fraction of split examples matching the synthetic policy label"
        or not isinstance(test_metrics, dict)
        or any(name not in test_metrics for name in ("accuracy", "balanced_accuracy", "macro_f1"))
    ):
        return {}
    normalized = {
        "rule_approximation_fidelity": test_metrics["accuracy"],
        "balanced_accuracy": test_metrics["balanced_accuracy"],
        "macro_f1": test_metrics["macro_f1"],
    }
    return {name: float(normalized[name]) for name in PROMOTION_TRACKED_METRICS} if has_complete_promotion_metrics(normalized) else {}


def check_promotion_gate(
    candidate_metrics: Dict[str, Any],
    active_metrics: Dict[str, Any],
    max_regression: float = PROMOTION_MAX_REGRESSION,
    tracked_metrics: List[str] | None = None,
) -> Dict[str, Any]:
    """Fail closed when evidence is missing/invalid or regresses past policy."""
    if tracked_metrics is None:
        tracked_metrics = PROMOTION_TRACKED_METRICS
    if (
        isinstance(max_regression, bool)
        or not isinstance(max_regression, (int, float))
        or not math.isfinite(max_regression)
        or not 0 <= max_regression < 1
    ):
        raise ValueError("promotion regression policy must be finite and in [0, 1)")
    if not isinstance(candidate_metrics, dict) or not isinstance(active_metrics, dict):
        return {
            "gate_passed": False,
            "max_regression_allowed": max_regression,
            "per_metric": {},
            "failures": ["candidate and active metrics must be mappings"],
        }

    per_metric = {}
    failures = []
    for metric_name in tracked_metrics:
        active_val = active_metrics.get(metric_name)
        candidate_val = candidate_metrics.get(metric_name)
        if active_val is None or candidate_val is None:
            per_metric[metric_name] = {"status": "SKIPPED", "reason": "required evidence is missing"}
            failures.append(f"{metric_name}: required validation evidence is missing")
            continue
        if (
            isinstance(active_val, bool)
            or isinstance(candidate_val, bool)
            or not isinstance(active_val, (int, float))
            or not isinstance(candidate_val, (int, float))
            or not math.isfinite(active_val)
            or not math.isfinite(candidate_val)
            or not 0 <= active_val <= 1
            or not 0 <= candidate_val <= 1
        ):
            per_metric[metric_name] = {"status": "FAIL", "reason": "metric evidence must be finite and in [0, 1]"}
            failures.append(f"{metric_name}: invalid validation evidence")
            continue
        threshold = active_val * (1.0 - max_regression)
        passed = candidate_val >= threshold
        per_metric[metric_name] = {
            "active_value": round(active_val, 4),
            "candidate_value": round(candidate_val, 4),
            "minimum_required": round(threshold, 4),
            "regression_pct": round((1.0 - candidate_val / active_val) * 100, 2) if active_val > 0 else 0.0,
            "status": "PASS" if passed else "FAIL",
        }
        if not passed:
            failures.append(
                f"{metric_name}: candidate={round(candidate_val, 4)} < "
                f"minimum={round(threshold, 4)} (active={round(active_val, 4)}, "
                f"max_regression={max_regression * 100}%)"
            )
    return {
        "gate_passed": not failures,
        "max_regression_allowed": max_regression,
        "per_metric": per_metric,
        "failures": failures,
    }
