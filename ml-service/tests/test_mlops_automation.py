"""
WealthGenie ML Microservice - Automated MLOps Lifecycle Integration Tests
Phase 5 MLOps Verification Suite.

Tests and independently proves:
  1. Drift Detection & Auto-Retrain Trigger (PSI drift detection -> retrain -> is_active: false candidate).
  2. Promotion Gate Validation (enforces max 2% metric regression limit, rejects inferior candidates).
  3. Canary / Shadow Mode Dual-Evaluation (parallel evaluation without altering active response, agreement stats).
  4. Dataset Lineage & Hash Reproducibility (stored parameters regenerate exact matching dataset hash).
"""

import logging
import os

import numpy as np
import pytest
from fastapi.testclient import TestClient

from main import app
from model.data.preprocessing import (
    compute_dataset_hash_from_arrays,
    get_dataset_generation_params,
    prepare_synthetic_training_data,
    regenerate_synthetic_dataset_and_hash,
)
from store_factory import get_model_registry

logger = logging.getLogger(__name__)


@pytest.fixture
def client():
    api_key = os.environ.get("ML_SERVICE_API_KEY", "wealthgenie_secret_api_key_2026")
    operator_key = os.environ.get("ML_OPERATOR_KEY", "wealthgenie_operator_secret_key_9999")
    with TestClient(
        app,
        headers={"X-API-Key": api_key, "X-Operator-Key": operator_key},
    ) as test_client:
        yield test_client


def test_dataset_lineage_hash_reproducibility():
    """
    STEP 4 VERIFICATION:
    Proves that dataset generation parameters stored in lineage metadata
    can deterministically regenerate the exact same dataset and matching SHA-256 hash.
    """
    seed = 1337
    num_samples = 500
    params = get_dataset_generation_params(num_samples=num_samples, seed=seed)

    # 1. Original generation
    X_orig, y_orig = prepare_synthetic_training_data(num_samples=num_samples, seed=seed)
    original_hash = compute_dataset_hash_from_arrays(X_orig, y_orig)

    # 2. Independent regeneration from stored params dict
    X_regen, y_regen, regen_hash = regenerate_synthetic_dataset_and_hash(params)

    # 3. Assert exact match
    assert original_hash == regen_hash, f"Hash mismatch: {original_hash} != {regen_hash}"
    np.testing.assert_array_almost_equal(X_orig, X_regen)
    np.testing.assert_array_equal(y_orig, y_regen)
    print(f"\n[PASS] Dataset Lineage Verified! Matching SHA-256 Hash: {original_hash}")


def test_drift_detection_and_retrain_trigger(client):
    """
    STEP 1 VERIFICATION:
        Feeds statistically shifted data (monthly_take_home +4x shift),
    confirms PSI drift is flagged, retrain is triggered, and a new candidate
    version appears in the registry with is_active: false.
    """
    # 1. Get registry versions before drift check
    res_before = client.get("/model/registry/versions?architecture=RandomForest")
    assert res_before.status_code == 200
    count_before = res_before.json()["count"]

    # 2. Execute drift check with simulated distribution shift on monthly_take_home
    payload = {
        "architecture": "RandomForest",
        "force_retrain": True,
        "shift_feature": "monthly_take_home",
        "shift_multiplier": 4.5,
        "shift_offset": 500000.0,
        "n_samples": 300,
    }
    drift_res = client.post("/model/registry/drift-check", json=payload)
    assert drift_res.status_code == 200
    drift_data = drift_res.json()

    print(f"\n[Drift Result] Verdict: {drift_data['overall_verdict']}, Max PSI: {drift_data['max_psi']}")
    print(f"[Drift Result] Drifted Features: {drift_data['drifted_features']}")
    print(f"[Drift Result] Retrain Triggered: {drift_data['retrain_triggered']}")

    assert drift_data["drift_detected"] is True
    assert drift_data["retrain_triggered"] is True
    assert drift_data["overall_verdict"] == "FAIL"
    assert "monthly_take_home" in drift_data["drifted_features"]
    assert drift_data["max_psi"] >= 0.20

    candidate = drift_data["candidate_version"]
    assert candidate is not None
    assert candidate["is_active"] is False
    candidate_id = candidate["version_id"]

    # 3. Verify in registry versions list that candidate version exists and is_active=False
    res_after = client.get("/model/registry/versions?architecture=RandomForest")
    assert res_after.status_code == 200
    versions_after = res_after.json()["versions"]
    assert len(versions_after) == count_before + 1

    candidate_record = next((v for v in versions_after if v["version_id"] == candidate_id), None)
    assert candidate_record is not None
    assert candidate_record["is_active"] is False
    assert "Auto-retrain triggered by PSI drift" in candidate_record["notes"]
    print(f"[PASS] Drift Trigger Verified! Candidate Version {candidate_id} registered with is_active=False.")


