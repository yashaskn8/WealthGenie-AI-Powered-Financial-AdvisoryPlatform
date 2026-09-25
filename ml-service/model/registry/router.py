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

        try:
            active_number = float(active_val)
            candidate_number = float(candidate_val)
        except (TypeError, ValueError):
            active_number = candidate_number = math.nan
        if (
            not math.isfinite(active_number)
            or not math.isfinite(candidate_number)
            or not 0.0 <= active_number <= 1.0
            or not 0.0 <= candidate_number <= 1.0
        ):
            per_metric[metric_name] = {
                "status": "FAIL",
                "reason": "metric evidence must be finite and in [0, 1]",
            }
            gate_passed = False
            failures.append(f"{metric_name}: invalid validation evidence")
            continue

        threshold = active_number * (1.0 - max_regression)
        passed = candidate_number >= threshold

        per_metric[metric_name] = {
            "active_value": round(active_number, 4),
            "candidate_value": round(candidate_number, 4),
            "minimum_required": round(threshold, 4),
            "regression_pct": round((1.0 - candidate_number / active_number) * 100, 2) if active_number > 0 else 0.0,
            "status": "PASS" if passed else "FAIL",
        }

        if not passed:
            gate_passed = False
            failures.append(
                f"{metric_name}: candidate={round(candidate_number, 4)} < "
                f"minimum={round(threshold, 4)} (active={round(active_number, 4)}, "
                f"max_regression={max_regression*100}%)"
            )

    return {
        "gate_passed": gate_passed,
        "max_regression_allowed": max_regression,
        "per_metric": per_metric,
        "failures": failures,
    }


class DriftCheckRequest(BaseModel):
    model_config = {"protected_namespaces": (), "extra": "forbid"}
    architecture: str = Field("RandomForest", description="Model architecture to check drift for")
    force_retrain: bool = Field(False, description="Whether to request candidate retraining (offline/non-production only)")
    use_buffer: bool = Field(True, description="Whether to evaluate real accumulated observations from InferenceBuffer")
    shift_feature: Optional[str] = Field(None, description="Feature to simulate drift on (for testing)")
    shift_multiplier: float = Field(1.0, description="Multiplicative shift to apply to the shifted feature")
    shift_offset: float = Field(0.0, description="Additive offset to apply to the shifted feature")
    n_samples: int = Field(300, description="Number of samples for synthetic drift batch")


class PromoteRequest(BaseModel):
    model_config = {"protected_namespaces": (), "extra": "forbid"}
    version_id: str = Field(..., description="Version ID of the candidate to promote to active")
    expected_active_version_id: Optional[str] = Field(None, description="Expected current active version for CAS")
    expected_activation_generation: int = Field(..., ge=0, description="Expected shared activation generation")


class RegisterBundleRequest(BaseModel):
    model_config = {"protected_namespaces": (), "extra": "forbid"}
    bundle_id: str = Field(..., min_length=1, max_length=128)
    bundle_manifest_sha256: str = Field(..., pattern=r"^[0-9a-f]{64}$")


class RollbackRequest(BaseModel):
    model_config = {"protected_namespaces": (), "extra": "forbid"}
    expected_active_version_id: str = Field(..., min_length=1)
    expected_activation_generation: int = Field(..., ge=1)


