"""
WealthGenie ML Microservice - Model Version Registry Router
Exposes live HTTP endpoints for model version inspection, registration, integrity verification,
drift detection, promotion gates, shadow evaluation, and rollback.
"""

import logging
import math
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Security, status
from pydantic import BaseModel, Field

from model.serving.registry import registry
from model.data.feature_engineering import FEATURE_NAMES, FEATURE_SCHEMA_VERSION
from store_factory import get_model_registry
from security import operator_key_header, verify_api_key, verify_operator_key

logger = logging.getLogger("wealthgenie.registry.router")

registry_router = APIRouter(prefix="/model/registry", tags=["Model Registry"], dependencies=[Depends(verify_api_key)])

# ── Promotion Gate Configuration ──
# Maximum allowed regression (as fraction) on any tracked metric before a candidate
# is blocked from becoming active. 0.02 = candidate must be within 2% of the
# current active version on every metric to pass.
PROMOTION_MAX_REGRESSION = 0.02
PROMOTION_TRACKED_METRICS = [
    "rule_approximation_fidelity",
    "balanced_accuracy",
    "macro_f1",
]


async def verify_registry_operator(
    operator_key: Optional[str] = Security(operator_key_header),
) -> str:
    """Require the distinct operator credential for registry mutations.

    A caller that has the prediction API key is authenticated but is not
    authorized to mutate the registry, so invalid operator credentials are
    deliberately reported as 403 rather than 401.
    """
    try:
        return await verify_operator_key(operator_key)
    except HTTPException as exc:
        if exc.status_code == status.HTTP_401_UNAUTHORIZED:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="A valid operator credential is required for model registry mutations.",
            ) from exc
        raise


def get_version_store():
    """Dependency returning the active ModelRegistry store instance."""
    store = registry.get_version_registry()
    if store is None:
        store = get_model_registry()
        registry.set_version_registry(store)
    return store


def check_promotion_gate(
    candidate_metrics: Dict[str, Any],
    active_metrics: Dict[str, Any],
    max_regression: float = PROMOTION_MAX_REGRESSION,
    tracked_metrics: List[str] = None,
) -> Dict[str, Any]:
    """
    Compares candidate metrics against active model metrics.
    Returns a gate result dict with pass/fail status and per-metric details.

    A candidate FAILS the gate if any tracked metric regresses by more than
    `max_regression` (fraction) relative to the active model's value.

    Example: active fidelity=0.95, max_regression=0.02
      → candidate must have fidelity >= 0.95 * (1 - 0.02) = 0.931
    """
    if tracked_metrics is None:
        tracked_metrics = PROMOTION_TRACKED_METRICS

    gate_passed = True
    per_metric = {}
    failures = []

    for metric_name in tracked_metrics:
        active_val = active_metrics.get(metric_name)
        candidate_val = candidate_metrics.get(metric_name)

        if active_val is None or candidate_val is None:
            per_metric[metric_name] = {
                "status": "SKIPPED",
                "reason": f"metric missing (active={active_val}, candidate={candidate_val})",
            }
            gate_passed = False
            failures.append(f"{metric_name}: required validation evidence is missing")
            continue

        threshold = float(active_val) * (1.0 - max_regression)
        passed = float(candidate_val) >= threshold

        per_metric[metric_name] = {
            "active_value": round(float(active_val), 4),
            "candidate_value": round(float(candidate_val), 4),
            "minimum_required": round(threshold, 4),
            "regression_pct": round((1.0 - float(candidate_val) / float(active_val)) * 100, 2) if float(active_val) > 0 else 0.0,
            "status": "PASS" if passed else "FAIL",
        }

        if not passed:
            gate_passed = False
            failures.append(
                f"{metric_name}: candidate={round(float(candidate_val), 4)} < "
                f"minimum={round(threshold, 4)} (active={round(float(active_val), 4)}, "
                f"max_regression={max_regression*100}%)"
            )

    return {
        "gate_passed": gate_passed,
        "max_regression_allowed": max_regression,
        "per_metric": per_metric,
        "failures": failures,
    }


