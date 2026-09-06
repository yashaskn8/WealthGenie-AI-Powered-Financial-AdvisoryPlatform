"""
WealthGenie ML Microservice - FastAPI
Serves RandomForest (TreeSHAP), PyTorch MLP, and FT-Transformer predictions via a unified ModelRegistry.
Integrated with persistent MongoModelRegistry / SQLite ModelRegistry via store_factory.
"""

import hmac
import json
import logging
import os
import time
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Dict, Any, List, Optional

from dotenv import load_dotenv
import numpy as np  # type: ignore[import-not-found]
from fastapi import Depends, FastAPI, HTTPException, Request, Response, Security, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import APIKeyHeader

from model.evaluation.explainer import ModelExplainer
from model.data.feature_engineering import FEATURE_NAMES, FEATURE_SCHEMA_VERSION, engineer_features, to_model_array
from model.serving.inference import RandomForestPredictor, MLPPredictor, FTTransformerPredictor
from model.serving.registry import registry
from store_factory import get_model_registry
from schemas import HealthResponse, PredictRequest, PredictResponse

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s"
)
logger = logging.getLogger("wealthgenie.ml")

from security import API_KEY_NAME, api_key_header, verify_api_key


# Application State & Lifespan
BASE_DIR = Path(__file__).resolve().parent
MODEL_DIR = BASE_DIR / "model"

model = None
label_encoder = None
model_accuracy: float | None = None
confidence_threshold: float = 0.55
git_commit_hash: str = "ffa37ba"
model_version: str = "4.0.0"
dataset_version: str = "4.0.0"
explainer_instance: ModelExplainer | None = None


