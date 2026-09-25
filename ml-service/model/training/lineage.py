"""Shared, reproducible lineage for non-authoritative model training runs."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import numpy as np

from model.artifacts.provenance import hash_split_indices, resolve_training_git_sha
from model.config import TrainingConfig
from model.data.dataset import create_stratified_split_indices
from model.data.feature_engineering import FEATURE_NAMES, FEATURE_SCHEMA_VERSION
from model.data.preprocessing import compute_dataset_hash_from_arrays, get_dataset_generation_params


TRAINING_SOURCE_PATHS = (
    "ml-service/model/architecture/base.py",
    "ml-service/model/architecture/ft_transformer.py",
    "ml-service/model/architecture/model.py",
    "ml-service/model/config.py",
    "ml-service/model/data/dataset.py",
    "ml-service/model/data/data_validator.py",
    "ml-service/model/data/feature_engineering.py",
    "ml-service/model/data/preprocessing.py",
    "ml-service/model/evaluation/evaluate.py",
    "ml-service/model/evaluation/experiments.py",
    "ml-service/model/evaluation/visualizer.py",
    "ml-service/model/training/lineage.py",
    "ml-service/model/training/train_pytorch.py",
    "ml-service/model/training/train_rf.py",
    "ml-service/model/artifacts/bundle.py",
    "ml-service/model/artifacts/provenance.py",
    "ml-service/scripts/requalify_model_bundles.py",
)


def current_training_git_sha() -> str | None:
    """Return a commit only when every code input in the training contract is clean."""
    repository_root = Path(__file__).resolve().parents[3]
    return resolve_training_git_sha(repository_root, TRAINING_SOURCE_PATHS)


def build_dataset_lineage(
    X: np.ndarray,
    y: np.ndarray,
    *,
    seed: int,
    config: TrainingConfig,
    target_classes: list[str],
) -> tuple[str, dict[str, Any], tuple[np.ndarray, np.ndarray, np.ndarray]]:
    """Hash the reproduced dataset and its explicit stratified split contract."""
    features = np.asarray(X, dtype=np.float64)
    labels = np.asarray(y, dtype=np.int64)
    if features.ndim != 2 or features.shape[1] != len(FEATURE_NAMES) or len(features) != len(labels):
        raise ValueError("dataset does not match the declared feature contract")
    if not target_classes or not set(np.unique(labels)).issubset(set(range(len(target_classes)))):
        raise ValueError("dataset labels exceed the declared target class mapping")

    train_indices, validation_indices, test_indices = create_stratified_split_indices(labels, config)
    generation_parameters = {
        **get_dataset_generation_params(num_samples=len(features), seed=seed),
        "generator_version": "recommendation-policy-synthetic-v1",
        "policy_config_version": "suitability-freeze-1.0.0",
        "split_seed": seed,
        "split_fractions": {
            "train": 1.0 - config.val_split - config.test_split,
            "validation": config.val_split,
            "test": config.test_split,
        },
        "stratified": True,
    }
    split_identity = {
        "train_indices_sha256": hash_split_indices(train_indices),
        "validation_indices_sha256": hash_split_indices(validation_indices),
        "test_indices_sha256": hash_split_indices(test_indices),
        "split_seed": seed,
        "train_fraction": generation_parameters["split_fractions"]["train"],
        "validation_fraction": config.val_split,
        "test_fraction": config.test_split,
        "stratified": True,
    }
    lineage = {
        "generator": "model.data.preprocessing.prepare_synthetic_training_data",
        "generation_parameters": generation_parameters,
        "feature_schema_version": FEATURE_SCHEMA_VERSION,
        "feature_names": list(FEATURE_NAMES),
        "target_classes": list(target_classes),
        "split_identity": split_identity,
    }
    return compute_dataset_hash_from_arrays(features, labels), lineage, (
        train_indices,
        validation_indices,
        test_indices,
    )