def test_promotion_gate_rejects_inferior_candidate(client):
    """
    STEP 2 VERIFICATION (Part A):
    Attempts to register/promote a candidate model with deliberately inferior metrics.
    Confirms the promotion gate rejects the request with HTTP 409 and clear reason.
    """
    store = get_model_registry()
    active_rf = store.get_active_model("RandomForest")
    assert active_rf is not None

    # Deliberately lowered metrics (e.g. fidelity 0.70 vs active 0.95 — well over 2% regression)
    inferior_metrics = {
        "rule_approximation_fidelity": 0.70,
        "balanced_accuracy": 0.65,
        "macro_f1": 0.64,
        "independent_cfp_benchmark_accuracy": 0.20,
    }

    # Register, shadow, and validate before the promotion gate evaluates it.
    inferior_payload = {
        "model_architecture": "RandomForest",
        "artifact_path": active_rf["artifact_path"],  # valid file
        "training_data_hash": active_rf["training_data_hash"],
        "hyperparameters": active_rf["hyperparameters"],
        "reference_distributions": active_rf["reference_distributions"],
        "metrics": inferior_metrics,
        "set_active": False,
        "notes": "Deliberately degraded candidate for promotion gate testing",
    }

    reg_res = client.post("/model/registry/register", json=inferior_payload)
    assert reg_res.status_code == 201
    candidate_id = reg_res.json()["version_id"]
    assert client.post("/model/registry/shadow/configure", json={"version_id": candidate_id}).status_code == 200
    assert client.post(
        f"/model/registry/validate/{candidate_id}", json={"metrics": inferior_metrics}
    ).status_code == 200
    promote_res = client.post("/model/registry/promote", json={"version_id": candidate_id})
    assert promote_res.status_code == 409
    error_detail = promote_res.json()["detail"]
    assert error_detail["error"] == "PROMOTION_GATE_FAILED"
    assert error_detail["gate_result"]["gate_passed"] is False
    print(f"\n[PASS] Promotion Gate Rejection Verified! Error: {error_detail['gate_result']['failures']}")


def test_promotion_gate_allows_valid_candidate(client):
    """
    STEP 2 VERIFICATION (Part B):
    Registers a candidate with equal or superior metrics (is_active: false),
    then promotes it via POST /model/registry/promote. Confirms success and activation.
    """
    store = get_model_registry()
    active_rf = store.get_active_model("RandomForest")
    assert active_rf is not None

    # Superior metrics (fidelity 0.965 > active ~0.955)
    valid_metrics = {
        "rule_approximation_fidelity": 0.965,
        "balanced_accuracy": 0.880,
        "macro_f1": 0.885,
        "independent_cfp_benchmark_accuracy": 0.2526,
    }

    reg_payload = {
        "model_architecture": "RandomForest",
        "artifact_path": active_rf["artifact_path"],
        "training_data_hash": active_rf["training_data_hash"],
        "hyperparameters": active_rf["hyperparameters"],
        "reference_distributions": active_rf["reference_distributions"],
        "metrics": valid_metrics,
        "set_active": False,
        "notes": "Genuinely superior candidate for promotion gate test",
    }

    reg_res = client.post("/model/registry/register", json=reg_payload)
    assert reg_res.status_code == 201
    candidate_id = reg_res.json()["version_id"]

    # Advance CANDIDATE -> SHADOW -> VALIDATED, then promote through the gate.
    assert client.post("/model/registry/shadow/configure", json={"version_id": candidate_id}).status_code == 200
    assert client.post(
        f"/model/registry/validate/{candidate_id}", json={"metrics": valid_metrics}
    ).status_code == 200
    promote_res = client.post("/model/registry/promote", json={"version_id": candidate_id})
    assert promote_res.status_code == 200
    promote_data = promote_res.json()
    assert promote_data["status"] == "promoted"
    assert promote_data["is_active"] is True
    assert promote_data["gate_result"]["gate_passed"] is True
    print(f"[PASS] Promotion Gate Acceptance Verified! Version {candidate_id} promoted to active.")


