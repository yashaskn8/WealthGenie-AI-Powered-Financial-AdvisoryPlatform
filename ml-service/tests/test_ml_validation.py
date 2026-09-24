"""Financial Profile v4 serving-contract and feature-parity tests."""

import json
import os
from pathlib import Path
from types import SimpleNamespace

import numpy as np
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from pydantic import ValidationError

from main import app, build_model_input, get_decision_path_description, get_live_model_version
from model.data.feature_engineering import FEATURE_NAMES, FEATURE_SCHEMA_VERSION, engineer_features, to_model_array
from model.serving.inference import RandomForestPredictor
from model.serving.registry import registry
from schemas import PredictRequest

API_KEY = "wealthgenie_secret_api_key_2026"


def canonical_payload(**overrides):
    payload = {
        "feature_schema_version": FEATURE_SCHEMA_VERSION,
        "age": 34,
        "monthly_take_home": 150_000.0,
        "monthly_savings": 45_000.0,
        "liquid_savings": 500_000.0,
        "emi_burden_pct": 12.0,
        "financial_dependents": 1,
        "emergency_fund_months": 6.0,
        "risk_tolerance": "Moderate",
        "investment_goals": ["Wealth Growth"],
        "investment_horizon_years": 15,
        "deployable_lump_sum": 0.0,
        "risk_capacity_score": 55,
        "final_suitability_risk": "Moderate",
    }
    payload.update(overrides)
    return payload


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as test_client:
        yield test_client


def test_predict_request_rejects_monthly_savings_at_or_above_take_home():
    with pytest.raises(ValidationError, match="monthly_savings must be less"):
        PredictRequest.model_validate(canonical_payload(monthly_savings=150_000.0))


def test_predict_request_accepts_positive_values_below_legacy_ui_minimums():
    request = PredictRequest.model_validate(canonical_payload(
        monthly_take_home=1.0,
        monthly_savings=0.5,
    ))
    assert request.monthly_take_home == 1.0
    assert request.monthly_savings == 0.5


@pytest.mark.parametrize(
    "legacy_field,value",
    [
        ("annual_income", 1_800_000),
        ("total_ctc", 2_000_000),
        ("existing_debt", 12),
        ("goal_type", "wealth-building"),
        ("tax_regime", "new"),
        ("sold_property_proceeds", 1_000_000),
    ],
)
def test_predict_request_rejects_unauthorized_or_non_deployable_features(legacy_field, value):
    with pytest.raises(ValidationError):
        PredictRequest.model_validate({**canonical_payload(), legacy_field: value})


def test_feature_parity_train_inference_is_exact():
    request = PredictRequest.model_validate(canonical_payload())
    direct = engineer_features(
        age=request.age,
        monthly_take_home=request.monthly_take_home,
        monthly_savings=request.monthly_savings,
        investment_horizon_years=request.investment_horizon_years,
        liquid_savings=request.liquid_savings,
        emi_burden_pct=request.emi_burden_pct,
        financial_dependents=request.financial_dependents,
        emergency_fund_months=request.emergency_fund_months,
        deployable_lump_sum=request.deployable_lump_sum,
        risk_capacity_score=request.risk_capacity_score,
        risk_tolerance=request.risk_tolerance,
        final_suitability_risk=request.final_suitability_risk,
        investment_goals=request.investment_goals,
    )
    served_features, served_array = build_model_input(request)
    assert list(direct) == FEATURE_NAMES
    assert direct == served_features
    np.testing.assert_array_equal(to_model_array(direct), served_array)


def test_model_input_rejects_arbitrary_feature_spread():
    features = engineer_features(
        age=34, monthly_take_home=150_000, monthly_savings=45_000,
        investment_horizon_years=15, liquid_savings=500_000,
        emi_burden_pct=12, financial_dependents=1, emergency_fund_months=6,
        deployable_lump_sum=0, risk_capacity_score=55,
        risk_tolerance="Moderate", final_suitability_risk="Moderate",
        investment_goals=["Wealth Growth"],
    )
    with pytest.raises(ValueError, match="unexpected"):
        to_model_array({**features, "annual_income": 1_800_000})


def test_api_key_security_unauthorized(client, monkeypatch):
    monkeypatch.setenv("ML_SERVICE_API_KEY", API_KEY)
    response = client.post("/predict", json=canonical_payload())
    assert response.status_code == 401
    response = client.post("/predict", json=canonical_payload(), headers={"X-API-Key": "wrong"})
    assert response.status_code == 401


