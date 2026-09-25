"""
WealthGenie ML Microservice - FastAPI
Serves RandomForest (TreeSHAP), PyTorch MLP, and FT-Transformer predictions via a unified ModelRegistry.
Integrated with persistent MongoModelRegistry / SQLite ModelRegistry via store_factory.
"""

import json
import logging
import os
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from typing import List

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware

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

from security import verify_api_key


# Application State & Lifespan
BASE_DIR = Path(__file__).resolve().parent
MODEL_DIR = BASE_DIR / "model"

model = None
label_encoder = None
model_accuracy: float | None = None
confidence_threshold: float = 0.55
git_commit_hash: str | None = None
model_version: str = "4.0.0"
dataset_version: str = "4.0.0"
explainer_instance: ModelExplainer | None = None


def _seed_and_resolve_active_models(version_registry) -> None:
    """Reject legacy startup seeding; trusted bundles use the explicit bootstrap command."""
    raise RuntimeError("Legacy local-file model seeding is disabled; run the explicit trusted-bundle bootstrap.")

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

    # Serving identity comes only from the shared active registry record and
    # its immutable ArtifactStore object. No unpinned local-file load or
    # startup model seeding is allowed.
    rf_pred = RandomForestPredictor()
    mlp_pred = MLPPredictor()
    ft_pred = FTTransformerPredictor()
    registry.register("random_forest", rf_pred)
    registry.register("rf", rf_pred)
    registry.register("mlp", mlp_pred)
    registry.register("pytorch", mlp_pred)
    registry.register("ft_transformer", ft_pred)

    from model.serving.control_plane import ModelReconciliationError, ensure_active_model_loaded
    for architecture in ("RandomForest", "PyTorch_MLP", "FT_Transformer"):
        try:
            ensure_active_model_loaded(architecture)
        except ModelReconciliationError as exc:
            logger.error("%s active bundle is not ready: %s", architecture, exc)

    rf_pred = registry.get("random_forest")
    if rf_pred and rf_pred.is_loaded:
        model = rf_pred.model
        label_encoder = rf_pred.label_encoder
        model_version = rf_pred.loaded_version_id or model_version
        active_rf = version_registry.get_active_model("RandomForest")
        model_accuracy = (active_rf or {}).get("metrics", {}).get("rule_approximation_fidelity")

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
from market_context.router import market_context_router

app.include_router(rag_router)
app.include_router(llm_router)
app.include_router(registry_router)
app.include_router(market_context_router)


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

    # Report the version corresponding to bytes actually loaded in this process.
    live_version = (getattr(rf, "loaded_version_id", None) if rf else None) or "unavailable"
    live_accuracy = model_accuracy
    version_store = registry.get_version_registry()
    if version_store is None:
        status_str = "model_registry_unavailable"
    else:
        try:
            active = version_store.get_active_model("RandomForest")
            if not active or not rf or not rf.is_loaded or (
                str(active.get("version_id")) != str(live_version)
                or getattr(rf, "loaded_bundle_id", None) != active.get("bundle_id")
                or getattr(rf, "loaded_bundle_hash", None) != active.get("bundle_manifest_sha256")
                or int(getattr(rf, "loaded_activation_generation", -1)) != int(active.get("activation_generation", -2))
            ):
                status_str = "model_version_reconciliation_required"
            else:
                live_accuracy = active.get("metrics", {}).get("rule_approximation_fidelity", live_accuracy)
        except Exception:
            status_str = "model_registry_unavailable"

    return HealthResponse(
        status=status_str,
        model_version=live_version,
        feature_schema_version=FEATURE_SCHEMA_VERSION,
        model_accuracy=live_accuracy,
        explainer_loaded=explainer_instance is not None,
    )


@app.get("/readiness")
def readiness():
    """Readiness probe for the authoritative RandomForest serving path.

    RAG embeddings and optional predictors are not required for the core
    recommendation service. The probe therefore becomes ready only when the
    required RandomForest predictor has loaded a qualified artifact; this
    prevents a partially initialized process from advertising readiness.
    """
    from model.serving.control_plane import ModelReconciliationError, ensure_active_model_loaded
    reconciliation_error = False
    try:
        ensure_active_model_loaded("RandomForest")
    except ModelReconciliationError:
        reconciliation_error = True
    loaded_models = registry.get_loaded_predictors()
    random_forest = registry.get("random_forest")
    required_model_ready = bool(
        not reconciliation_error
        and random_forest
        and random_forest.is_loaded
        and getattr(random_forest, "loaded_version_id", None)
        and getattr(random_forest, "loaded_bundle_id", None)
        and getattr(random_forest, "loaded_bundle_hash", None)
    )
    return {
        "status": "ready" if required_model_ready else "not_ready",
        "loaded_models_count": len(loaded_models),
        "available_models": list(loaded_models.keys()),
        "required_model": "random_forest",
        "required_model_ready": required_model_ready,
    }


