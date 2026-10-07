"""Non-skipping API proof for active registry-backed model inference."""

from pathlib import Path
import shutil

from fastapi.testclient import TestClient

import main
from model.artifacts.store import LocalArtifactStore
from model.data.feature_engineering import FEATURE_SCHEMA_VERSION
from model.registry.registry_store import ModelRegistry
from model.serving.registry import registry
from scripts.verify_serving_artifacts import verify_trusted_serving_bundles


API_KEY = "registry-backed-prediction-test-key"
OPERATOR_KEY = "registry-backed-operator-test-key"


def _canonical_payload():
    return {
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


def test_enriched_prediction_uses_the_registry_active_trusted_bundle(tmp_path, monkeypatch):
    monkeypatch.setenv("ENVIRONMENT", "local")
    monkeypatch.setenv("ML_STATE_BACKEND", "local")
    monkeypatch.delenv("MONGODB_URI", raising=False)
    monkeypatch.setenv("ML_SERVICE_API_KEY", API_KEY)
    monkeypatch.setenv("ML_OPERATOR_KEY", OPERATOR_KEY)

    original_predictors = dict(registry._registry)
    original_version_registry = registry.get_version_registry()
    original_globals = {
        name: getattr(main, name)
        for name in (
            "model", "label_encoder", "model_accuracy", "confidence_threshold",
            "git_commit_hash", "model_version", "dataset_version", "explainer_instance",
        )
    }
    original_app_registry = getattr(main.app.state, "version_registry", None)
    registry_store = ModelRegistry(tmp_path / "registry.sqlite")
    artifact_store = LocalArtifactStore(tmp_path / "artifacts")
    registry_store.artifact_store = artifact_store
    materialized_predictors = []
    try:
        trusted_bundles = verify_trusted_serving_bundles(Path(__file__).resolve().parents[1])
        active_records = registry_store.bootstrap_verified_bundles(trusted_bundles, artifact_store)
        active_rf = active_records["RandomForest"]
        assert active_rf["metrics"]["rule_approximation_fidelity"] is not None

        monkeypatch.setattr(main, "get_model_registry", lambda: registry_store)
        import rag.seed_knowledge
        monkeypatch.setattr(rag.seed_knowledge, "seed_default_knowledge_base", lambda: None)

        with TestClient(main.app) as client:
            predictor = registry.get("random_forest")
            assert predictor is not None and predictor.is_loaded
            materialized_predictors = list({id(value): value for value in registry._registry.values()}.values())
            assert predictor.loaded_version_id == active_rf["version_id"]
            assert predictor.loaded_bundle_id == active_rf["bundle_id"]
            assert predictor.loaded_bundle_hash == active_rf["bundle_manifest_sha256"]
            assert predictor.loaded_feature_schema_version == active_rf["feature_schema_version"]
            assert predictor.loaded_activation_generation == active_rf["activation_generation"]

            original_predict = predictor.predict
            calls = []

            def observed_predict(features):
                result = original_predict(features)
                calls.append(result)
                return result

            monkeypatch.setattr(predictor, "predict", observed_predict)
            response = client.post(
                "/predict/enriched",
                json=_canonical_payload(),
                headers={"X-API-Key": API_KEY},
            )
            assert response.status_code == 200, response.text
            body = response.json()
            assert len(calls) == 1
            assert body["model_used"] == "RandomForest"
            assert body["model_version"] == active_rf["version_id"]
            assert body["feature_schema_version"] == FEATURE_SCHEMA_VERSION
            assert {body["primary"], body["secondary"], body["tertiary"]} == {
                calls[0]["primary"], calls[0]["secondary"], calls[0]["tertiary"],
            }
            assert len({body["primary"], body["secondary"], body["tertiary"]}) == 3

            stale = _canonical_payload()
            stale["feature_schema_version"] = "recommendation-features-3.0.0"
            rejected = client.post("/predict/enriched", json=stale, headers={"X-API-Key": API_KEY})
            assert rejected.status_code == 422
            assert len(calls) == 1
    finally:
        for predictor in materialized_predictors:
            materialized = getattr(predictor, "_materialized_bundle_dir", None)
            if materialized:
                shutil.rmtree(materialized, ignore_errors=True)
        registry._registry.clear()
        registry._registry.update(original_predictors)
        registry.set_version_registry(original_version_registry)
        for name, value in original_globals.items():
            setattr(main, name, value)
        if original_app_registry is not None:
            main.app.state.version_registry = original_app_registry
        elif hasattr(main.app.state, "version_registry"):
            delattr(main.app.state, "version_registry")
        registry_store.close()
