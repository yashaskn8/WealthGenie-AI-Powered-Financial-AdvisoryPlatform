"""
WealthGenie ML Microservice - Baseline RandomForest Auto-Trainer
Provides automated cold-start training for RandomForest classifier when pre-baked
model.pkl / label_encoder.pkl artifacts are absent on fresh clones or fresh container boots.
"""

import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Any, Tuple

import joblib
import numpy as np
from sklearn.ensemble import RandomForestClassifier
from sklearn.model_selection import train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler, LabelEncoder
from sklearn.metrics import balanced_accuracy_score, f1_score

from model.data.preprocessing import (
    prepare_synthetic_training_data,
    compute_dataset_hash_from_arrays,
    get_dataset_generation_params,
)
from model.data.feature_engineering import FEATURE_NAMES, FEATURE_SCHEMA_VERSION

logger = logging.getLogger("wealthgenie.rf_trainer")

_MODEL_DIR = Path(__file__).resolve().parent.parent


def train_random_forest_model(
    num_samples: int = 2000,
    seed: int = 42,
    model_dir: Path = _MODEL_DIR,
) -> Tuple[Pipeline, LabelEncoder, Dict[str, Any]]:
    """
    Trains a baseline RandomForest pipeline and exports model.pkl, label_encoder.pkl,
    and metadata.json for cold-start bootstrapping in fresh environments.
    """
    logger.info(f"Generating synthetic investment profile data (N={num_samples}, seed={seed})...")
    X, y_indices = prepare_synthetic_training_data(num_samples=num_samples, seed=seed)
    
    # 6 canonical target classes
    target_classes = ["Equity_MF", "ELSS", "ETF", "Debt_MF", "FD", "RBI_Bond"]
    y_labels = [target_classes[idx] for idx in y_indices]

    le = LabelEncoder()
    y = le.fit_transform(y_labels)

    x_train, x_test, y_train, y_test = train_test_split(
        X,
        y,
        test_size=0.20,
        random_state=seed,
        stratify=y,
    )

    logger.info("Fitting RandomForestClassifier pipeline with a stratified held-out evaluation split...")
    pipeline = Pipeline([
        ("scaler", StandardScaler()),
        ("clf", RandomForestClassifier(
            n_estimators=100,
            max_depth=12,
            random_state=seed,
            n_jobs=-1,
            class_weight="balanced",
        )),
    ])
    pipeline.fit(x_train, y_train)

    # Metrics are computed only on the untouched holdout. Refit on all
    # reproducible synthetic data after measurement for the deployable artifact.
    holdout_preds = pipeline.predict(x_test)
    holdout_accuracy = float(np.mean(holdout_preds == y_test))
    balanced_accuracy = float(balanced_accuracy_score(y_test, holdout_preds))
    macro_f1 = float(f1_score(y_test, holdout_preds, average="macro"))
    logger.info(f"RandomForest v4 held-out suitability-policy fidelity: {holdout_accuracy:.4f}")
    pipeline.fit(X, y)

    # Ensure target directories exist
    model_dir = Path(model_dir)
    model_dir.mkdir(parents=True, exist_ok=True)

    model_path = model_dir / "model.pkl"
    le_path = model_dir / "label_encoder.pkl"
    meta_path = model_dir / "metadata.json"

    joblib.dump(pipeline, model_path)
    joblib.dump(le, le_path)

    data_hash = compute_dataset_hash_from_arrays(X, np.array(y_indices))
    lineage_params = get_dataset_generation_params(num_samples=num_samples, seed=seed)

    metadata = {
        "model_name": "RandomForest",
        "git_commit_hash": "auto-trained-baseline",
        "model_version": "4.0.0",
        "dataset_version": "4.0.0",
        "feature_schema_version": FEATURE_SCHEMA_VERSION,
        "feature_names": FEATURE_NAMES,
        "n_features": len(FEATURE_NAMES),
        "training_data_hash": data_hash,
        "dataset_lineage": lineage_params,
        "policy_config_version": "suitability-freeze-1.0.0",
        "dataset_timestamp": datetime.now(timezone.utc).isoformat(),
        "trained_at": datetime.now(timezone.utc).isoformat(),
        "test_accuracy": round(holdout_accuracy, 4),
        "rule_approximation_fidelity": round(holdout_accuracy, 4),
        "balanced_accuracy": round(balanced_accuracy, 4),
        "macro_f1": round(macro_f1, 4),
        "evaluation_split": {
            "method": "stratified_holdout",
            "test_fraction": 0.20,
            "random_seed": seed,
            "evaluated_samples": int(len(y_test)),
        },
        "training_methodology": "deterministic synthetic approximation of the frozen suitability policy",
        "metric_interpretation": "policy-approximation fidelity, not investment outcome accuracy",
    }

    with open(meta_path, "w", encoding="utf-8") as f:
        json.dump(metadata, f, indent=2)

    logger.info(f"Saved baseline RandomForest artifacts to {model_dir}")
    return pipeline, le, metadata


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    train_random_forest_model()