class RegisterModelRequest(BaseModel):
    model_config = {"protected_namespaces": (), "extra": "forbid"}
    model_architecture: str = Field(..., description="Model architecture identifier (e.g. RandomForest, PyTorch_MLP, FT_Transformer)")
    artifact_path: str = Field(..., description="Path to serialized model artifact on disk")
    training_data_hash: str = Field(..., min_length=64, max_length=64, pattern=r"^[0-9a-fA-F]{64}$", description="SHA-256 hash of training data")
    training_timestamp: Optional[str] = Field(None, description="ISO timestamp of training completion")
    hyperparameters: Optional[Dict[str, Any]] = Field(default_factory=dict, description="Model hyperparameters")
    metrics: Optional[Dict[str, Any]] = Field(default_factory=dict, description="Evaluation metrics (accuracy, fidelity, F1)")
    reference_distributions: Optional[Dict[str, Any]] = Field(None, description="Feature reference distributions for drift monitoring")
    dataset_lineage: Optional[Dict[str, Any]] = Field(None, description="Reproducible dataset generation parameters (seed, N, distributions)")
    notes: Optional[str] = Field(None, description="Optional version release notes")
    set_active: bool = Field(False, description="Whether to immediately set this version as active")


class DriftCheckRequest(BaseModel):
    model_config = {"protected_namespaces": (), "extra": "forbid"}
    architecture: str = Field("RandomForest", description="Model architecture to check drift for")
    force_retrain: bool = Field(True, description="Whether to trigger retrain if drift is detected")
    use_buffer: bool = Field(True, description="Whether to evaluate real accumulated observations from InferenceBuffer")
    shift_feature: Optional[str] = Field(None, description="Feature to simulate drift on (for testing)")
    shift_multiplier: float = Field(1.0, description="Multiplicative shift to apply to the shifted feature")
    shift_offset: float = Field(0.0, description="Additive offset to apply to the shifted feature")
    n_samples: int = Field(300, description="Number of samples for synthetic drift batch")


class PromoteRequest(BaseModel):
    model_config = {"protected_namespaces": (), "extra": "forbid"}
    version_id: str = Field(..., description="Version ID of the candidate to promote to active")


class ValidateRequest(BaseModel):
    model_config = {"protected_namespaces": (), "extra": "forbid"}
    metrics: Dict[str, float] = Field(..., description="Complete tracked validation evidence")


@registry_router.get("/versions", dependencies=[Depends(verify_api_key)])
def list_versions(
    architecture: Optional[str] = Query(None, description="Filter by model architecture"),
    store = Depends(get_version_store),
):
    """Lists all registered model versions from the persistent registry."""
    versions = store.list_versions(architecture=architecture)
    return {
        "count": len(versions),
        "architecture_filter": architecture,
        "versions": versions,
    }


@registry_router.get("/active", dependencies=[Depends(verify_api_key)])
def get_active_model(
    architecture: Optional[str] = Query(None, description="Filter by model architecture"),
    store = Depends(get_version_store),
):
    """Retrieves the currently active model version from the persistent registry."""
    active = store.get_active_model(architecture=architecture)
    if not active:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No active model found in registry{' for architecture ' + architecture if architecture else ''}."
        )
    return {"active_model": active}


@registry_router.get("/versions/{version_id}", dependencies=[Depends(verify_api_key)])
def get_version(
    version_id: str,
    store = Depends(get_version_store),
):
    """Retrieves metadata and metrics for a specific model version by UUID."""
    version = store.get_version(version_id)
    if not version:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Model version '{version_id}' not found in registry."
        )
    return version


@registry_router.get("/integrity/{version_id}", dependencies=[Depends(verify_api_key)])
def verify_artifact_integrity(
    version_id: str,
    store = Depends(get_version_store),
):
    """Verifies SHA-256 tamper-evident hash of the registered artifact against disk."""
    try:
        return store.verify_artifact_integrity(version_id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))


