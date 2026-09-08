"""Small immutable artifact registry for the market-context shadow model."""

from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np
from hmmlearn.hmm import GaussianHMM
from sklearn.preprocessing import StandardScaler

from . import FEATURE_SCHEMA_VERSION, MODEL_FAMILY, MODEL_ROLE
from .hmm_model import diagonal_covariances

REGISTRY_SCHEMA_VERSION = "market-context-model-registry-1.0.0"
ARTIFACT_SCHEMA_VERSION = "market-context-hmm-artifact-1.0.0"
VERSION_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$")


class ArtifactValidationError(RuntimeError):
    """Raised when a shadow artifact cannot be trusted."""


@dataclass(frozen=True)
class LoadedShadowArtifact:
    metadata: dict[str, Any]
    start_probabilities: np.ndarray
    transition_matrix: np.ndarray
    means: np.ndarray
    diagonal_covariances: np.ndarray
    scaler_mean: np.ndarray
    scaler_scale: np.ndarray
    feature_names: tuple[str, ...]
    reference_features: np.ndarray

    def scale(self, values: np.ndarray) -> np.ndarray:
        matrix = np.asarray(values, dtype=float)
        if matrix.ndim != 2 or matrix.shape[1] != len(self.feature_names):
            raise ArtifactValidationError("MODEL_FEATURE_COUNT_MISMATCH")
        return (matrix - self.scaler_mean) / self.scaler_scale


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def write_shadow_artifact(
    output_directory: Path,
    *,
    model: GaussianHMM,
    scaler: StandardScaler,
    feature_names: tuple[str, ...],
    reference_features: np.ndarray,
    metadata: dict[str, Any],
) -> tuple[Path, Path, dict[str, Any]]:
    version = str(metadata.get("modelVersion", ""))
    if not VERSION_PATTERN.fullmatch(version):
        raise ValueError("MODEL_VERSION_INVALID")
    if metadata.get("role") != MODEL_ROLE or metadata.get("modelFamily") != MODEL_FAMILY:
        raise ValueError("SHADOW_MODEL_IDENTITY_INVALID")
    if metadata.get("featureSchemaVersion") != FEATURE_SCHEMA_VERSION:
        raise ValueError("MODEL_FEATURE_SCHEMA_MISMATCH")
    output_directory.mkdir(parents=True, exist_ok=True)
    artifact_path = output_directory / f"{version}.npz"
    registry_path = output_directory / "registry.json"
    if artifact_path.exists() or registry_path.exists():
        raise FileExistsError("Model artifacts are immutable and may not be silently overwritten.")

    np.savez_compressed(
        artifact_path,
        artifact_schema_version=np.asarray(ARTIFACT_SCHEMA_VERSION),
        feature_schema_version=np.asarray(metadata["featureSchemaVersion"]),
        model_version=np.asarray(version),
        dataset_version=np.asarray(metadata["datasetVersion"]),
        start_probabilities=np.asarray(model.startprob_, dtype=float),
        transition_matrix=np.asarray(model.transmat_, dtype=float),
        means=np.asarray(model.means_, dtype=float),
        diagonal_covariances=diagonal_covariances(model),
        scaler_mean=np.asarray(scaler.mean_, dtype=float),
        scaler_scale=np.asarray(scaler.scale_, dtype=float),
        feature_names=np.asarray(feature_names),
        reference_features=np.asarray(reference_features, dtype=float),
    )
    checksum = sha256_file(artifact_path)
    model_entry = {
        **metadata,
        "artifactFile": artifact_path.name,
        "artifactChecksumSha256": checksum,
        "artifactSchemaVersion": ARTIFACT_SCHEMA_VERSION,
    }
    registry = {
        "schemaVersion": REGISTRY_SCHEMA_VERSION,
        "champion": {
            "modelFamily": "DETERMINISTIC_POLICY",
            "modelVersion": "market-context-policy-1.0.0",
            "role": "CHAMPION",
        },
        "models": [model_entry],
        "createdAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "automaticPromotion": False,
    }
    registry_path.write_text(json.dumps(registry, indent=2) + "\n", encoding="utf-8")
    return artifact_path, registry_path, registry


def _required_array(archive: Any, name: str) -> np.ndarray:
    if name not in archive.files:
        raise ArtifactValidationError(f"MODEL_ARTIFACT_FIELD_MISSING:{name}")
    value = np.asarray(archive[name])
    if value.dtype.kind in {"f", "i", "u"} and not np.isfinite(value).all():
        raise ArtifactValidationError(f"MODEL_ARTIFACT_NON_FINITE:{name}")
    return value


