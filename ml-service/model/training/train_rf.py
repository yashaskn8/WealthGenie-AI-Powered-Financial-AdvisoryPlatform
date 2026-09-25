"""Reproducible, non-authoritative RandomForest policy-approximation trainer."""

from __future__ import annotations

import hashlib
import json
import logging
import platform
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

import joblib
import numpy as np
import sklearn
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import accuracy_score, balanced_accuracy_score, f1_score
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import LabelEncoder, StandardScaler

from model.architecture.base import BasePredictor
from model.artifacts.bundle import MANIFEST_FILENAME, build_bundle_manifest, sha256_file, write_json_lf
from model.config import TrainingConfig
from model.data.feature_engineering import FEATURE_NAMES, FEATURE_SCHEMA_VERSION
from model.data.preprocessing import (
    prepare_synthetic_training_data,
)
from model.training.lineage import build_dataset_lineage, current_training_git_sha

logger = logging.getLogger("wealthgenie.rf_trainer")
_MODEL_DIR = Path(__file__).resolve().parent.parent / "bundles" / "random_forest"
def _metrics(model: Pipeline, X: np.ndarray, y: np.ndarray) -> dict[str, Any]:
    predictions = model.predict(X)
    return {
        "accuracy": float(accuracy_score(y, predictions)),
        "balanced_accuracy": float(balanced_accuracy_score(y, predictions)),
        "macro_f1": float(f1_score(y, predictions, average="macro", zero_division=0)),
        "samples": int(len(y)),
    }