class ValidateRequest(BaseModel):
    model_config = {"protected_namespaces": (), "extra": "forbid"}
    evaluation_run_id: str = Field(..., min_length=1, max_length=128)


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
def register_model_version(payload: RegisterBundleRequest, store=Depends(get_version_store)):
    """
    Registers a new CANDIDATE into the persistent version registry.
    API registration never activates a model directly.
    """
    artifact_store = getattr(store, "artifact_store", None)
    if artifact_store is None:
        raise HTTPException(status_code=503, detail={"code": "MODEL_ARTIFACT_STORE_UNAVAILABLE", "message": "Shared immutable model storage is unavailable."})
    bundle_dir = None
    try:
        bundle_dir = artifact_store.get_bundle(payload.bundle_id, payload.bundle_manifest_sha256)
        verified = artifact_store.verify_bundle(bundle_dir, payload.bundle_manifest_sha256)
        verified["bundle_dir"] = bundle_dir
        register_verified = getattr(store, "register_verified_bundle", None)
        if not callable(register_verified):
            raise HTTPException(status_code=503, detail={"code": "MODEL_BUNDLE_REGISTRATION_UNAVAILABLE", "message": "This registry backend cannot register complete immutable bundles."})
        version = register_verified(verified, artifact_store, activate_if_empty=False)
        return {"version": version, "lifecycle_state": version.get("lifecycle_state", "CANDIDATE")}
    except HTTPException:
        raise
    except Exception as exc:
        logger.warning("Candidate bundle registration rejected: %s", type(exc).__name__)
        raise HTTPException(status_code=409, detail={"code": "MODEL_BUNDLE_REGISTRATION_REJECTED", "message": "The candidate bundle could not be verified or registered."}) from exc
    finally:
        if bundle_dir is not None and hasattr(artifact_store, "database"):
            import shutil
            shutil.rmtree(bundle_dir.parent, ignore_errors=True)


@registry_router.post("/validate/{version_id}", dependencies=[Depends(verify_registry_operator)])
def validate_version(version_id: str, payload: ValidateRequest, store=Depends(get_version_store)):
    candidate = store.get_version(version_id)
    if not candidate:
        raise HTTPException(status_code=404, detail="Model version not found")
    if candidate.get("lifecycle_state") != "SHADOW":
        raise HTTPException(status_code=409, detail="Only SHADOW models can become VALIDATED")
    get_evidence = getattr(store, "get_evaluation_evidence", None)
    if not callable(get_evidence):
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={
                "code": "VALIDATION_EVIDENCE_UNAVAILABLE",
                "message": "The registry has no immutable evaluator-produced evidence store; operator-supplied metrics cannot validate a candidate.",
            },
        )
    evidence = get_evidence(payload.evaluation_run_id)
    if not evidence or evidence.get("candidate_bundle_hash") != candidate.get("bundle_manifest_sha256"):
        raise HTTPException(status_code=409, detail="Evaluation evidence is absent or bound to a different candidate bundle.")
    metrics = evidence.get("metrics")
    if not isinstance(metrics, dict) or any(
        name not in metrics or not isinstance(metrics[name], (int, float))
        or not math.isfinite(metrics[name]) or not 0.0 <= metrics[name] <= 1.0
        for name in PROMOTION_TRACKED_METRICS
    ):
        raise HTTPException(status_code=409, detail="Immutable evaluation evidence is incomplete or invalid.")
    validate = getattr(store, "validate_version_with_evidence", None)
    if not callable(validate):
        raise HTTPException(status_code=503, detail={"code": "VALIDATION_EVIDENCE_UNAVAILABLE", "message": "This registry cannot persist evidence-bound validation."})
    try:
        return validate(version_id, payload.evaluation_run_id)
    except (ValueError, RuntimeError) as exc:
        raise HTTPException(status_code=409, detail="Candidate validation evidence changed or lifecycle state is stale.") from exc


