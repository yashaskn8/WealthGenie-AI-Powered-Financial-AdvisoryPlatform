"""Shared-state model bundle loading and replica reconciliation."""

from __future__ import annotations

import shutil
from typing import Any

from model.serving.inference import FTTransformerPredictor, MLPPredictor, RandomForestPredictor
from model.serving.registry import registry
from store_factory import get_artifact_store_for_registry


class ModelReconciliationError(RuntimeError):
    """The serving process could not safely match its predictor to shared active state."""


_ARCHITECTURES = {
    "RandomForest": ("random_forest", "rf", RandomForestPredictor),
    "PyTorch_MLP": ("mlp", "pytorch", MLPPredictor),
    "FT_Transformer": ("ft_transformer", FTTransformerPredictor),
}


def _same_active_identity(predictor: Any, active: dict[str, Any]) -> bool:
    return bool(
        predictor
        and predictor.is_loaded
        and str(getattr(predictor, "loaded_version_id", "")) == str(active.get("version_id", ""))
        and getattr(predictor, "loaded_bundle_id", None) == active.get("bundle_id")
        and getattr(predictor, "loaded_bundle_hash", None) == active.get("bundle_manifest_sha256")
        and getattr(predictor, "loaded_feature_schema_version", None) == active.get("feature_schema_version")
        and int(getattr(predictor, "loaded_activation_generation", -1)) == int(active.get("activation_generation", -2))
    )


def _discard_unpublished(predictor: Any) -> None:
    materialized = getattr(predictor, "_materialized_bundle_dir", None)
    if materialized:
        shutil.rmtree(materialized, ignore_errors=True)


def preload_registered_bundle(version: dict[str, Any], version_store: Any):
    """Verify and smoke-load a registry-bound bundle without publishing it."""
    required = ("version_id", "bundle_id", "bundle_manifest_sha256", "feature_schema_version")
    if any(version.get(field) in (None, "") for field in required):
        raise ModelReconciliationError("model version has incomplete immutable bundle identity")
    architecture = version.get("model_architecture")
    if architecture not in _ARCHITECTURES:
        raise ModelReconciliationError("unsupported model architecture")
    artifact_store = getattr(version_store, "artifact_store", None)
    if artifact_store is None:
        try:
            artifact_store = get_artifact_store_for_registry(version_store)
            version_store.artifact_store = artifact_store
        except Exception as exc:
            raise ModelReconciliationError("shared immutable artifact store is unavailable") from exc
    predictor_type = _ARCHITECTURES[architecture][-1]
    predictor = predictor_type()
    bundle_dir = None
    try:
        bundle_dir = artifact_store.get_bundle(version["bundle_id"], version["bundle_manifest_sha256"])
        predictor.load_artifacts(
            bundle_dir=bundle_dir,
            expected_bundle_hash=version["bundle_manifest_sha256"],
            version_id=str(version["version_id"]),
        )
        predictor.loaded_activation_generation = int(version.get("activation_generation", 0))
        if (
            predictor.loaded_bundle_id != version["bundle_id"]
            or predictor.loaded_bundle_hash != version["bundle_manifest_sha256"]
            or predictor.loaded_feature_schema_version != version["feature_schema_version"]
        ):
            raise ModelReconciliationError("preloaded bundle identity differs from its registry record")
        return predictor
    except Exception as exc:
        _discard_unpublished(predictor)
        if isinstance(exc, ModelReconciliationError):
            raise
        raise ModelReconciliationError("registered model bundle failed verification or preload") from exc
    finally:
        if bundle_dir is not None and hasattr(artifact_store, "database"):
            shutil.rmtree(bundle_dir.parent, ignore_errors=True)


def ensure_active_model_loaded(architecture: str):
    """Load the exact shared active bundle, swapping only after verification.

    The registry pointer is checked both before and after preload. If it moves
    during loading, that predictor is discarded and the operation retries;
    an old in-memory model is never returned under a newer registry identity.
    """
    if architecture not in _ARCHITECTURES:
        raise ModelReconciliationError("unsupported model architecture")
    version_store = registry.get_version_registry()
    if version_store is None:
        raise ModelReconciliationError("shared model registry is unavailable")
    aliases = _ARCHITECTURES[architecture]
    primary_key = aliases[0]

    for _attempt in range(3):
        try:
            active = version_store.get_active_model(architecture)
        except Exception as exc:
            raise ModelReconciliationError("active model registry could not be read") from exc
        if not active:
            raise ModelReconciliationError("no active model bundle is registered")
        required = ("version_id", "bundle_id", "bundle_manifest_sha256", "feature_schema_version", "activation_generation")
        if any(active.get(field) in (None, "") for field in required):
            raise ModelReconciliationError("active model record has incomplete immutable bundle identity")

        current = registry.get(primary_key)
        if _same_active_identity(current, active):
            return current

        candidate = None
        try:
            candidate = preload_registered_bundle(active, version_store)
            if not _same_active_identity(candidate, active):
                raise ModelReconciliationError("preloaded model identity differs from the active registry record")

            latest = version_store.get_active_model(architecture)
            if not latest or any(latest.get(key) != active.get(key) for key in required):
                _discard_unpublished(candidate)
                continue

            registry.replace_aliases(list(aliases[:-1]), candidate)
            return candidate
        except ModelReconciliationError:
            _discard_unpublished(candidate)
            raise
        except Exception as exc:
            _discard_unpublished(candidate)
            raise ModelReconciliationError("active model bundle failed verification or preload") from exc
    raise ModelReconciliationError("active model changed repeatedly during reconciliation")