@registry_router.post("/register", status_code=status.HTTP_201_CREATED, dependencies=[Depends(verify_registry_operator)])
def register_model_version(
    payload: RegisterModelRequest,
    store = Depends(get_version_store),
):
    """
    Registers a new CANDIDATE into the persistent version registry.
    API registration never activates a model directly.
    """
    if payload.set_active:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="API registration always creates a CANDIDATE; direct activation is forbidden.")
    artifact_path = Path(payload.artifact_path)
    if not artifact_path.exists():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Artifact file not found at path: {payload.artifact_path}"
        )

    from datetime import datetime, timezone
    training_timestamp = payload.training_timestamp or datetime.now(timezone.utc).isoformat()

    # Build hyperparameters with dataset lineage embedded
    hparams = payload.hyperparameters or {}
    if payload.dataset_lineage:
        hparams["dataset_lineage"] = payload.dataset_lineage

    if payload.model_architecture in {"RandomForest", "PyTorch_MLP", "FT_Transformer"}:
        if hparams.get("feature_schema_version") != FEATURE_SCHEMA_VERSION:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"feature_schema_version must equal {FEATURE_SCHEMA_VERSION}",
            )
        if hparams.get("feature_names") != FEATURE_NAMES:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="feature_names must exactly match the ordered v4 feature allowlist",
            )
        if set(payload.reference_distributions or {}) != set(FEATURE_NAMES):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="reference_distributions must cover exactly the v4 feature allowlist",
            )

    try:
        version_id = store.register_model(
            model_architecture=payload.model_architecture,
            artifact_path=artifact_path,
            training_data_hash=payload.training_data_hash or "unknown",
            training_timestamp=training_timestamp,
            hyperparameters=hparams,
            metrics=payload.metrics or {},
            reference_distributions=payload.reference_distributions,
            notes=payload.notes,
            set_active=False,
        )

        return {
            "status": "registered",
            "version_id": version_id,
            "model_architecture": payload.model_architecture,
            "is_active": False,
            "lifecycle_state": "CANDIDATE",
        }
    except Exception as e:
        logger.error(f"Failed to register model: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))


@registry_router.post("/validate/{version_id}", dependencies=[Depends(verify_registry_operator)])
def validate_version(version_id: str, payload: ValidateRequest, store=Depends(get_version_store)):
    candidate = store.get_version(version_id)
    if not candidate:
        raise HTTPException(status_code=404, detail="Model version not found")
    if candidate.get("lifecycle_state") != "SHADOW":
        raise HTTPException(status_code=409, detail="Only SHADOW models can become VALIDATED")
    missing = [name for name in PROMOTION_TRACKED_METRICS if name not in payload.metrics]
    if missing:
        raise HTTPException(status_code=409, detail=f"Missing validation metrics: {', '.join(missing)}")
    invalid = [
        name for name in PROMOTION_TRACKED_METRICS
        if not math.isfinite(payload.metrics[name]) or not 0.0 <= payload.metrics[name] <= 1.0
    ]
    if invalid:
        raise HTTPException(status_code=422, detail=f"Validation metrics must be finite values in [0, 1]: {', '.join(invalid)}")
    return store.update_lifecycle_state(version_id, "VALIDATED", metrics=payload.metrics)


@registry_router.post("/promote", status_code=status.HTTP_200_OK, dependencies=[Depends(verify_registry_operator)])
def promote_version(
    payload: PromoteRequest,
    store = Depends(get_version_store),
):
    """
    Promotes a registered candidate version to active after passing the promotion gate.
    The candidate's metrics are compared against the currently active version's metrics.
    If any tracked metric regresses by more than 2%, the promotion is REJECTED.
    """
    candidate = store.get_version(payload.version_id)
    if not candidate:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Candidate version '{payload.version_id}' not found in registry."
        )

    if candidate.get("is_active"):
        return {
            "status": "already_active",
            "version_id": payload.version_id,
            "message": "This version is already the active model.",
        }
    if candidate.get("lifecycle_state") != "VALIDATED":
        raise HTTPException(status_code=409, detail="Only VALIDATED models can be promoted to ACTIVE")

    architecture = candidate["model_architecture"]
    active_version = store.get_active_model(architecture)

    if active_version:
        gate_result = check_promotion_gate(
            candidate_metrics=candidate.get("metrics", {}),
            active_metrics=active_version["metrics"],
        )
        if not gate_result["gate_passed"]:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={
                    "error": "PROMOTION_GATE_FAILED",
                    "message": "Candidate version does not meet promotion criteria.",
                    "gate_result": gate_result,
                    "candidate_version_id": payload.version_id,
                    "active_version_id": active_version["version_id"],
                },
            )

    # Promotion gate passed — activate via centrally persisted lifecycle state.
    try:
        store.rollback_to_version(payload.version_id)
        registry.reload_active_model(architecture)
        return {
            "status": "promoted",
            "version_id": payload.version_id,
            "model_architecture": architecture,
            "is_active": True,
            "gate_result": check_promotion_gate(
                candidate_metrics=candidate.get("metrics", {}),
                active_metrics=active_version["metrics"] if active_version else {},
            ) if active_version else {"gate_passed": True, "reason": "no_previous_active_version"},
        }
    except (ValueError, RuntimeError, FileNotFoundError) as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e))