@registry_router.post("/promote", status_code=status.HTTP_200_OK, dependencies=[Depends(verify_registry_operator)])
def promote_version(
    payload: PromoteRequest,
    store = Depends(get_version_store),
):
    """Preload and smoke-validate the exact candidate before atomic activation."""
    candidate = store.get_version(payload.version_id)
    if not candidate:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Candidate version '{payload.version_id}' not found in registry."
        )

    if candidate.get("lifecycle_state") != "VALIDATED":
        raise HTTPException(status_code=409, detail={"code": "MODEL_NOT_VALIDATED", "message": "Only evidence-validated bundles may be promoted."})
    current = store.get_active_model(candidate["model_architecture"])
    current_id = current.get("version_id") if current else None
    current_generation = int(current.get("activation_generation", 0)) if current else 0
    if current_id != payload.expected_active_version_id or current_generation != payload.expected_activation_generation:
        raise HTTPException(status_code=409, detail={"code": "MODEL_ACTIVATION_CONFLICT", "message": "Active model changed; refresh and retry with the current generation."})
    from model.serving.control_plane import ModelReconciliationError, preload_registered_bundle
    try:
        preloaded = preload_registered_bundle(candidate, store)
        active = store.activate_version(
            payload.version_id,
            expected_active_version_id=current_id,
            expected_activation_generation=current_generation,
        )
        preloaded.loaded_activation_generation = int(active["activation_generation"])
        aliases = {"RandomForest": ["random_forest", "rf"], "PyTorch_MLP": ["mlp", "pytorch"], "FT_Transformer": ["ft_transformer"]}[candidate["model_architecture"]]
        registry.replace_aliases(aliases, preloaded)
        return {"status": "promoted", "active_model": active}
    except ModelReconciliationError as exc:
        raise HTTPException(status_code=409, detail={"code": "MODEL_PRELOAD_FAILED", "message": "Candidate bundle failed preload and remained inactive."}) from exc
    except Exception as exc:
        raise HTTPException(status_code=409, detail={"code": "MODEL_ACTIVATION_CONFLICT", "message": "Candidate activation failed; the prior active model remains authoritative."}) from exc


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
    Drift checks are diagnostic in production. Explicit non-production offline
    requests may create a non-serving-qualified candidate bundle; promotion is
    never automatic.
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
    payload: RollbackRequest,
    store = Depends(get_version_store),
):
    """Rolls back the active model to a specific registered version with tamper-evident verification."""
    target = store.get_version(version_id)
    if not target:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Model version not found")
    current = store.get_active_model(target["model_architecture"])
    current_id = current.get("version_id") if current else None
    generation = int(current.get("activation_generation", 0)) if current else 0
    if current_id != payload.expected_active_version_id or generation != payload.expected_activation_generation:
        raise HTTPException(status_code=409, detail={"code": "MODEL_ACTIVATION_CONFLICT", "message": "Active model changed; refresh and retry with the current generation."})
    from model.serving.control_plane import ModelReconciliationError, preload_registered_bundle
    try:
        preloaded = preload_registered_bundle(target, store)
        active = store.activate_version(
            version_id,
            expected_active_version_id=current_id,
            expected_activation_generation=generation,
        )
        preloaded.loaded_activation_generation = int(active["activation_generation"])
        aliases = {"RandomForest": ["random_forest", "rf"], "PyTorch_MLP": ["mlp", "pytorch"], "FT_Transformer": ["ft_transformer"]}[target["model_architecture"]]
        registry.replace_aliases(aliases, preloaded)
        return {"status": "rolled_back", "active_model": active}
    except ModelReconciliationError as exc:
        raise HTTPException(status_code=409, detail={"code": "MODEL_PRELOAD_FAILED", "message": "Rollback target bundle failed verification; current model remains active."}) from exc
    except Exception as exc:
        raise HTTPException(status_code=409, detail={"code": "MODEL_ACTIVATION_CONFLICT", "message": "Rollback activation failed; current model remains authoritative."}) from exc


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

    bundle_manifest_hash = version.get("bundle_manifest_sha256")
    if not version.get("bundle_id") or not bundle_manifest_hash:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "MODEL_BUNDLE_NOT_VERIFIED",
                "message": "Candidate has no registry-pinned complete artifact bundle; it cannot enter shadow evaluation.",
            },
        )
    arch = version["model_architecture"]
    from model.serving.control_plane import ModelReconciliationError, preload_registered_bundle
    try:
        pred = preload_registered_bundle(version, store)
    except ModelReconciliationError as exc:
        raise HTTPException(status_code=409, detail={"code": "MODEL_BUNDLE_UNAVAILABLE", "message": "Candidate bundle failed verification or preload."}) from exc

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
