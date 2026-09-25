"""Governance tests for drift diagnostics and fail-closed model lifecycle gates."""

import os

import numpy as np
import pandas as pd
import pytest
from fastapi.testclient import TestClient

from main import app
from model.data.feature_engineering import FEATURE_NAMES, FEATURE_SCHEMA_VERSION
from model.data.preprocessing import (
    compute_dataset_hash_from_arrays,
    get_dataset_generation_params,
    prepare_synthetic_training_data,
    regenerate_synthetic_dataset_and_hash,
)
from model.registry.drift_detection import compute_reference_distributions
from model.registry.drift_monitor import (
    check_drift_and_trigger_retrain,
    generate_synthetic_feature_batch,
)
from model.registry.router import check_promotion_gate, PROMOTION_TRACKED_METRICS, ValidateRequest
from model.serving.registry import registry
from pydantic import ValidationError


def _client():
    return TestClient(
        app,
        headers={
            "X-API-Key": os.environ.get("ML_SERVICE_API_KEY", "wealthgenie_secret_api_key_2026"),
            "X-Operator-Key": os.environ.get("ML_OPERATOR_KEY", "wealthgenie_operator_secret_key_9999"),
        },
    )


def test_dataset_lineage_hash_reproducibility():
    params = get_dataset_generation_params(num_samples=500, seed=1337)
    original_x, original_y = prepare_synthetic_training_data(num_samples=500, seed=1337)
    regenerated_x, regenerated_y, regenerated_hash = regenerate_synthetic_dataset_and_hash(params)

    assert compute_dataset_hash_from_arrays(original_x, original_y) == regenerated_hash
    np.testing.assert_array_almost_equal(original_x, regenerated_x)
    np.testing.assert_array_equal(original_y, regenerated_y)


def test_production_drift_is_diagnostic_only(monkeypatch):
    monkeypatch.setenv("ENVIRONMENT", "production")
    train_x, _ = prepare_synthetic_training_data(num_samples=2_000, seed=42)
    reference = compute_reference_distributions(pd.DataFrame(train_x, columns=FEATURE_NAMES), FEATURE_NAMES)

    class Store:
        def get_active_model(self, architecture):
            return {
                "version_id": "active-fixture",
                "hyperparameters": {"feature_schema_version": FEATURE_SCHEMA_VERSION},
                "reference_distributions": reference,
            }

    def forbidden_retrain(**kwargs):
        pytest.fail("Production drift diagnostics must not retrain or create a candidate")

    monkeypatch.setattr("model.registry.drift_monitor.trigger_candidate_retrain", forbidden_retrain)
    shifted = generate_synthetic_feature_batch(
        n_samples=300, seed=42, shift_feature="monthly_take_home", shift_multiplier=4.5, shift_offset=500000,
    )
    result = check_drift_and_trigger_retrain(
        architecture="RandomForest",
        input_df=shifted,
        store=Store(),
        force_retrain_on_drift=True,
    )
    assert result["drift_detected"] is True
    assert result["retrain_triggered"] is False
    assert result["candidate_version"] is None
    assert result["retrain_suppressed_reason"] == "PRODUCTION_RETRAIN_DISABLED"


def test_promotion_gate_rejects_regressing_candidate_metrics():
    active = {"rule_approximation_fidelity": 0.95, "balanced_accuracy": 0.92, "macro_f1": 0.91}
    candidate = {"rule_approximation_fidelity": 0.70, "balanced_accuracy": 0.65, "macro_f1": 0.64}
    result = check_promotion_gate(candidate, active)
    assert result["gate_passed"] is False
    assert result["failures"]


def test_promotion_gate_accepts_metric_parity_but_does_not_activate():
    metrics = {"rule_approximation_fidelity": 0.95, "balanced_accuracy": 0.92, "macro_f1": 0.91}
    result = check_promotion_gate(metrics, metrics)
    assert result["gate_passed"] is True


def test_operator_cannot_submit_free_floating_validation_metrics():
    with pytest.raises(ValidationError):
        ValidateRequest(metrics={name: 0.99 for name in PROMOTION_TRACKED_METRICS})
    assert ValidateRequest(evaluation_run_id="evaluator-run-1").evaluation_run_id == "evaluator-run-1"


def test_unbundled_candidate_cannot_enter_shadow(tmp_path):
    store = registry.get_version_registry()
    artifact = tmp_path / "raw-model.pkl"
    artifact.write_bytes(b"not-a-bundle")
    version_id = store.register_model(
        model_architecture="RandomForest",
        artifact_path=artifact,
        training_data_hash="a" * 64,
        training_timestamp="2026-09-24T12:00:00+00:00",
        hyperparameters={},
        metrics={name: 0.9 for name in PROMOTION_TRACKED_METRICS},
        set_active=False,
    )
    with _client() as client:
        response = client.post("/model/registry/shadow/configure", json={"version_id": version_id})
    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "MODEL_BUNDLE_NOT_VERIFIED"
    assert store.get_version(version_id)["lifecycle_state"] == "CANDIDATE"
