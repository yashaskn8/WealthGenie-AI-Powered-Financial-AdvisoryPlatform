"""Reproduce candidate training data and persist measured, immutable test evidence."""

from __future__ import annotations

import hashlib
import json
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np
from sklearn.metrics import accuracy_score, balanced_accuracy_score, f1_score

from model.config import TrainingConfig
from model.data.dataset import create_stratified_split_indices
from model.data.preprocessing import (
    compute_dataset_hash_from_arrays,
    prepare_synthetic_training_data,
)
from model.data.feature_engineering import FEATURE_NAMES, FEATURE_SCHEMA_VERSION
from model.artifacts.bundle import verify_bundle
from model.serving.inference import (
    FTTransformerPredictor,
    MLPPredictor,
    RandomForestPredictor,
)


_PREDICTORS = {
    "RandomForest": RandomForestPredictor,
    "PyTorch_MLP": MLPPredictor,
    "FT_Transformer": FTTransformerPredictor,
}
_EVALUATOR_VERSION = "candidate-heldout-evaluator-v1"
_GIT_SHA_PATTERN = re.compile(r"^[0-9a-f]{40,64}$")


def _canonical_sha256(value: Any) -> str:
    payload = json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _reproduce_test_split(manifest: dict[str, Any]) -> tuple[np.ndarray, np.ndarray, np.ndarray, str]:
    lineage = manifest.get("dataset_lineage")
    if not isinstance(lineage, dict):
        raise ValueError("candidate bundle has no reproducible dataset lineage")
    params = lineage.get("generation_parameters")
    if not isinstance(params, dict) or params.get("generator_name") != "prepare_synthetic_training_data":
        raise ValueError("candidate dataset generator is unsupported")
    if params.get("feature_schema_version") != FEATURE_SCHEMA_VERSION:
        raise ValueError("candidate dataset feature schema is unsupported")
    classes = lineage.get("target_classes")
    if classes != manifest.get("target_classes"):
        raise ValueError("candidate dataset class mapping differs from the artifact manifest")

    X, y = prepare_synthetic_training_data(
        num_samples=int(params["num_samples"]), seed=int(params["seed"])
    )
    reproduced_hash = compute_dataset_hash_from_arrays(X, y)
    if reproduced_hash != manifest.get("training_data_hash"):
        raise ValueError("reproduced candidate training dataset hash does not match its manifest")

    split = lineage.get("split_identity")
    if not isinstance(split, dict):
        raise ValueError("candidate split identity is missing")
    config = TrainingConfig(
        random_seed=int(split["split_seed"]),
        val_split=float(split["validation_fraction"]),
        test_split=float(split["test_fraction"]),
    )
    train_indices, validation_indices, test_indices = create_stratified_split_indices(y, config)
    from model.artifacts.provenance import hash_split_indices

    for name, indices in (
        ("train_indices_sha256", train_indices),
        ("validation_indices_sha256", validation_indices),
        ("test_indices_sha256", test_indices),
    ):
        if hash_split_indices(indices) != split.get(name):
            raise ValueError(f"reproduced {name} does not match the candidate manifest")
    return X[test_indices], y[test_indices], test_indices, reproduced_hash