@registry_router.get("/drift/buffer", dependencies=[Depends(verify_api_key)])
def get_drift_buffer_status():
    """Returns the current status, sample count, capacity, and last check metadata of the InferenceBuffer."""
    from model.registry.drift_monitor import inference_buffer
    return {
        "size": inference_buffer.size(),
        "capacity": inference_buffer.capacity,
        "last_check_timestamp": inference_buffer.last_check_timestamp,
        "last_check_verdict": inference_buffer.last_check_verdict,
        "last_drift_score": inference_buffer.last_drift_score,
    }


@registry_router.delete("/drift/buffer", dependencies=[Depends(verify_registry_operator)])
def clear_drift_buffer():
    """Clears all buffered observations in the InferenceBuffer."""
    from model.registry.drift_monitor import inference_buffer
    inference_buffer.clear()
    return {
        "status": "cleared",
        "size": inference_buffer.size(),
    }


@registry_router.post("/drift-check", dependencies=[Depends(verify_registry_operator)])
def run_drift_check_endpoint(
    payload: DriftCheckRequest,
    store = Depends(get_version_store),
):
    """
    Runs PSI drift detection against the active model's reference distributions.
    If shift_feature is provided, generates a synthetic shifted observation batch.
    Otherwise, if use_buffer=True, evaluates real accumulated observations from InferenceBuffer.
    If drift is detected and force_retrain=true, triggers automated retraining and registers
    the result as a new candidate version (is_active=false).
    """
    from model.registry.drift_monitor import (
        check_drift_and_trigger_retrain,
        generate_synthetic_feature_batch,
        inference_buffer,
    )

    if payload.shift_feature is not None:
        input_df = generate_synthetic_feature_batch(
            n_samples=payload.n_samples,
            seed=42,
            shift_feature=payload.shift_feature,
            shift_multiplier=payload.shift_multiplier,
            shift_offset=payload.shift_offset,
        )
    elif payload.use_buffer:
        input_df = inference_buffer.get_dataframe()
    else:
        input_df = generate_synthetic_feature_batch(
            n_samples=payload.n_samples,
            seed=42,
        )

    try:
        result = check_drift_and_trigger_retrain(
            architecture=payload.architecture,
            input_df=input_df,
            store=store,
            force_retrain_on_drift=payload.force_retrain,
        )
        return result
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    except Exception as e:
        logger.error(f"Drift check failed: {e}", exc_info=True)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))


