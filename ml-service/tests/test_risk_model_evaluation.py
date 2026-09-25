"""
Phase 4 Rigor Evaluation & Non-Circularity Verification Test Suite
"""

import json
import shutil
from pathlib import Path

import pytest
import model.evaluation.rigor_evaluator as rigor_evaluator
from scripts.verify_serving_artifacts import ArtifactVerificationError
from model.evaluation.rigor_evaluator import (
    audit_feature_overlap,
    audit_formula_logic_overlap,
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


def test_tracked_model_metadata_uses_holdout_metrics_and_exact_age_lineage():
    metadata_path = Path(__file__).parents[1] / "model" / "metadata.json"
    metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
    assert metadata["dataset_lineage"]["age_range"] == [18.0, 80.0]
    assert metadata["evaluation_split"] == {
        "method": "stratified_holdout",
        "test_fraction": 0.20,
        "random_seed": 42,
        "evaluated_samples": 400,
    }


def test_policy_fidelity_is_not_misrepresented_as_outcome_accuracy(tmp_path, monkeypatch):
    """Synthetic labels deliberately approximate policy and must disclose that fact."""
    formula_audit = audit_formula_logic_overlap()
    assert formula_audit["formula_overlap_percentage"] == 100.0
    assert formula_audit["shared_math_terms"] == ["frozen_suitability_policy"]
    monkeypatch.setattr(rigor_evaluator, "REPORT_OUTPUT", tmp_path / "rigor_evaluation_report.json")

    try:
        report = run_full_rigor_audit()
    except FileNotFoundError as e:
        pytest.skip(f"Rigor audit requires pre-trained model/dataset artifacts missing in CI: {e}")

    assert report["metric_reframe"]["outcome_accuracy_claimed"] is False


def test_rigor_evaluation_reproducibility(tmp_path, monkeypatch):
    """Verifies that the full rigor evaluation audit is reproducible and outputs all required metrics."""
    monkeypatch.setattr(rigor_evaluator, "REPORT_OUTPUT", tmp_path / "rigor_evaluation_report.json")
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


def test_rigor_audit_rejects_tampered_bundle_before_pickle_deserialization(tmp_path, monkeypatch):
    source_root = Path(__file__).parents[1]
    bundle_root = tmp_path / "model" / "bundles"
    shutil.copytree(source_root / "model" / "bundles", bundle_root)
    model_path = bundle_root / "random_forest" / "model.pkl"
    model_bytes = bytearray(model_path.read_bytes())
    model_bytes[-1] ^= 0x01
    model_path.write_bytes(model_bytes)

    deserialization_calls = []

    def record_deserialization(*args, **kwargs):
        deserialization_calls.append(args[0] if args else None)
        raise AssertionError("unverified model artifacts must never be deserialized")

    monkeypatch.setattr(rigor_evaluator, "ML_SERVICE_ROOT", tmp_path)
    monkeypatch.setattr(rigor_evaluator.joblib, "load", record_deserialization)

    with pytest.raises(ArtifactVerificationError, match="bundle verification failed"):
        run_full_rigor_audit()

    assert deserialization_calls == []
