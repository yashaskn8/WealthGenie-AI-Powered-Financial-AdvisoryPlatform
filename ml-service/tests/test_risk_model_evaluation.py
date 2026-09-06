"""
Phase 4 Rigor Evaluation & Non-Circularity Verification Test Suite
"""

import pytest
from model.evaluation.rigor_evaluator import (
    audit_feature_overlap,
    audit_formula_logic_overlap,
    construct_independent_cfp_benchmark_targets,
    run_full_rigor_audit,
)


def test_feature_overlap_audit():
    """Verifies that the circular feature overlap audit runs and detects base feature overlap."""
    audit = audit_feature_overlap()
    assert audit["classifier_feature_count"] == 19
    assert audit["feature_schema_version"] == "recommendation-features-4.0.0"
    assert audit["forbidden_feature_overlap_percentage"] == 0.0
    assert audit["forbidden_feature_overlap"] == []
    assert audit["finding"] == "PASS"


def test_policy_fidelity_is_not_misrepresented_as_outcome_accuracy():
    """Synthetic labels deliberately approximate policy and must disclose that fact."""
    formula_audit = audit_formula_logic_overlap()
    assert formula_audit["formula_overlap_percentage"] == 100.0
    assert formula_audit["shared_math_terms"] == ["frozen_suitability_policy"]

    try:
        report = run_full_rigor_audit()
    except FileNotFoundError as e:
        pytest.skip(f"Rigor audit requires pre-trained model/dataset artifacts missing in CI: {e}")

    assert report["metric_reframe"]["outcome_accuracy_claimed"] is False


def test_rigor_evaluation_reproducibility():
    """Verifies that the full rigor evaluation audit is reproducible and outputs all required metrics."""
    try:
        report = run_full_rigor_audit()
    except FileNotFoundError as e:
        pytest.skip(f"Rigor audit requires pre-trained model/dataset artifacts missing in CI: {e}")

    assert "metric_reframe" in report
    assert report["metric_reframe"]["reframed_metric_name"] == "Suitability-Policy Approximation Fidelity"

    # Feature ablation
    ablation = report["feature_ablation_impact"]
    assert len(ablation) == 19
    assert "risk_tolerance_encoded" in ablation

    # Noise robustness
    noise = report["noise_robustness"]
    assert "noise_std_5pct_accuracy" in noise
    assert "noise_std_10pct_accuracy" in noise
    assert "noise_std_20pct_accuracy" in noise

    # Assert noise degrades fidelity monotonically
    assert noise["noise_std_5pct_accuracy"] >= noise["noise_std_10pct_accuracy"]
    assert noise["noise_std_10pct_accuracy"] >= noise["noise_std_20pct_accuracy"]

