import copy
import json
from pathlib import Path

import numpy as np
import pandas as pd
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sklearn.preprocessing import StandardScaler

from market_context import FEATURE_SCHEMA_VERSION
from market_context.drift import drift_diagnostics
from market_context.features import (
    FEATURE_NAMES,
    _canonical_dataset_hash,
    build_feature_frame,
)
from market_context.hmm_model import (
    align_states,
    causal_filter,
    state_permutation,
    train_gaussian_hmm,
)
from market_context.registry import (
    ArtifactValidationError,
    load_shadow_artifact,
    write_shadow_artifact,
)
from market_context.router import market_context_router
from market_context.splits import expanding_walk_forward_plan, fit_training_scaler


def normalized_dataset(count=760):
    dates = pd.bdate_range("2022-01-03", periods=count)
    rows = []
    for index, date in enumerate(dates):
        close = 17000 + (index * 3.0) + (80 * np.sin(index / 17))
        vix = 14 + (2 * np.cos(index / 23))
        observed_at = f"{date.strftime('%Y-%m-%d')}T10:00:00.000Z"
        rows.append({
            "effectiveTradingDate": date.strftime("%Y-%m-%d"),
            "nifty50": {
                "open": close - 5,
                "high": close + 10,
                "low": close - 10,
                "close": close,
                "observedAt": observed_at,
            },
            "indiaVix": {
                "open": vix - 0.1,
                "high": vix + 0.2,
                "low": vix - 0.2,
                "close": vix,
                "observedAt": observed_at,
            },
        })
    dataset = {
        "schemaVersion": "market-regime-dataset-1.0.0",
        "marketDataSchemaVersion": "market-fact-1.0.0",
        "datasetVersion": "test-market-regime-dataset",
        "retrievedAt": "2026-01-01T00:00:00.000Z",
        "period": {"start": rows[0]["effectiveTradingDate"], "end": rows[-1]["effectiveTradingDate"]},
        "rowCount": len(rows),
        "missingObservations": {
            "nifty50WithoutIndiaVix": 0,
            "indiaVixWithoutNifty50": 0,
            "policy": "INNER_JOIN_NO_IMPUTATION_NO_FORWARD_FILL",
        },
        "source": {
            "provider": "NSE",
            "qualification": "TEST_NORMALIZED_PROVIDER_FIXTURE",
            "dataClass": "DAILY",
            "instruments": [],
        },
        "rows": rows,
    }
    dataset["contentHash"] = _canonical_dataset_hash(dataset)
    return dataset