def train_random_forest_model(
    num_samples: int = 2000,
    seed: int = 42,
    model_dir: Path = _MODEL_DIR,
    X: Optional[np.ndarray] = None,
    y_indices: Optional[np.ndarray] = None,
) -> tuple[Pipeline, LabelEncoder, dict[str, Any]]:
    """Train only on the training partition and write a complete bundle.

    ``X``/``y_indices`` permit the requalification command to generate the
    deterministic base dataset once and share the exact arrays across all
    architectures. If omitted, this canonical generator is called here.
    """
    if X is None and y_indices is None:
        X, y_indices = prepare_synthetic_training_data(num_samples=num_samples, seed=seed)
    elif X is None or y_indices is None:
        raise ValueError("X and y_indices must be supplied together")

    X = np.asarray(X, dtype=np.float64)
    y_indices = np.asarray(y_indices, dtype=np.int64)
    target_classes = list(BasePredictor.TARGET_CLASSES)
    if X.ndim != 2 or X.shape[1] != len(FEATURE_NAMES) or len(X) != len(y_indices):
        raise ValueError("training arrays do not match the feature and label contract")
    if not set(np.unique(y_indices)).issubset(set(range(len(target_classes)))):
        raise ValueError("training labels contain a class outside the canonical target allowlist")

    label_encoder = LabelEncoder()
    # Keep the model's probability-column order identical to the declared
    # canonical class order. LabelEncoder.fit() would sort alphabetically and
    # silently make the bundle's output-class metadata inaccurate.
    label_encoder.classes_ = np.asarray(target_classes, dtype=object)
    y = y_indices
    config = TrainingConfig(random_seed=seed)
    data_hash, dataset_lineage, split_indices = build_dataset_lineage(
        X,
        y_indices,
        seed=seed,
        config=config,
        target_classes=target_classes,
    )
    train_indices, validation_indices, test_indices = split_indices

    model = Pipeline([
        ("scaler", StandardScaler()),
        ("clf", RandomForestClassifier(
            n_estimators=100,
            max_depth=12,
            random_state=seed,
            n_jobs=-1,
            class_weight="balanced",
        )),
    ])
    model.fit(X[train_indices], y[train_indices])
    training_metrics = _metrics(model, X[train_indices], y[train_indices])
    validation_metrics = _metrics(model, X[validation_indices], y[validation_indices])
    test_metrics = _metrics(model, X[test_indices], y[test_indices])

    output_dir = Path(model_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    model_path = output_dir / "model.pkl"
    encoder_path = output_dir / "label_encoder.pkl"
    metadata_path = output_dir / "metadata.json"
    evaluation_path = output_dir / "evaluation_report.json"
    joblib.dump(model, model_path)
    joblib.dump(label_encoder, encoder_path)

    split_identity = dataset_lineage["split_identity"]
    training_git_sha = current_training_git_sha()
    timestamp = datetime.now(timezone.utc).isoformat()
    evaluation_id = f"rf-{data_hash[:12]}-{hashlib.sha256(timestamp.encode()).hexdigest()[:12]}"
    framework_versions = {
        "numpy": np.__version__,
        "scikit-learn": sklearn.__version__,
        "joblib": joblib.__version__,
    }
    evaluation_report = {
        "evaluation_run_id": evaluation_id,
        "architecture": "RandomForest",
        "model_version": "4.0.0",
        "artifact_identity": {
            "model_sha256": sha256_file(model_path),
            "label_encoder_sha256": sha256_file(encoder_path),
        },
        "training_data_hash": data_hash,
        "split_identity": split_identity,
        "evaluation_code_git_sha": training_git_sha,
        "training_code_git_sha": training_git_sha,
        "metric_definitions": {
            "accuracy": "fraction of split examples matching the synthetic policy label",
            "balanced_accuracy": "unweighted mean recall across target classes",
            "macro_f1": "unweighted mean class-wise F1 across target classes",
        },
        "evaluation_methodology": "fixed canonical hyperparameters; model fit only on the train partition; validation and test partitions were not used for fitting or selection",
        "hyperparameters": {
            "n_estimators": 100,
            "max_depth": 12,
            "random_state": seed,
            "n_jobs": -1,
            "class_weight": "balanced",
        },
        "training_metrics": training_metrics,
        "validation_metrics": validation_metrics,
        "test_metrics": test_metrics,
        "evaluated_at": timestamp,
        "interpretation": "synthetic suitability-policy approximation fidelity; not investor outcomes or investment performance",
    }
    write_json_lf(evaluation_path, evaluation_report)
    metadata = {
        "model_name": "RandomForest",
        "model_version": "4.0.0",
        "version": "4.0.0",
        "architecture": "RandomForest",
        "git_commit_hash": training_git_sha,
        "training_code_git_sha": training_git_sha,
        "serving_qualified": training_git_sha is not None,
        "feature_schema_version": FEATURE_SCHEMA_VERSION,
        "feature_names": list(FEATURE_NAMES),
        "target_classes": target_classes,
        "n_features": len(FEATURE_NAMES),
        "training_data_hash": data_hash,
        "dataset_lineage": dataset_lineage,
        "training_timestamp": timestamp,
        "trained_at": timestamp,
        "python_version": platform.python_version(),
        "framework_versions": framework_versions,
        "hyperparameters": {
            "n_estimators": 100,
            "max_depth": 12,
            "random_state": seed,
            "n_jobs": -1,
            "class_weight": "balanced",
        },
        "random_seed": seed,
        "training_metrics": training_metrics,
        "validation_metrics": validation_metrics,
        "test_metrics": test_metrics,
        "evaluation_run_id": evaluation_id,
        "metric_interpretation": evaluation_report["interpretation"],
    }
    write_json_lf(metadata_path, metadata)

    manifest = build_bundle_manifest(
        output_dir,
        bundle_id=f"rf-{data_hash[:12]}-{(training_git_sha or 'unqualified')[:12]}",
        architecture="RandomForest",
        model_version="4.0.0",
        feature_schema_version=FEATURE_SCHEMA_VERSION,
        feature_names=list(FEATURE_NAMES),
        target_classes=target_classes,
        training_data_hash=data_hash,
        training_code_git_sha=training_git_sha,
        training_timestamp=timestamp,
        dataset_lineage=dataset_lineage,
        python_version=platform.python_version(),
        framework_versions=framework_versions,
        evaluation_report_id=evaluation_id,
        evaluation_report_sha256=sha256_file(evaluation_path),
        serving_qualified=training_git_sha is not None,
    )
    write_json_lf(output_dir / MANIFEST_FILENAME, manifest)
    logger.info("Saved RandomForest bundle to %s (serving_qualified=%s)", output_dir, manifest["serving_qualified"])
    return model, label_encoder, metadata


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    train_random_forest_model()