def evaluate_candidate_bundle(
    *,
    version_store: Any,
    version_id: str,
    evaluator_git_sha: str,
) -> dict[str, Any]:
    """Evaluate a registered SHADOW bundle on its reproduced held-out test split.

    Metrics are computed from predictions, never accepted from caller input. The
    evidence is bound to the candidate bundle, data, evaluator, and report hash.
    """
    if not isinstance(evaluator_git_sha, str) or not _GIT_SHA_PATTERN.fullmatch(evaluator_git_sha):
        raise ValueError("evaluator git SHA must be a full immutable hexadecimal revision")
    candidate = version_store.get_version(version_id)
    if not candidate or candidate.get("lifecycle_state") != "SHADOW":
        raise ValueError("only a registered SHADOW candidate can be evaluated")
    artifact_store = getattr(version_store, "artifact_store", None)
    if artifact_store is None:
        raise RuntimeError("verified shared artifact storage is unavailable")
    bundle_dir = artifact_store.get_bundle(
        candidate["bundle_id"], candidate["bundle_manifest_sha256"]
    )
    predictor = None
    try:
        verified = verify_bundle(
            Path(bundle_dir), candidate["bundle_manifest_sha256"],
            require_serving_qualified=True,
        )
        manifest = verified["manifest"]
        if manifest["architecture"] != candidate.get("model_architecture"):
            raise ValueError("bundle architecture does not match the registered candidate")
        if manifest.get("training_data_hash") != candidate.get("training_data_hash"):
            raise ValueError("candidate registry data hash differs from the immutable bundle lineage")
        if manifest["feature_schema_version"] != FEATURE_SCHEMA_VERSION:
            raise ValueError("candidate feature schema is unsupported")
        X_test, y_test, test_indices, training_hash = _reproduce_test_split(manifest)
        predictor_type = _PREDICTORS.get(manifest["architecture"])
        if predictor_type is None:
            raise ValueError("candidate architecture has no qualified evaluator")
        predictor = predictor_type()
        predictor.load_artifacts(
            bundle_dir=Path(bundle_dir),
            expected_bundle_hash=candidate["bundle_manifest_sha256"],
            version_id=version_id,
            require_serving_qualified=True,
        )
        probabilities = np.asarray(predictor.predict_proba(X_test), dtype=np.float64)
        if probabilities.shape != (len(y_test), len(manifest["target_classes"])):
            raise ValueError("candidate output dimensions do not match target classes")
        if not np.isfinite(probabilities).all():
            raise ValueError("candidate emitted non-finite evaluation predictions")
        y_pred = np.argmax(probabilities, axis=1).astype(np.int64)
        labels = np.arange(len(manifest["target_classes"]), dtype=np.int64)
        metrics = {
            "rule_approximation_fidelity": float(accuracy_score(y_test, y_pred)),
            "balanced_accuracy": float(balanced_accuracy_score(y_test, y_pred)),
            "macro_f1": float(f1_score(y_test, y_pred, labels=labels, average="macro", zero_division=0)),
        }
        if any(not np.isfinite(value) or not 0.0 <= value <= 1.0 for value in metrics.values()):
            raise ValueError("candidate metrics are not finite normalized values")
        test_dataset_hash = hashlib.sha256(
            np.column_stack((X_test, y_test)).astype(np.float64).tobytes()
            + np.asarray(test_indices, dtype=np.int64).tobytes()
        ).hexdigest()
        report = {
            "evaluation_run_id": str(uuid.uuid4()),
            "candidate_version_id": version_id,
            "candidate_bundle_id": candidate["bundle_id"],
            "candidate_bundle_hash": candidate["bundle_manifest_sha256"],
            "training_data_hash": training_hash,
            "evaluation_dataset_hash": test_dataset_hash,
            "split": "manifest-bound held-out test split",
            "metric_interpretation": "synthetic suitability-policy approximation only; not investor outcomes or financial authority",
            "test_samples": int(len(y_test)),
            "feature_schema_version": FEATURE_SCHEMA_VERSION,
            "target_classes": manifest["target_classes"],
            "metrics": metrics,
            "evaluator_version": _EVALUATOR_VERSION,
            "evaluator_git_sha": evaluator_git_sha,
            "evaluated_at": datetime.now(timezone.utc).isoformat(),
        }
        report_payload = report
        report_sha = _canonical_sha256(report_payload)
        evidence = {
            "evaluation_run_id": report["evaluation_run_id"],
            "candidate_version_id": version_id,
            "candidate_bundle_id": candidate["bundle_id"],
            "candidate_bundle_hash": candidate["bundle_manifest_sha256"],
            "evaluation_dataset_hash": test_dataset_hash,
            "evaluator_version": _EVALUATOR_VERSION,
            "evaluator_git_sha": evaluator_git_sha,
            "metrics": metrics,
            "timestamp": report["evaluated_at"],
            "report_sha256": report_sha,
            "report": report_payload,
        }
        stored = version_store.record_evaluation_evidence(evidence)
        return stored | {"report": {**report_payload, "report_sha256": report_sha}}
    finally:
        if predictor is not None:
            materialized = getattr(predictor, "_materialized_bundle_dir", None)
            if materialized:
                import shutil
                shutil.rmtree(materialized, ignore_errors=True)
        if hasattr(artifact_store, "database"):
            import shutil
            shutil.rmtree(Path(bundle_dir).parent, ignore_errors=True)