def synthetic_hmm_matrix(row_count=360, dimensions=8):
    generator = np.random.default_rng(73)
    first = generator.normal(-1.5, 0.25, size=(row_count // 2, dimensions))
    second = generator.normal(1.5, 0.3, size=(row_count - len(first), dimensions))
    return np.vstack([first, second])


def artifact_metadata():
    return {
        "modelFamily": "GAUSSIAN_HMM",
        "modelVersion": "test-gaussian-hmm-1.0.0",
        "featureSchemaVersion": FEATURE_SCHEMA_VERSION,
        "datasetVersion": "test-market-regime-dataset",
        "datasetHashSha256": "a" * 64,
        "trainingStart": "2022-01-03",
        "trainingEnd": "2024-01-01",
        "trainingRowCount": 300,
        "hyperparameters": {"stateCount": 2, "covarianceType": "diag"},
        "seed": 17,
        "preprocessing": {"kind": "STANDARD_SCALER", "fitBoundary": "TRAIN_ONLY"},
        "validationMetrics": {},
        "holdoutMetrics": {},
        "pythonVersion": "test",
        "libraryVersions": {},
        "createdAt": "2026-01-01T00:00:00Z",
        "qualificationStatus": "QUALIFIED_FOR_SHADOW_OBSERVATION_ONLY",
        "role": "SHADOW",
        "semanticLabels": None,
        "calibratedProbabilities": False,
        "controlsAllocation": False,
    }


def create_artifact(directory: Path):
    values = synthetic_hmm_matrix()
    scaler = StandardScaler().fit(values[:300])
    model = train_gaussian_hmm(scaler.transform(values[:300]), 2, 17)
    return write_shadow_artifact(
        directory,
        model=model,
        scaler=scaler,
        feature_names=FEATURE_NAMES,
        reference_features=values[:300],
        metadata=artifact_metadata(),
    )


def test_features_require_chronological_normalized_observations():
    dataset = normalized_dataset(260)
    frame = build_feature_frame(dataset)
    assert list(frame.columns).count("daily_log_return") == 1
    assert len(frame) == 61
    assert tuple(frame.loc[:, list(FEATURE_NAMES)].columns) == FEATURE_NAMES

    reversed_dataset = copy.deepcopy(dataset)
    reversed_dataset["rows"][20], reversed_dataset["rows"][21] = (
        reversed_dataset["rows"][21], reversed_dataset["rows"][20]
    )
    reversed_dataset["contentHash"] = _canonical_dataset_hash(reversed_dataset)
    with pytest.raises(ValueError, match="STRICTLY_CHRONOLOGICAL"):
        build_feature_frame(reversed_dataset)


def test_future_rows_cannot_change_previously_computed_features():
    complete = normalized_dataset(320)
    prefix = copy.deepcopy(complete)
    prefix["rows"] = prefix["rows"][:280]
    prefix["rowCount"] = len(prefix["rows"])
    prefix["period"]["end"] = prefix["rows"][-1]["effectiveTradingDate"]
    prefix["contentHash"] = _canonical_dataset_hash(prefix)
    prefix_frame = build_feature_frame(prefix)
    complete_frame = build_feature_frame(complete)
    overlapping = complete_frame[
        complete_frame["effective_trading_date"] <= prefix_frame.iloc[-1]["effective_trading_date"]
    ]
    np.testing.assert_allclose(
        prefix_frame.loc[:, list(FEATURE_NAMES)],
        overlapping.loc[:, list(FEATURE_NAMES)],
        rtol=0,
        atol=0,
    )


def test_walk_forward_boundaries_scaler_and_final_holdout_are_isolated():
    values = np.arange(700 * 2, dtype=float).reshape(700, 2)
    plan = expanding_walk_forward_plan(
        len(values), minimum_train_sessions=300, validation_sessions=100, holdout_sessions=100
    )
    assert plan.holdout_start == 600
    assert all(fold.validation_end <= plan.holdout_start for fold in plan.folds)
    assert all(fold.train_end <= fold.validation_start for fold in plan.folds)
    scaler, _, validation = fit_training_scaler(values, plan.folds[0])
    np.testing.assert_allclose(scaler.mean_, values[:300].mean(axis=0))
    modified = values.copy()
    modified[300:] = 1e12
    modified_scaler, _, modified_validation = fit_training_scaler(modified, plan.folds[0])
    np.testing.assert_allclose(modified_scaler.mean_, scaler.mean_)
    assert not np.array_equal(validation, modified_validation)


def test_hmm_converges_and_online_filter_is_future_invariant():
    values = synthetic_hmm_matrix(row_count=360, dimensions=3)
    model = train_gaussian_hmm(values[:280], 2, 17)
    assert model.monitor_.converged is True
    prefix_probabilities, prefix_states, _ = causal_filter(model, values[:300])
    full_probabilities, full_states, _ = causal_filter(model, values)
    np.testing.assert_allclose(prefix_probabilities, full_probabilities[:300], rtol=0, atol=0)
    np.testing.assert_array_equal(prefix_states, full_states[:300])


def test_state_stability_is_permutation_aware():
    reference = np.asarray([[-1.0, -2.0], [2.0, 1.0], [0.0, 3.0]])
    candidate = reference[[2, 0, 1]]
    permutation = state_permutation(reference, candidate)
    candidate_states = np.asarray([0, 1, 2, 0])
    assert tuple(permutation) == (2, 0, 1)
    np.testing.assert_array_equal(align_states(candidate_states, permutation), [2, 0, 1, 2])


def test_artifact_round_trip_checksum_and_schema_guards(tmp_path):
    artifact_path, registry_path, registry = create_artifact(tmp_path / "valid")
    loaded = load_shadow_artifact(registry_path)
    assert loaded.metadata["role"] == "SHADOW"
    assert loaded.feature_names == FEATURE_NAMES
    assert registry["champion"]["modelVersion"] == "market-context-policy-1.0.0"
    assert artifact_path.is_file()

    corrupt_directory = tmp_path / "corrupt"
    corrupt_artifact, corrupt_registry, _ = create_artifact(corrupt_directory)
    corrupt_artifact.write_bytes(corrupt_artifact.read_bytes() + b"corruption")
    with pytest.raises(ArtifactValidationError, match="CHECKSUM_MISMATCH"):
        load_shadow_artifact(corrupt_registry)

    mismatch_directory = tmp_path / "mismatch"
    _, mismatch_registry, _ = create_artifact(mismatch_directory)
    payload = json.loads(mismatch_registry.read_text(encoding="utf-8"))
    payload["models"][0]["featureSchemaVersion"] = "stale-feature-schema"
    mismatch_registry.write_text(json.dumps(payload), encoding="utf-8")
    with pytest.raises(ArtifactValidationError, match="FEATURE_SCHEMA_MISMATCH"):
        load_shadow_artifact(mismatch_registry)

    dataset_mismatch_directory = tmp_path / "dataset-mismatch"
    _, dataset_mismatch_registry, _ = create_artifact(dataset_mismatch_directory)
    payload = json.loads(dataset_mismatch_registry.read_text(encoding="utf-8"))
    payload["models"][0]["datasetVersion"] = "different-dataset-version"
    dataset_mismatch_registry.write_text(json.dumps(payload), encoding="utf-8")
    with pytest.raises(ArtifactValidationError, match="DATASET_VERSION_MISMATCH"):
        load_shadow_artifact(dataset_mismatch_registry)

    with pytest.raises(ArtifactValidationError, match="REGISTRY_MISSING"):
        load_shadow_artifact(tmp_path / "absent" / "registry.json")


def test_shadow_endpoint_is_authenticated_numeric_and_non_authoritative(tmp_path, monkeypatch):
    _, registry_path, _ = create_artifact(tmp_path / "endpoint")
    monkeypatch.setenv("ENVIRONMENT", "test")
    monkeypatch.setenv("ML_SERVICE_API_KEY", "phase4-test-key")
    monkeypatch.setenv("MARKET_CONTEXT_SHADOW_REGISTRY_PATH", str(registry_path))
    app = FastAPI()
    app.include_router(market_context_router)
    client = TestClient(app)
    request = {"featureSchemaVersion": FEATURE_SCHEMA_VERSION, "dataset": normalized_dataset(260)}
    assert client.post("/market-context/shadow", json=request).status_code == 401
    response = client.post(
        "/market-context/shadow", json=request, headers={"X-API-Key": "phase4-test-key"}
    )
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "MODEL_CONTEXT_AVAILABLE"
    assert body["role"] == "SHADOW"
    assert body["state"] in {"STATE_0", "STATE_1"}
    assert body["semanticContext"] is None
    assert body["probabilities"] is None
    assert "SHADOW_ONLY_NO_RECOMMENDATION_AUTHORITY" in body["reasonCodes"]

    stale = client.post(
        "/market-context/shadow",
        json={**request, "featureSchemaVersion": "stale"},
        headers={"X-API-Key": "phase4-test-key"},
    )
    assert stale.status_code == 422


def test_missing_shadow_artifact_fails_closed_without_inventing_context(tmp_path, monkeypatch):
    monkeypatch.setenv("ENVIRONMENT", "test")
    monkeypatch.setenv("ML_SERVICE_API_KEY", "phase4-test-key")
    monkeypatch.setenv("MARKET_CONTEXT_SHADOW_REGISTRY_PATH", str(tmp_path / "missing.json"))
    app = FastAPI()
    app.include_router(market_context_router)
    response = TestClient(app).post(
        "/market-context/shadow",
        json={"featureSchemaVersion": FEATURE_SCHEMA_VERSION, "dataset": normalized_dataset(260)},
        headers={"X-API-Key": "phase4-test-key"},
    )
    assert response.status_code == 200
    assert response.json()["status"] == "MODEL_CONTEXT_UNAVAILABLE"
    assert response.json()["state"] is None
    assert "DETERMINISTIC_CHAMPION_UNCHANGED" in response.json()["reasonCodes"]


def test_drift_is_diagnostic_only_and_never_requests_retraining():
    reference = synthetic_hmm_matrix(300)
    observed = reference[-40:] + 0.5
    result = drift_diagnostics(reference, observed, FEATURE_NAMES)
    assert result["classification"] == "DRIFT_MONITORING_DIAGNOSTIC"
    assert result["thresholdStatus"] is None
    assert result["available"] is True
    assert "RAW_DRIFT_METRICS_ONLY_NO_AUTOMATIC_ACTION" in result["reasonCodes"]
    assert all("populationStabilityIndex" in metrics for metrics in result["metrics"].values())


def test_no_supervised_target_or_calibration_is_synthesized():
    source = Path(__file__).parents[1] / "market_context" / "qualification.py"
    text = source.read_text(encoding="utf-8")
    assert "XGBOOST_SUPERVISED_LABELS_NOT_QUALIFIED" in text
    assert "train_test_split" not in text
    assert "IsotonicRegression" not in text
    assert "CalibratedClassifierCV" not in text