def load_shadow_artifact(
    registry_path: Path,
    *,
    expected_feature_schema_version: str = FEATURE_SCHEMA_VERSION,
) -> LoadedShadowArtifact:
    if not registry_path.is_file():
        raise ArtifactValidationError("MODEL_REGISTRY_MISSING")
    try:
        registry = json.loads(registry_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ArtifactValidationError("MODEL_REGISTRY_INVALID") from exc
    if registry.get("schemaVersion") != REGISTRY_SCHEMA_VERSION:
        raise ArtifactValidationError("MODEL_REGISTRY_SCHEMA_MISMATCH")
    champion = registry.get("champion")
    if champion != {
        "modelFamily": "DETERMINISTIC_POLICY",
        "modelVersion": "market-context-policy-1.0.0",
        "role": "CHAMPION",
    } or registry.get("automaticPromotion") is not False:
        raise ArtifactValidationError("MODEL_REGISTRY_AUTHORITY_BOUNDARY_INVALID")
    models = registry.get("models")
    if not isinstance(models, list) or len(models) != 1:
        raise ArtifactValidationError("MODEL_REGISTRY_SHADOW_ENTRY_INVALID")
    metadata = models[0]
    if metadata.get("role") != MODEL_ROLE or metadata.get("modelFamily") != MODEL_FAMILY:
        raise ArtifactValidationError("MODEL_REGISTRY_ROLE_INVALID")
    if metadata.get("qualificationStatus") != "QUALIFIED_FOR_SHADOW_OBSERVATION_ONLY" \
            or metadata.get("controlsAllocation") is not False:
        raise ArtifactValidationError("MODEL_REGISTRY_QUALIFICATION_INVALID")
    if metadata.get("featureSchemaVersion") != expected_feature_schema_version:
        raise ArtifactValidationError("MODEL_FEATURE_SCHEMA_MISMATCH")
    artifact_file = metadata.get("artifactFile")
    if not isinstance(artifact_file, str) or Path(artifact_file).name != artifact_file:
        raise ArtifactValidationError("MODEL_ARTIFACT_PATH_INVALID")
    artifact_path = registry_path.parent / artifact_file
    if not artifact_path.is_file():
        raise ArtifactValidationError("MODEL_ARTIFACT_MISSING")
    if sha256_file(artifact_path) != metadata.get("artifactChecksumSha256"):
        raise ArtifactValidationError("MODEL_ARTIFACT_CHECKSUM_MISMATCH")
    try:
        with np.load(artifact_path, allow_pickle=False) as archive:
            artifact_schema = str(_required_array(archive, "artifact_schema_version").item())
            if artifact_schema != ARTIFACT_SCHEMA_VERSION:
                raise ArtifactValidationError("MODEL_ARTIFACT_SCHEMA_MISMATCH")
            if str(_required_array(archive, "feature_schema_version").item()) != metadata.get("featureSchemaVersion"):
                raise ArtifactValidationError("MODEL_FEATURE_SCHEMA_MISMATCH")
            if str(_required_array(archive, "model_version").item()) != metadata.get("modelVersion"):
                raise ArtifactValidationError("MODEL_VERSION_MISMATCH")
            if str(_required_array(archive, "dataset_version").item()) != metadata.get("datasetVersion"):
                raise ArtifactValidationError("MODEL_DATASET_VERSION_MISMATCH")
            loaded = LoadedShadowArtifact(
                metadata=metadata,
                start_probabilities=_required_array(archive, "start_probabilities").astype(float),
                transition_matrix=_required_array(archive, "transition_matrix").astype(float),
                means=_required_array(archive, "means").astype(float),
                diagonal_covariances=_required_array(archive, "diagonal_covariances").astype(float),
                scaler_mean=_required_array(archive, "scaler_mean").astype(float),
                scaler_scale=_required_array(archive, "scaler_scale").astype(float),
                feature_names=tuple(str(value) for value in _required_array(archive, "feature_names").tolist()),
                reference_features=_required_array(archive, "reference_features").astype(float),
            )
    except ArtifactValidationError:
        raise
    except Exception as exc:
        raise ArtifactValidationError("MODEL_ARTIFACT_INVALID") from exc
    if loaded.means.ndim != 2 or loaded.means.shape[1] != len(loaded.feature_names):
        raise ArtifactValidationError("MODEL_ARTIFACT_DIMENSION_MISMATCH")
    state_count = loaded.means.shape[0]
    if loaded.start_probabilities.shape != (state_count,) \
            or loaded.transition_matrix.shape != (state_count, state_count) \
            or loaded.diagonal_covariances.shape != loaded.means.shape:
        raise ArtifactValidationError("MODEL_ARTIFACT_DIMENSION_MISMATCH")
    if not np.isclose(loaded.start_probabilities.sum(), 1.0) \
            or not np.allclose(loaded.transition_matrix.sum(axis=1), 1.0) \
            or np.any(loaded.start_probabilities < 0) \
            or np.any(loaded.transition_matrix < 0) \
            or np.any(loaded.diagonal_covariances <= 0):
        raise ArtifactValidationError("MODEL_ARTIFACT_PROBABILITY_INVALID")
    if loaded.scaler_mean.shape != (len(loaded.feature_names),) or loaded.scaler_scale.shape != loaded.scaler_mean.shape:
        raise ArtifactValidationError("MODEL_SCALER_DIMENSION_MISMATCH")
    if np.any(loaded.scaler_scale <= 0):
        raise ArtifactValidationError("MODEL_SCALER_INVALID")
    if loaded.reference_features.ndim != 2 or loaded.reference_features.shape[1] != len(loaded.feature_names):
        raise ArtifactValidationError("MODEL_REFERENCE_FEATURES_INVALID")
    return loaded