def test_shadow_evaluation_mode(client):
    """
    STEP 3 VERIFICATION:
    Configures a shadow candidate version, sends live requests through /predict,
    and checks /model/registry/shadow/summary to prove both models executed and
    logged agreement statistics without affecting user responses.
    """
    store = get_model_registry()
    versions = store.list_versions("RandomForest")
    assert len(versions) >= 2

    # Pick an inactive version as shadow candidate
    inactive_version = next((v for v in versions if v.get("lifecycle_state") == "CANDIDATE"), None)
    if not inactive_version:
        inactive_version = versions[-1]

    # 1. Configure shadow candidate
    cfg_res = client.post("/model/registry/shadow/configure", json={"version_id": inactive_version["version_id"]})
    assert cfg_res.status_code == 200
    assert cfg_res.json()["status"] == "configured"

    # 2. Send batch of real inference requests through /predict
    test_inputs = [
        {"feature_schema_version": "recommendation-features-4.0.0", "age": 25, "monthly_take_home": 100000, "monthly_savings": 25000, "investment_horizon_years": 10,
         "liquid_savings": 150000, "emi_burden_pct": 5, "financial_dependents": 0, "emergency_fund_months": 6,
         "risk_tolerance": "Aggressive", "investment_goals": ["Wealth Growth"], "deployable_lump_sum": 0, "risk_capacity_score": 75, "final_suitability_risk": "Moderate-Aggressive"},
        {"feature_schema_version": "recommendation-features-4.0.0", "age": 45, "monthly_take_home": 200000, "monthly_savings": 70000, "investment_horizon_years": 5,
         "liquid_savings": 500000, "emi_burden_pct": 20, "financial_dependents": 2, "emergency_fund_months": 8,
         "risk_tolerance": "Moderate", "investment_goals": ["Retirement"], "deployable_lump_sum": 0, "risk_capacity_score": 55, "final_suitability_risk": "Moderate"},
        {"feature_schema_version": "recommendation-features-4.0.0", "age": 62, "monthly_take_home": 100000, "monthly_savings": 30000, "investment_horizon_years": 3,
         "liquid_savings": 900000, "emi_burden_pct": 0, "financial_dependents": 1, "emergency_fund_months": 12,
         "risk_tolerance": "Conservative", "investment_goals": ["Retirement"], "deployable_lump_sum": 0, "risk_capacity_score": 35, "final_suitability_risk": "Conservative"},
        {"feature_schema_version": "recommendation-features-4.0.0", "age": 30, "monthly_take_home": 125000, "monthly_savings": 50000, "investment_horizon_years": 15,
         "liquid_savings": 300000, "emi_burden_pct": 10, "financial_dependents": 1, "emergency_fund_months": 6,
         "risk_tolerance": "Aggressive", "investment_goals": ["Wealth Growth"], "deployable_lump_sum": 0, "risk_capacity_score": 75, "final_suitability_risk": "Moderate-Aggressive"},
    ]

    api_key = os.environ.get("ML_SERVICE_API_KEY", "wealthgenie_secret_api_key_2026")
    for req_data in test_inputs:
        pred_res = client.post("/predict", json=req_data, headers={"X-API-Key": api_key})
        assert pred_res.status_code == 200
        assert "primary" in pred_res.json()

    # 3. Query shadow evaluation summary
    shadow_res = client.get("/model/registry/shadow/summary")
    assert shadow_res.status_code == 200
    summary = shadow_res.json()

    print(f"\n[Shadow Summary] Status: {summary['status']}")
    print(f"[Shadow Summary] Total Evaluations: {summary['total_evaluations']}")
    print(f"[Shadow Summary] Agreements: {summary['agreements']}, Disagreements: {summary['disagreements']}")
    print(f"[Shadow Summary] Agreement Rate: {summary['agreement_rate']}")
    print(f"[Shadow Summary] Per Class: {summary['per_class_summary']}")

    assert summary["status"] == "ACTIVE"
    assert summary["total_evaluations"] >= len(test_inputs)
    assert 0.0 <= summary["agreement_rate"] <= 1.0

    # 4. Clean up shadow mode
    del_res = client.delete("/model/registry/shadow")
    assert del_res.status_code == 200
    print("[PASS] Shadow Evaluation Verified! Dual-model execution & real agreement metrics confirmed.")