def _seed_and_resolve_active_models(version_registry) -> None:
    """
    Seeds baseline models into the persistent version registry if empty or paths invalid,
    ensuring tamper-evident lineage is maintained across restarts and replicas.

    MUST be called AFTER model artifacts exist on disk (i.e. after training/loading),
    not before, or it will correctly skip seeding and log the reason.
    """
    logger.info("[Registry Seeding] Starting _seed_and_resolve_active_models...")

    try:
        import pandas as pd
        from model.data.preprocessing import (
            compute_dataset_hash_from_arrays,
            prepare_synthetic_training_data,
        )
        from model.registry.drift_detection import compute_reference_distributions
        reference_x, reference_y = prepare_synthetic_training_data(num_samples=2_000, seed=42)
        data_hash = compute_dataset_hash_from_arrays(reference_x, reference_y)
        ref_dist = compute_reference_distributions(
            pd.DataFrame(reference_x, columns=FEATURE_NAMES), FEATURE_NAMES
        )
        logger.info(
            f"[Registry Seeding] Computed {FEATURE_SCHEMA_VERSION} training data hash: {data_hash[:16]}..."
        )
    except Exception as e:
        raise RuntimeError("Unable to build the versioned v4 registry baseline") from e

    seeded_count = 0

    # --- 1. Seed RandomForest ---
    rf_artifact = MODEL_DIR / "model.pkl"
    if rf_artifact.exists():
        active_rf = version_registry.get_active_model("RandomForest")
        active_schema = (active_rf or {}).get("hyperparameters", {}).get("feature_schema_version")
        active_reference_features = set((active_rf or {}).get("reference_distributions") or {})
        if (active_rf is not None and Path(active_rf["artifact_path"]).exists()
                and active_schema == FEATURE_SCHEMA_VERSION
                and active_reference_features == set(FEATURE_NAMES)):
            logger.info(f"[Registry Seeding] RandomForest already registered and active: {active_rf['version_id']}")
        else:
            reason = "no active version" if active_rf is None else f"artifact path invalid ({active_rf.get('artifact_path')})"
            logger.info(f"[Registry Seeding] Seeding RandomForest baseline ({reason})...")
            meta = {}
            metadata_path = MODEL_DIR / "metadata.json"
            if metadata_path.exists():
                try:
                    with open(metadata_path, "r", encoding="utf-8") as f:
                        meta = json.load(f)
                except Exception as e:
                    logger.warning(f"[Registry Seeding] Failed to read metadata.json: {e}")

            from model.data.preprocessing import get_dataset_generation_params
            lineage_params = meta.get("dataset_lineage") or get_dataset_generation_params(num_samples=2000, seed=42)

            if meta.get("feature_schema_version") != FEATURE_SCHEMA_VERSION or meta.get("feature_names") != FEATURE_NAMES:
                raise ValueError("RandomForest metadata does not match the v4 feature contract")
            missing_metrics = [
                name for name in ("rule_approximation_fidelity", "balanced_accuracy", "macro_f1")
                if meta.get(name) is None
            ]
            if missing_metrics:
                raise ValueError(f"RandomForest metadata lacks promotion evidence: {', '.join(missing_metrics)}")
            fidelity = meta["rule_approximation_fidelity"]
            training_timestamp = meta.get("trained_at", "2026-07-23T19:28:42Z")
            data_hash = meta.get("training_data_hash", data_hash)
            hparams = {
                "n_estimators": 100,
                "max_depth": 12,
                "model_type": "RandomForestClassifier",
                "dataset_lineage": lineage_params,
                "feature_schema_version": FEATURE_SCHEMA_VERSION,
                "feature_names": FEATURE_NAMES,
            }
            metrics = {
                "rule_approximation_fidelity": fidelity,
                "balanced_accuracy": meta["balanced_accuracy"],
                "macro_f1": meta["macro_f1"],
                "metric_interpretation": "policy-approximation fidelity, not investment outcome accuracy",
            }
            try:
                vid = version_registry.register_model(
                    model_architecture="RandomForest",
                    artifact_path=rf_artifact,
                    training_data_hash=data_hash,
                    training_timestamp=training_timestamp,
                    hyperparameters=hparams,
                    metrics=metrics,
                    reference_distributions=ref_dist,
                    notes="Baseline RandomForest model seeded at application startup",
                    set_active=True,
                )
                logger.info(f"[Registry Seeding] ✓ Seeded active RandomForest version {vid}")
                seeded_count += 1
            except Exception as e:
                logger.error(f"[Registry Seeding] ✗ FAILED to seed RandomForest: {type(e).__name__}: {e}", exc_info=True)
    else:
        logger.warning(f"[Registry Seeding] RandomForest artifact NOT FOUND at {rf_artifact} — skipping seed.")

    # --- 2. Seed PyTorch MLP ---
    mlp_artifact = MODEL_DIR / "saved_models" / "mlp_model.pt"
    if mlp_artifact.exists():
        active_mlp = version_registry.get_active_model("PyTorch_MLP")
        active_schema = (active_mlp or {}).get("hyperparameters", {}).get("feature_schema_version")
        active_reference_features = set((active_mlp or {}).get("reference_distributions") or {})
        if (active_mlp is not None and Path(active_mlp["artifact_path"]).exists()
                and active_schema == FEATURE_SCHEMA_VERSION
                and active_reference_features == set(FEATURE_NAMES)):
            logger.info(f"[Registry Seeding] PyTorch_MLP already registered and active: {active_mlp['version_id']}")
        else:
            reason = "no active version" if active_mlp is None else f"artifact path invalid ({active_mlp.get('artifact_path')})"
            logger.info(f"[Registry Seeding] Seeding PyTorch_MLP baseline ({reason})...")
            try:
                vid = version_registry.register_model(
                    model_architecture="PyTorch_MLP",
                    artifact_path=mlp_artifact,
                    training_data_hash=data_hash,
                    training_timestamp="2026-07-30T15:57:00Z",
                    hyperparameters={
                        "input_dim": len(FEATURE_NAMES),
                        "hidden_dims": [64, 32],
                        "output_dim": 6,
                        "feature_schema_version": FEATURE_SCHEMA_VERSION,
                        "feature_names": FEATURE_NAMES,
                    },
                    metrics={"metric_interpretation": "policy-approximation fidelity, not investment outcome accuracy"},
                    reference_distributions=ref_dist,
                    notes="Baseline PyTorch MLP model seeded at application startup",
                    set_active=True,
                )
                logger.info(f"[Registry Seeding] ✓ Seeded active PyTorch_MLP version {vid}")
                seeded_count += 1
            except Exception as e:
                logger.error(f"[Registry Seeding] ✗ FAILED to seed PyTorch_MLP: {type(e).__name__}: {e}", exc_info=True)
    else:
        logger.warning(f"[Registry Seeding] PyTorch_MLP artifact NOT FOUND at {mlp_artifact} — skipping seed.")

    # --- 3. Seed FT-Transformer ---
    ft_artifact = MODEL_DIR / "saved_models" / "ft_transformer.pt"
    if ft_artifact.exists():
        active_ft = version_registry.get_active_model("FT_Transformer")
        active_schema = (active_ft or {}).get("hyperparameters", {}).get("feature_schema_version")
        active_reference_features = set((active_ft or {}).get("reference_distributions") or {})
        if (active_ft is not None and Path(active_ft["artifact_path"]).exists()
                and active_schema == FEATURE_SCHEMA_VERSION
                and active_reference_features == set(FEATURE_NAMES)):
            logger.info(f"[Registry Seeding] FT_Transformer already registered and active: {active_ft['version_id']}")
        else:
            reason = "no active version" if active_ft is None else f"artifact path invalid ({active_ft.get('artifact_path')})"
            logger.info(f"[Registry Seeding] Seeding FT_Transformer baseline ({reason})...")
            try:
                vid = version_registry.register_model(
                    model_architecture="FT_Transformer",
                    artifact_path=ft_artifact,
                    training_data_hash=data_hash,
                    training_timestamp="2026-07-30T16:05:00Z",
                    hyperparameters={
                        "input_dim": len(FEATURE_NAMES),
                        "d_token": 64,
                        "n_blocks": 3,
                        "n_heads": 4,
                        "feature_schema_version": FEATURE_SCHEMA_VERSION,
                        "feature_names": FEATURE_NAMES,
                    },
                    metrics={"metric_interpretation": "policy-approximation fidelity, not investment outcome accuracy"},
                    reference_distributions=ref_dist,
                    notes="Baseline FT-Transformer model seeded at application startup",
                    set_active=True,
                )
                logger.info(f"[Registry Seeding] ✓ Seeded active FT_Transformer version {vid}")
                seeded_count += 1
            except Exception as e:
                logger.error(f"[Registry Seeding] ✗ FAILED to seed FT_Transformer: {type(e).__name__}: {e}", exc_info=True)
    else:
        logger.warning(f"[Registry Seeding] FT_Transformer artifact NOT FOUND at {ft_artifact} — skipping seed.")

    # --- Summary ---
    total_versions = version_registry.list_versions()
    active_versions = [v for v in total_versions if v.get("is_active")]
    logger.info(
        f"[Registry Seeding] Complete. Seeded {seeded_count} new version(s). "
        f"Registry now has {len(total_versions)} total version(s), {len(active_versions)} active."
    )