@app.get("/models")
def list_registered_models():
    """Lists metadata for all registered models in the registry."""
    return {"registered_models": registry.list_models()}


def get_live_model_version(architecture: str, predictor, _default_version: str) -> str:
    """Return the loaded artifact identity, failing closed if registry has moved."""
    loaded_version = getattr(predictor, "loaded_version_id", None)
    version_store = registry.get_version_registry()
    if version_store is None or not loaded_version:
        raise HTTPException(
            status_code=503,
            detail={"code": "MODEL_VERSION_RECONCILIATION_REQUIRED", "message": "A registry-bound loaded model version is unavailable."},
        )
    try:
        active = version_store.get_active_model(architecture)
        if not active or (
            str(loaded_version) != str(active.get("version_id"))
            or getattr(predictor, "loaded_bundle_id", None) != active.get("bundle_id")
            or getattr(predictor, "loaded_bundle_hash", None) != active.get("bundle_manifest_sha256")
            or getattr(predictor, "loaded_feature_schema_version", None) != active.get("feature_schema_version")
            or int(getattr(predictor, "loaded_activation_generation", -1)) != int(active.get("activation_generation", -2))
        ):
            raise HTTPException(
                status_code=503,
                detail={"code": "MODEL_VERSION_RECONCILIATION_REQUIRED", "message": "The loaded model does not match the current active registry identity."},
            )
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(
            status_code=503,
            detail={"code": "MODEL_VERSION_RECONCILIATION_REQUIRED", "message": "The active model version could not be verified."},
        ) from exc
    return str(loaded_version)


def _ensure_serving_model(architecture: str):
    from model.serving.control_plane import ModelReconciliationError, ensure_active_model_loaded

    try:
        return ensure_active_model_loaded(architecture)
    except ModelReconciliationError as exc:
        raise HTTPException(
            status_code=503,
            detail={
                "code": "MODEL_VERSION_RECONCILIATION_REQUIRED",
                "message": "The active model bundle is not loaded and verified on this replica.",
            },
        ) from exc


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

    predictor = _ensure_serving_model("RandomForest")
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
        model_version=get_live_model_version("RandomForest", predictor, model_version),
        dataset_version=dataset_version,
        git_commit_hash=git_commit_hash,
        explanation=explanation,
    )


@app.post("/predict/pytorch", response_model=PredictResponse, dependencies=[Depends(verify_api_key)])
async def predict_pytorch(data: PredictRequest):
    """
    Prediction endpoint serving recommendations from the PyTorch Multi-Layer Perceptron (MLP).
    """
    predictor = _ensure_serving_model("PyTorch_MLP")
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
        model_version=get_live_model_version("PyTorch_MLP", predictor, "4.0.0-pytorch"),
        dataset_version=dataset_version,
        git_commit_hash=git_commit_hash,
        explanation=None,
    )


@app.post("/predict/ft_transformer", response_model=PredictResponse, dependencies=[Depends(verify_api_key)])
async def predict_ft_transformer(data: PredictRequest):
    """
    Prediction endpoint serving recommendations from the PyTorch FT-Transformer model.
    """
    predictor = _ensure_serving_model("FT_Transformer")
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
        model_version=get_live_model_version("FT_Transformer", predictor, "4.0.0-ft_transformer"),
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

    from model.serving.control_plane import ModelReconciliationError, ensure_active_model_loaded
    serving_architectures = {
        "random_forest": "RandomForest",
        "mlp": "PyTorch_MLP",
        "ft_transformer": "FT_Transformer",
    }
    loaded_models = registry.get_loaded_predictors()
    if not loaded_models:
        raise HTTPException(status_code=503, detail="No models loaded in registry.")

    current_models = {}
    for name, architecture in serving_architectures.items():
        if name not in loaded_models:
            continue
        try:
            current_models[name] = ensure_active_model_loaded(architecture)
        except ModelReconciliationError as exc:
            raise HTTPException(
                status_code=503,
                detail={"code": "MODEL_VERSION_RECONCILIATION_REQUIRED", "message": "A comparison model could not be reconciled to the active bundle."},
            ) from exc

    comparison_results = {}
    primary_predictions = []

    for name, pred in current_models.items():
        res = pred.predict(model_input)
        comparison_results[name] = {
            "model_name": pred.model_name,
            "model_version": get_live_model_version(serving_architectures[name], pred, ""),
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