def test_predict_endpoint_accepts_v4_and_rejects_v3(client, monkeypatch):
    predictor = registry.get("random_forest")
    if predictor is None or not predictor.is_loaded:
        pytest.skip("RandomForest artifact is unavailable")
    monkeypatch.setenv("ML_SERVICE_API_KEY", API_KEY)
    headers = {"X-API-Key": API_KEY}
    response = client.post("/predict/enriched", json=canonical_payload(), headers=headers)
    assert response.status_code == 200
    body = response.json()
    assert body["feature_schema_version"] == FEATURE_SCHEMA_VERSION
    assert body["model_version"]
    assert len({body["primary"], body["secondary"], body["tertiary"]}) == 3

    stale = canonical_payload()
    stale["feature_schema_version"] = "recommendation-features-3.0.0"
    assert client.post("/predict", json=stale, headers=headers).status_code == 422


def test_random_forest_probability_indices_use_encoder_class_order():
    """Regression: sklearn's alphabetic encoder order must not be remapped to a hardcoded order."""
    predictor = RandomForestPredictor()
    predictor.load_artifacts()
    if not predictor.is_loaded:
        pytest.skip("RandomForest artifact is unavailable")
    request = PredictRequest.model_validate(canonical_payload())
    _, model_input = build_model_input(request)
    probabilities = predictor.predict_proba(model_input)[0]
    model_class = predictor.model.classes_[int(np.argmax(probabilities))]
    expected = str(predictor.label_encoder.inverse_transform([model_class])[0])
    assert predictor.predict(model_input)["primary"] == expected


def test_decision_path_discloses_only_approved_suitability_facts():
    path = get_decision_path_description(PredictRequest.model_validate(canonical_payload()))
    joined = " ".join(path)
    assert "final_suitability_risk=Moderate" in joined
    assert "risk_capacity_score=55" in joined
    assert "annual_income" not in joined
    assert "tax" not in joined.lower()


def test_metadata_is_versioned_and_matches_exact_feature_order():
    metadata = json.loads((Path(__file__).parents[1] / "model" / "metadata.json").read_text(encoding="utf-8"))
    assert metadata["model_version"].startswith("4.")
    assert metadata["feature_schema_version"] == FEATURE_SCHEMA_VERSION
    assert metadata["feature_names"] == FEATURE_NAMES
    assert metadata["n_features"] == len(FEATURE_NAMES)
    assert metadata["metric_interpretation"] == "policy-approximation fidelity, not investment outcome accuracy"


def test_health_exposes_feature_schema_version(client):
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["feature_schema_version"] == FEATURE_SCHEMA_VERSION


def test_prediction_version_comes_from_loaded_predictor_and_rejects_registry_drift(monkeypatch):
    predictor = SimpleNamespace(loaded_version_id="version-A")

    class VersionStore:
        def __init__(self, active_id):
            self.active_id = active_id

        def get_active_model(self, _architecture):
            return {"version_id": self.active_id}

    monkeypatch.setattr(registry, "get_version_registry", lambda: VersionStore("version-A"))
    assert get_live_model_version("RandomForest", predictor, "baseline") == "version-A"

    monkeypatch.setattr(registry, "get_version_registry", lambda: VersionStore("version-B"))
    with pytest.raises(HTTPException) as error:
        get_live_model_version("RandomForest", predictor, "baseline")
    assert error.value.status_code == 503
    assert error.value.detail["code"] == "MODEL_VERSION_RECONCILIATION_REQUIRED"


def test_prediction_version_fails_closed_when_active_registry_cannot_be_read(monkeypatch):
    predictor = SimpleNamespace(loaded_version_id="version-A")

    class BrokenVersionStore:
        def get_active_model(self, _architecture):
            raise RuntimeError("registry unavailable")

    monkeypatch.setattr(registry, "get_version_registry", lambda: BrokenVersionStore())
    with pytest.raises(HTTPException) as error:
        get_live_model_version("RandomForest", predictor, "baseline")
    assert error.value.status_code == 503
    assert error.value.detail["code"] == "MODEL_VERSION_RECONCILIATION_REQUIRED"


def test_fail_closed_auth_when_api_key_unset(client):
    old_key = os.environ.pop("ML_SERVICE_API_KEY", None)
    old_env = os.environ.get("ENVIRONMENT")
    try:
        os.environ["ENVIRONMENT"] = "production"
        response = client.post("/predict", json=canonical_payload())
        assert response.status_code == 500
        assert "Server Misconfiguration" in response.json()["detail"]
    finally:
        if old_key is not None:
            os.environ["ML_SERVICE_API_KEY"] = old_key
        if old_env is not None:
            os.environ["ENVIRONMENT"] = old_env
        else:
            os.environ.pop("ENVIRONMENT", None)