@asynccontextmanager
async def lifespan(app: FastAPI):
    global model, label_encoder, model_accuracy, confidence_threshold, git_commit_hash, model_version, dataset_version, explainer_instance
    
    # 0. Fail-Closed Security & Config Validation
    from security import validate_ml_service_config, validate_ml_operator_config
    validate_ml_service_config()
    validate_ml_operator_config()

    # 0. Instantiate Version Registry via Store Factory & attach to serving ModelRegistry
    version_registry = get_model_registry()
    registry.set_version_registry(version_registry)
    app.state.version_registry = version_registry
    logger.info(f"Version registry initialized: {type(version_registry).__name__}")

    # 1. Load / Train model artifacts FIRST (so they exist on disk for seeding)
    rf_pred = RandomForestPredictor()
    rf_pred.load_artifacts()
    if not rf_pred.is_loaded:
        logger.info("Auto-training baseline RandomForest model...")
        from model.training.train_rf import train_random_forest_model
        train_random_forest_model()
        rf_pred.load_artifacts()
    model = rf_pred.model
    label_encoder = rf_pred.label_encoder
    registry.register("random_forest", rf_pred)
    registry.register("rf", rf_pred)

    mlp_pred = MLPPredictor()
    mlp_pred.load_artifacts()
    if not mlp_pred.is_loaded:
        logger.info("Auto-training baseline PyTorch MLP model...")
        from model.training.train_pytorch import train_pytorch_model
        train_pytorch_model()
        mlp_pred.load_artifacts()
    registry.register("mlp", mlp_pred)
    registry.register("pytorch", mlp_pred)

    ft_pred = FTTransformerPredictor()
    ft_pred.load_artifacts()
    if not ft_pred.is_loaded:
        logger.info("Auto-training baseline FT-Transformer model...")
        from model.training.train_pytorch import train_ft_transformer_model
        train_ft_transformer_model()
        ft_pred.load_artifacts()
    registry.register("ft_transformer", ft_pred)

    # 2. NOW seed the version registry (artifacts guaranteed to exist on disk)
    _seed_and_resolve_active_models(version_registry)

    # 3. Resolve active versions from registry and reload predictors from registry-tracked paths
    active_rf = version_registry.get_active_model("RandomForest")
    active_rf_schema = (active_rf or {}).get("hyperparameters", {}).get("feature_schema_version")
    if active_rf and Path(active_rf["artifact_path"]).exists() and active_rf_schema == FEATURE_SCHEMA_VERSION:
        rf_pred.load_artifacts(artifact_path=Path(active_rf["artifact_path"]))
        if rf_pred.is_loaded:
            model_version = active_rf["version_id"]
            model_accuracy = active_rf.get("metrics", {}).get("rule_approximation_fidelity")
            model = rf_pred.model
            label_encoder = rf_pred.label_encoder
            logger.info(f"RandomForest loaded from registry version {active_rf['version_id']}")
    else:
        logger.info(f"RandomForest loaded from default path (no active registry version).")

    active_mlp = version_registry.get_active_model("PyTorch_MLP")
    active_mlp_schema = (active_mlp or {}).get("hyperparameters", {}).get("feature_schema_version")
    if active_mlp and Path(active_mlp["artifact_path"]).exists() and active_mlp_schema == FEATURE_SCHEMA_VERSION:
        mlp_pred.load_artifacts(artifact_path=Path(active_mlp["artifact_path"]))
        logger.info(f"PyTorch_MLP loaded from registry version {active_mlp['version_id']}")

    active_ft = version_registry.get_active_model("FT_Transformer")
    active_ft_schema = (active_ft or {}).get("hyperparameters", {}).get("feature_schema_version")
    if active_ft and Path(active_ft["artifact_path"]).exists() and active_ft_schema == FEATURE_SCHEMA_VERSION:
        ft_pred.load_artifacts(artifact_path=Path(active_ft["artifact_path"]))
        logger.info(f"FT_Transformer loaded from registry version {active_ft['version_id']}")

    # 4. Load TreeSHAP Explainer from RF model
    if rf_pred.is_loaded and rf_pred.model is not None and rf_pred.label_encoder is not None:
        try:
            explainer_instance = ModelExplainer(rf_pred.model, rf_pred.label_encoder)
            logger.info("TreeSHAP Explainer initialized successfully.")
        except Exception as e:
            logger.warning(f"TreeSHAP Explainer initialization failed ({e}); serving without SHAP attributions.")

    # 5. Initialize & Seed RAG Knowledge Base
    try:
        from rag.seed_knowledge import seed_default_knowledge_base
        seed_default_knowledge_base()
        logger.info("RAG Knowledge Base initialized & seeded successfully.")
    except Exception as e:
        logger.warning(f"RAG Knowledge Base initialization failed: {e}")

    # 6. Start Scheduled Drift Monitor (asyncio periodic task)
    from model.registry.drift_scheduler import drift_scheduler
    drift_scheduler.start(version_registry)

    logger.info(f"ModelRegistry initialized with registered models: {[m['key'] for m in registry.list_models()]}")
    yield

    # Shutdown: stop the drift scheduler
    await drift_scheduler.stop()