@registry_router.post("/rollback/{version_id}", dependencies=[Depends(verify_registry_operator)])
def rollback_model_version(
    version_id: str,
    store = Depends(get_version_store),
):
    """Rolls back the active model to a specific registered version with tamper-evident verification."""
    target = store.get_version(version_id)
    if not target:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Model version not found")
    if target.get("lifecycle_state") not in {"ROLLED_BACK", "ACTIVE"}:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Rollback may only restore a previously ACTIVE/ROLLED_BACK model; it cannot bypass validation.",
        )
    try:
        active_record = store.rollback_to_version(version_id)
        registry.reload_active_model(active_record["model_architecture"])
        return {
            "status": "rolled_back",
            "active_version": active_record,
        }
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e))
    except FileNotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))


class ConfigureShadowRequest(BaseModel):
    model_config = {"protected_namespaces": ()}
    version_id: str = Field(..., description="Registered version ID to run as shadow candidate")


@registry_router.post("/shadow/configure", dependencies=[Depends(verify_registry_operator)])
def configure_shadow_model(
    payload: ConfigureShadowRequest,
    store = Depends(get_version_store),
):
    """
    Configures a registered candidate version to run in shadow evaluation mode alongside the active model.
    Loads the candidate's artifact into an isolated predictor instance.
    """
    from model.registry.shadow_evaluator import shadow_evaluator
    from model.serving.inference import RandomForestPredictor, MLPPredictor, FTTransformerPredictor

    version = store.get_version(payload.version_id)
    if not version:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Model version '{payload.version_id}' not found in registry."
        )
    if version.get("lifecycle_state") != "CANDIDATE":
        raise HTTPException(status_code=409, detail="Only CANDIDATE models can enter SHADOW")

    artifact_path = Path(version["artifact_path"])
    if not artifact_path.exists():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Artifact file missing at {artifact_path}"
        )

    arch = version["model_architecture"]
    if arch.lower() in ["randomforest", "rf", "random_forest"]:
        pred = RandomForestPredictor()
        # Look for matching candidate label encoder, default model dir, or saved_models dir
        base_model_dir = Path(__file__).resolve().parents[1]
        le_path = artifact_path.parent / f"le_{payload.version_id[:8]}.pkl"
        if not le_path.exists():
            le_path = base_model_dir / "label_encoder.pkl"
        if not le_path.exists():
            le_path = artifact_path.parent / "label_encoder.pkl"
        pred.load_artifacts(artifact_path=artifact_path, label_encoder_path=le_path)
    elif arch.lower() in ["pytorch_mlp", "mlp"]:
        pred = MLPPredictor()
        pred.load_artifacts(artifact_path=artifact_path)
    elif arch.lower() in ["ft_transformer", "fttransformer"]:
        pred = FTTransformerPredictor()
        pred.load_artifacts(artifact_path=artifact_path)
    else:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unsupported architecture '{arch}' for shadow evaluation."
        )

    if not pred.is_loaded:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Failed to load predictor for shadow evaluation."
        )

    shadow_evaluator.configure_shadow(
        version_id=payload.version_id,
        architecture=arch,
        predictor=pred,
    )
    store.update_lifecycle_state(payload.version_id, "SHADOW")

    return {
        "status": "configured",
        "shadow_version_id": payload.version_id,
        "model_architecture": arch,
        "message": "Shadow candidate configured. Live inference will now dual-evaluate active and shadow models.",
    }


@registry_router.get("/shadow/summary", dependencies=[Depends(verify_api_key)])
def get_shadow_summary():
    """Retrieves live agreement statistics and recent side-by-side comparisons for the shadow candidate."""
    from model.registry.shadow_evaluator import shadow_evaluator
    return shadow_evaluator.get_summary()


@registry_router.delete("/shadow", dependencies=[Depends(verify_registry_operator)])
def clear_shadow_model():
    """Disables shadow evaluation mode."""
    from model.registry.shadow_evaluator import shadow_evaluator
    shadow_evaluator.clear_shadow()
    return {"status": "cleared", "message": "Shadow evaluation disabled."}

