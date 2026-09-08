"""Fail-closed inference for the non-authoritative HMM shadow candidate."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from . import FEATURE_SCHEMA_VERSION, MODEL_ROLE
from .drift import drift_diagnostics
from .features import FEATURE_NAMES, build_feature_frame
from .hmm_model import causal_filter_parameters
from .registry import ArtifactValidationError, load_shadow_artifact


def unavailable_shadow(reason_code: str) -> dict[str, Any]:
    return {
        "status": "MODEL_CONTEXT_UNAVAILABLE",
        "role": MODEL_ROLE,
        "modelFamily": None,
        "modelVersion": None,
        "state": None,
        "semanticContext": None,
        "probabilities": None,
        "observedAt": None,
        "featureSchemaVersion": FEATURE_SCHEMA_VERSION,
        "datasetVersion": None,
        "reasonCodes": [reason_code, "DETERMINISTIC_CHAMPION_UNCHANGED"],
        "drift": None,
    }


def infer_shadow_context(dataset: dict[str, Any], registry_path: Path) -> dict[str, Any]:
    artifact = load_shadow_artifact(registry_path)
    feature_frame = build_feature_frame(dataset)
    if len(feature_frame) < 20:
        return unavailable_shadow("INSUFFICIENT_CAUSAL_FEATURE_HISTORY")
    if tuple(artifact.feature_names) != FEATURE_NAMES:
        raise ArtifactValidationError("MODEL_FEATURE_ORDER_MISMATCH")
    raw_values = feature_frame.loc[:, list(FEATURE_NAMES)].to_numpy(dtype=float)
    scaled_values = artifact.scale(raw_values)
    _, states, _ = causal_filter_parameters(
        artifact.start_probabilities,
        artifact.transition_matrix,
        artifact.means,
        artifact.diagonal_covariances,
        scaled_values,
    )
    return {
        "status": "MODEL_CONTEXT_AVAILABLE",
        "role": MODEL_ROLE,
        "modelFamily": artifact.metadata["modelFamily"],
        "modelVersion": artifact.metadata["modelVersion"],
        "state": f"STATE_{int(states[-1])}",
        "semanticContext": None,
        "probabilities": None,
        "observedAt": feature_frame.iloc[-1]["observed_at"].isoformat().replace("+00:00", "Z"),
        "featureSchemaVersion": FEATURE_SCHEMA_VERSION,
        "datasetVersion": dataset["datasetVersion"],
        "reasonCodes": [
            "SHADOW_ONLY_NO_RECOMMENDATION_AUTHORITY",
            "CAUSAL_FILTERED_ONLINE_STATE",
            "UNSUPERVISED_STATE_HAS_NO_SEMANTIC_LABEL",
            "UNCALIBRATED_PROBABILITIES_WITHHELD",
        ],
        "drift": drift_diagnostics(artifact.reference_features, raw_values[-252:], FEATURE_NAMES),
    }