app = FastAPI(
    title="WealthGenie ML & RAG Platform",
    version="4.0.0",
    lifespan=lifespan
)

# OpenTelemetry Distributed Tracing Setup
from tracing import setup_tracing
setup_tracing(app)

# Include Subsystem Routers
from rag.router import rag_router
from llm.router import llm_router
from model.registry.router import registry_router

app.include_router(rag_router)
app.include_router(llm_router)
app.include_router(registry_router)


@app.middleware("http")
async def correlation_id_middleware(request: Request, call_next):
    cid = request.headers.get("x-correlation-id") or request.headers.get("x-request-id") or str(uuid.uuid4())
    request.state.correlation_id = cid
    traceparent = request.headers.get("traceparent")
    response = await call_next(request)
    response.headers["x-correlation-id"] = cid
    if traceparent:
        response.headers["traceparent"] = traceparent
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["X-XSS-Protection"] = "1; mode=block"
    return response


# CORS Configuration
origins = [
    "http://localhost:5173",
    "http://localhost:3000",
    "http://127.0.0.1:5173",
    "http://127.0.0.1:3000",
    os.environ.get("FRONTEND_URL", "http://localhost:5173"),
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def get_decision_path_description(data: PredictRequest) -> List[str]:
    """Explain only approved suitability inputs; never infer gross income."""
    return [
        f"final_suitability_risk={data.final_suitability_risk}",
        f"risk_capacity_score={data.risk_capacity_score}",
        f"investment_horizon_years={data.investment_horizon_years}",
        f"investment_goals={','.join(data.investment_goals)}",
    ]


def build_model_input(data: PredictRequest):
    features = engineer_features(
        age=data.age,
        monthly_take_home=data.monthly_take_home,
        monthly_savings=data.monthly_savings,
        investment_horizon_years=data.investment_horizon_years,
        liquid_savings=data.liquid_savings,
        emi_burden_pct=data.emi_burden_pct,
        financial_dependents=data.financial_dependents,
        emergency_fund_months=data.emergency_fund_months,
        deployable_lump_sum=data.deployable_lump_sum,
        risk_capacity_score=data.risk_capacity_score,
        risk_tolerance=data.risk_tolerance,
        final_suitability_risk=data.final_suitability_risk,
        investment_goals=data.investment_goals,
    )
    return features, to_model_array(features)


@app.get("/healthz")
def healthz():
    return {"status": "alive"}

@app.get("/readyz")
def readyz():
    return readiness()

@app.get("/health", response_model=HealthResponse)
def health():
    rf = registry.get("random_forest")
    status_str = "ok" if (rf and rf.is_loaded) else "model_not_loaded"

    # Query live version registry at request time, not stale startup globals
    live_version = model_version
    live_accuracy = model_accuracy
    version_store = registry.get_version_registry()
    if version_store is not None:
        try:
            active = version_store.get_active_model("RandomForest")
            if active:
                live_version = active["version_id"]
                live_accuracy = active.get("metrics", {}).get("rule_approximation_fidelity", live_accuracy)
        except Exception:
            pass  # Fall back to globals on any registry read error

    return HealthResponse(
        status=status_str,
        model_version=live_version,
        feature_schema_version=FEATURE_SCHEMA_VERSION,
        model_accuracy=live_accuracy,
        explainer_loaded=explainer_instance is not None,
    )


@app.get("/readiness")
def readiness():
    """Readiness probe checking ModelRegistry status."""
    loaded_models = registry.get_loaded_predictors()
    return {
        "status": "ready" if loaded_models else "not_ready",
        "loaded_models_count": len(loaded_models),
        "available_models": list(loaded_models.keys()),
    }


@app.get("/models")
def list_registered_models():
    """Lists metadata for all registered models in the registry."""
    return {"registered_models": registry.list_models()}


def get_live_model_version(architecture: str, default_version: str) -> str:
    """Dynamically resolve the currently active version_id from the version registry."""
    version_store = registry.get_version_registry()
    if version_store is not None:
        try:
            active = version_store.get_active_model(architecture)
            if active and "version_id" in active:
                return str(active["version_id"])
        except Exception:
            pass
    return default_version


def record_inference_features(features: dict) -> None:
    """Records engineered inference features to InferenceBuffer for continuous drift monitoring."""
    try:
        from model.registry.drift_monitor import inference_buffer
        inference_buffer.record(features)
    except Exception as e:
        logger.debug(f"Failed to record inference observation for drift monitoring: {e}")


@app.post("/predict/enriched", response_model=PredictResponse, dependencies=[Depends(verify_api_key)])
@app.post("/predict", response_model=PredictResponse, dependencies=[Depends(verify_api_key)])
async def predict_enriched(data: PredictRequest):
    """
    Prediction endpoint serving recommendations using Random Forest + TreeSHAP explainability.
    Buffers inference inputs for continuous drift monitoring and dual-evaluates shadow candidate if configured.
    """
    features, model_input = build_model_input(data)

    # 1. Buffer for continuous drift monitoring
    record_inference_features(features)

    predictor = registry.get("random_forest")
    if predictor is None or not predictor.is_loaded:
        raise HTTPException(status_code=503, detail="RandomForest model not loaded.")

    res = predictor.predict(model_input)

    # 2. Evaluate shadow candidate if active (fire-and-forget, does not alter active response)
    try:
        from model.registry.shadow_evaluator import shadow_evaluator
        if shadow_evaluator.is_active():
            shadow_evaluator.evaluate(res, model_input)
    except Exception as e:
        logger.debug(f"Shadow evaluation error: {e}")

    explanation = None
    if explainer_instance is not None:
        try:
            explanation = explainer_instance.explain(model_input)
        except Exception as e:
            logger.warning(f"TreeSHAP explanation failed: {e}")

    return PredictResponse(
        primary=res["primary"],
        secondary=res["secondary"],
        tertiary=res["tertiary"],
        confidence_scores=res["confidence_scores"],
        decision_path=get_decision_path_description(data),
        feature_schema_version=FEATURE_SCHEMA_VERSION,
        model_used="RandomForest",
        low_confidence=res["low_confidence"],
        confidence_threshold=confidence_threshold,
        model_version=get_live_model_version("RandomForest", model_version),
        dataset_version=dataset_version,
        git_commit_hash=git_commit_hash,
        explanation=explanation,
    )


@app.post("/predict/pytorch", response_model=PredictResponse, dependencies=[Depends(verify_api_key)])
async def predict_pytorch(data: PredictRequest):
    """
    Prediction endpoint serving recommendations from the PyTorch Multi-Layer Perceptron (MLP).
    """
    predictor = registry.get("mlp")
    if predictor is None or not predictor.is_loaded:
        raise HTTPException(status_code=503, detail="PyTorch MLP model not loaded.")

    features, model_input = build_model_input(data)

    # Buffer for continuous drift monitoring
    record_inference_features(features)

    res = predictor.predict(model_input)

    return PredictResponse(
        primary=res["primary"],
        secondary=res["secondary"],
        tertiary=res["tertiary"],
        confidence_scores=res["confidence_scores"],
        decision_path=get_decision_path_description(data),
        feature_schema_version=FEATURE_SCHEMA_VERSION,
        model_used="PyTorch_FinancialMLP",
        low_confidence=res["low_confidence"],
        confidence_threshold=0.45,
        model_version=get_live_model_version("PyTorch_MLP", "4.0.0-pytorch"),
        dataset_version=dataset_version,
        git_commit_hash=git_commit_hash,
        explanation=None,
    )


@app.post("/predict/ft_transformer", response_model=PredictResponse, dependencies=[Depends(verify_api_key)])
async def predict_ft_transformer(data: PredictRequest):
    """
    Prediction endpoint serving recommendations from the PyTorch FT-Transformer model.
    """
    predictor = registry.get("ft_transformer")
    if predictor is None or not predictor.is_loaded:
        raise HTTPException(status_code=503, detail="FT-Transformer model not loaded.")

    features, model_input = build_model_input(data)

    # Buffer for continuous drift monitoring
    record_inference_features(features)

    res = predictor.predict(model_input)

    return PredictResponse(
        primary=res["primary"],
        secondary=res["secondary"],
        tertiary=res["tertiary"],
        confidence_scores=res["confidence_scores"],
        decision_path=get_decision_path_description(data),
        feature_schema_version=FEATURE_SCHEMA_VERSION,
        model_used="PyTorch_FTTransformer",
        low_confidence=res["low_confidence"],
        confidence_threshold=0.45,
        model_version=get_live_model_version("FT_Transformer", "4.0.0-ft_transformer"),
        dataset_version=dataset_version,
        git_commit_hash=git_commit_hash,
        explanation=None,
    )


@app.post("/predict/compare", dependencies=[Depends(verify_api_key)])
async def predict_compare(data: PredictRequest):
    """
    Multi-model inference comparison endpoint running predictions across all loaded models in ModelRegistry.
    """
    features, model_input = build_model_input(data)

    # Buffer for continuous drift monitoring
    record_inference_features(features)

    loaded_models = registry.get_loaded_predictors()
    if not loaded_models:
        raise HTTPException(status_code=503, detail="No models loaded in registry.")

    comparison_results = {}
    primary_predictions = []

    for name, pred in loaded_models.items():
        if name in ["rf", "pytorch"]:
            continue  # Skip redundant alias keys in comparison output
        res = pred.predict(model_input)
        comparison_results[name] = {
            "model_name": pred.model_name,
            "primary": res["primary"],
            "secondary": res["secondary"],
            "confidence_scores": res["confidence_scores"],
            "latency_ms": res["latency_ms"],
        }
        primary_predictions.append(res["primary"])

    consensus = len(set(primary_predictions)) == 1

    return {
        "comparison": comparison_results,
        "primary_consensus": consensus,
    }


if __name__ == "__main__":
    import uvicorn  # type: ignore[import-not-found]
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port)
